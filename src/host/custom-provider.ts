import { managedProviderLabels, managedProviderReceiptChange } from './custom-provider-managed.ts'
import { addOmpProvider, OMP_API_TYPES, OMP_RESERVED_PROVIDER_IDS, ompLiteralKeyIssue, ompProviderNode, parseOmpModels } from './omp-custom-provider.ts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument, isMap } from 'yaml'
import type { CustomProviderField, CustomProviderForm, CustomProviderIssue, CustomProviderResult } from '../shared/custom-provider.ts'
import { CLI_LABELS, type CliId } from '../shared/types.ts'
import { isLoginProvider } from './account-guide/providers.ts'
import { parseHermesOwnEnvironment } from './hermes-env.ts'
import { piOmpAccountDirectory } from './pi-omp-native.ts'
import { effectiveHermesHome } from './hermes-account-context.ts'
import { openCodeAuthDirectory } from './opencode-adapter.ts'
import { commitNativeFiles, nativeJson, NativeRollbackError, readNativeFile } from './custom-provider-files.ts'
import { readZCodeBuiltin, zcodeAuthDirectory } from './zcode-adapter.ts'
import { saveZCodeProvider, ZCODE_API_TYPES, zcodeProviderFields, zcodeProviderPresets, zcodeProviderTarget } from './zcode-custom-provider.ts'

type Supported = 'pi' | 'omp' | 'opencode' | 'hermes' | 'zcode'
const APIs: Record<Supported, readonly (readonly [string, string])[]> = {
  zcode: ZCODE_API_TYPES,
  pi: [['openai-completions', 'OpenAI Chat Completions'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages'], ['google-generative-ai', 'Google Generative AI']],
  omp: OMP_API_TYPES,
  opencode: [['@ai-sdk/openai-compatible', 'OpenAI 兼容'], ['@ai-sdk/openai', 'OpenAI'], ['@ai-sdk/anthropic', 'Anthropic']],
  hermes: [['chat_completions', 'OpenAI Chat Completions'], ['codex_responses', 'OpenAI Responses'], ['anthropic_messages', 'Anthropic Messages']],
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const idPattern = /^[a-z][a-z0-9_-]{0,63}$/
const rejectedKeys = new Set(['__proto__', 'prototype', 'constructor'])
const failed = (message: string, field?: string): CustomProviderResult => ({ ok: false, issues: [{ ...(field ? { field } : {}), message }] })

export interface CustomProviderSource {
  parent: string
  cli: CliId
  /** Host-owned recorded entry and revision, never supplied by the client. */
  entry: unknown
  revision: number
}
interface Targets { config: string; auth: string; display: string; conflicts?: { configs: string[]; auth: string } }
interface Ticket { source: string; targets: string; expires: number; parent: string }

const entryPath = (entry: unknown): string | undefined =>
  object(entry) && typeof entry.path === 'string' && entry.path ? entry.path : undefined

/** No secrets are held in tickets or persisted by this service. */
export class CustomProviders {
  private tickets = new Map<string, Ticket>()
  constructor(private options: { home?: string; env?: NodeJS.ProcessEnv; stateDirectory?: string; hermesHome?: string; zcodeAuthDirectory?: string; zcodeBuiltinConfig?: string; now?: () => number } = {}) {}
  closeParent(parent: string) { for (const [key, ticket] of this.tickets) if (ticket.parent === parent) this.tickets.delete(key) }
  close() { this.tickets.clear() }
  private now() { return this.options.now?.() ?? Date.now() }
  private source(source: CustomProviderSource) { return JSON.stringify(source) }
  private stateDirectory() {
    return resolve(this.options.stateDirectory ?? join((this.options.env ?? process.env).DSH_HOME ?? join(this.options.home ?? homedir(), '.dsh'), 'cliworker-now'))
  }
  private targets(cli: CliId): Targets | undefined {
    const home = this.options.home ?? homedir(), env = this.options.env ?? process.env
    if (cli === 'pi') {
      // Account login writes here; discovery and worker snapshots merge this source after the global one.
      const agent = piOmpAccountDirectory('pi', this.stateDirectory())
      if (env.PI_CODING_AGENT_DIR && ![resolve(home, '.pi', 'agent'), agent].includes(resolve(env.PI_CODING_AGENT_DIR))) return undefined
      return { config: join(agent, 'models.json'), auth: join(agent, 'auth.json'), display: `${join(agent, 'models.json')} + ${join(agent, 'auth.json')}` }
    }
    if (cli === 'omp') {
      // A profile or a redirected agent root makes OMP read another models.yml.
      if (env.OMP_PROFILE?.trim() || env.PI_PROFILE?.trim()) return undefined
      const agent = piOmpAccountDirectory('omp', this.stateDirectory()), global = join(home, '.omp', 'agent')
      if (env.PI_CODING_AGENT_DIR && ![global, agent].includes(resolve(env.PI_CODING_AGENT_DIR))) return undefined
      // OMP reads models.yml first, else models.yaml, else migrates models.json; only models.yml is managed here.
      for (const name of ['models.yaml', 'models.json']) if (readNativeFile(join(agent, name)).text !== undefined) return undefined
      const config = join(agent, 'models.yml')
      // Account login, discovery and Worker snapshots merge this plugin source after the global one.
      return { config, auth: config, display: config, conflicts: { configs: [join(global, 'models.yml')], auth: join(global, 'agent.db') } }
    }
    if (cli === 'opencode') {
      if (env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_DIR || env.OPENCODE_CONFIG_CONTENT || env.OPENCODE_AUTH_CONTENT) return undefined
      const configRoot = env.XDG_CONFIG_HOME || join(home, '.config'), dataRoot = env.XDG_DATA_HOME || join(home, '.local', 'share')
      if (!isAbsolute(configRoot) || !isAbsolute(dataRoot)) return undefined
      const data = openCodeAuthDirectory(this.stateDirectory())
      const config = join(dirname(data), 'config', 'opencode', 'opencode.json'), jsonc = config + 'c'
      const primary = readNativeFile(config), commented = readNativeFile(jsonc)
      // Do not silently choose between two overlays with potentially conflicting provider definitions.
      if (primary.text !== undefined && commented.text !== undefined) return undefined
      const selected = commented.text === undefined ? config : jsonc, auth = join(data, 'opencode', 'auth.json')
      return { config: selected, auth, display: `${selected} + ${auth}`,
        // Bind read-only overlay sources too: an XDG change invalidates the open form.
        conflicts: { configs: ['config.json', 'opencode.json', 'opencode.jsonc'].map(name => join(configRoot, 'opencode', name)), auth: join(dataRoot, 'opencode', 'auth.json') } }
    }
    if (cli === 'zcode') {
      // Worker discovery and execution merge this plugin file after the global one; never write the global file.
      const target = this.zcodeTarget()
      return { config: target.file, auth: target.file, display: target.file }
    }
    if (cli === 'hermes') {
      if (env.HERMES_PROFILE) return undefined
      const native = this.options.hermesHome?.trim() || env.HERMES_HOME?.trim() || (process.platform === 'win32' ? join(env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local'), 'hermes') : join(home, '.hermes'))
      const stateDirectory = this.stateDirectory()
      // Preserve no-link checks before the runtime selector canonicalizes any ancestors.
      readNativeFile(join(stateDirectory, 'accounts', 'hermes-source.json'))
      const root = effectiveHermesHome({ stateDirectory, hermesHome: native })
      if (root !== join(stateDirectory, 'accounts', 'hermes')) readNativeFile(join(native, 'config.yaml'))
      const config = join(root, 'config.yaml'), auth = join(root, '.env')
      return { config, auth, display: `${config} + ${auth}` }
    }
    return undefined
  }
  private zcodeTarget() {
    return zcodeProviderTarget(zcodeAuthDirectory(this.options.zcodeAuthDirectory, this.stateDirectory()), this.options.home)
  }
  private ticket(source: CustomProviderSource, targets: Targets) {
    const now = this.now()
    for (const [key, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(key)
    while (this.tickets.size >= 256) this.tickets.delete(this.tickets.keys().next().value!)
    const token = randomUUID()
    this.tickets.set(token, { source: this.source(source), targets: JSON.stringify(targets), expires: now + 10 * 60_000, parent: source.parent })
    return token
  }
  form(source: CustomProviderSource): CustomProviderForm | null {
    if (!Object.hasOwn(APIs, source.cli) || !source.entry) return null
    let targets: Targets | undefined
    try { targets = this.targets(source.cli) } catch { return null }
    if (!targets) return null
    const cli = source.cli as Supported
    if (cli === 'zcode') {
      const presets = zcodeProviderPresets(entryPath(source.entry), this.options.zcodeBuiltinConfig)
      return { cli, title: '添加其他服务商', description: '用你自己的 API Key 配置服务商，只保存到 CLI Worker 的 ZCode 账号目录，不修改 ZCode 桌面端配置；不验证密钥或调用模型。',
        fields: zcodeProviderFields(), ...(presets.length ? { presets } : {}), target: targets.display, nativeFallback: false, token: this.ticket(source, targets) }
    }
    const fields: CustomProviderField[] = [
      { id: 'providerId', label: '服务商 ID', kind: 'text', required: true, pattern: '^[a-z][a-z0-9_-]{0,63}$', maxLength: 64, help: '小写字母开头，可含数字、下划线和短横线；不可覆盖已有服务商。' },
      ...(cli === 'hermes' ? [] : [{ id: 'providerLabel', label: '服务商名称', kind: 'text', maxLength: 80 } as CustomProviderField]),
      { id: 'baseUrl', label: 'Base URL', kind: 'url', required: true, maxLength: 2048, placeholder: 'https://api.example.com/v1', help: '填写服务商要求的完整 API 根路径；不自动添加 /v1。' },
      { id: 'api', label: 'API 协议', kind: 'select', required: true, options: APIs[cli].map(([value, label]) => ({ value, label })) },
      { id: 'apiKey', label: 'API Key', kind: 'secret', required: true, maxLength: 8192 },
      { id: 'models', label: '模型 ID', kind: 'list', required: true, help: '每行一个准确模型 ID；不请求服务商或推测模型能力。' },
    ]
    const token = this.ticket(source, targets)
    if (cli === 'omp') return { cli, title: '添加其他服务商', description: '用你自己的 API Key 配置服务商，只保存到 CLI Worker 的 OMP 账号目录（models.yml），不修改 OMP 全局配置或 agent.db；不验证密钥或调用模型。',
      fields, target: targets.display, nativeFallback: true, token }
    return { cli, title: '添加其他服务商', description: `保存到 ${CLI_LABELS[cli]} 原生配置，不验证密钥或调用模型。`, fields, target: targets.display, nativeFallback: true, token }
  }
  /**
   * `context.ompReserved`: lower-case provider ids the Host read from every OMP source (models and
   * agent.db rows) plus OMP's own catalog for this id. OMP saves are refused without it.
   */
  save(source: CustomProviderSource, token: string, valuesJson: string, assertCurrent: () => void, context: { ompReserved?: ReadonlySet<string> } = {}): CustomProviderResult {
    const ticket = this.tickets.get(token)
    if (!ticket || ticket.expires <= this.now() || ticket.source !== this.source(source)) {
      this.tickets.delete(token)
      return failed('表单已过期或 CLI 入口已变更，请重新打开表单')
    }
    let unlock: (() => void) | undefined
    try {
      const targets = this.targets(source.cli)
      if (!targets || JSON.stringify(targets) !== ticket.targets) { this.tickets.delete(token); return failed('原生配置来源已变化，请重新打开表单') }
      const cli = source.cli as Supported
      let input: unknown
      try { input = JSON.parse(typeof valuesJson === 'string' && valuesJson.length <= 64 * 1024 ? valuesJson : 'null') }
      catch { return failed('表单内容无效，请重新填写') }
      if (cli === 'zcode') {
        if (!object(input)) return failed('表单内容无效，请重新填写')
        let builtin: unknown
        try { builtin = readZCodeBuiltin(entryPath(source.entry) ?? '', this.options.zcodeBuiltinConfig) } catch { builtin = undefined }
        const result = saveZCodeProvider(this.zcodeTarget(), input, builtin, () => {
          assertCurrent()
          if (ticket.expires <= this.now()) throw new Error('Expired')
          if (JSON.stringify(this.targets(source.cli)) !== ticket.targets) throw new Error('Changed account source')
        })
        if (result.ok) this.tickets.delete(token)
        return result
      }
      if (!object(input) || Object.keys(input).some(key => !['providerId', 'providerLabel', 'baseUrl', 'api', 'apiKey', 'models'].includes(key))) return failed('表单内容无效，请重新填写')
      const issues: CustomProviderIssue[] = []
      const issue = (field: string, message: string) => { issues.push({ field, message }) }
      const text = (field: string) => typeof input[field] === 'string' ? input[field] as string : ''
      const id = text('providerId').trim(), label = cli === 'hermes' ? id : text('providerLabel').trim() || id
      const url = text('baseUrl').trim(), api = text('api'), secret = text('apiKey')
      if (!idPattern.test(id) || rejectedKeys.has(id)) issue('providerId', '请填写有效的服务商 ID')
      if (input.providerLabel !== undefined && typeof input.providerLabel !== 'string' || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) issue('providerLabel', '名称格式无效或过长')
      try {
        const parsed = new URL(url)
        if (!/^https?:\/\//i.test(url) || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || url.length > 2048 || /[\\\s\x00-\x1f\x7f]/.test(url)) throw new Error()
      } catch { issue('baseUrl', '请填写不含凭据、查询参数或片段的 http(s) URL') }
      if (!APIs[cli].some(([value]) => value === api)) issue('api', '请选择此 CLI 支持的 API 协议')
      if (!secret || secret.length > 8192 || /[\s\x00-\x1f\x7f]/.test(secret) || cli === 'hermes' && secret.includes('${')) issue('apiKey', '密钥为空或包含此原生存储不支持的字符')
      const models = Array.isArray(input.models) ? input.models : []
      if (!models.length || models.length > 100 || models.some(model => typeof model !== 'string' || !model || model.length > 256 || /[\s\x00-\x1f\x7f]/.test(model) || rejectedKeys.has(model)) || new Set(models).size !== models.length) issue('models', '请填写 1–100 个不重复的模型 ID，每行一个')
      // A credential accidentally pasted into a public field must not reach metadata, the result or later caches.
      if (secret) for (const [field, value] of Object.entries({ providerId: id, providerLabel: label, baseUrl: url, api, models })) {
        if ((Array.isArray(value) ? value : [value]).some(item => typeof item === 'string' && item.includes(secret))) issue(field, '此字段不能包含 API Key')
      }
      if (cli === 'omp' && secret && !issues.some(item => item.field === 'apiKey')) {
        const keyIssue = ompLiteralKeyIssue(secret, this.options.env ?? process.env)
        if (keyIssue) issue('apiKey', keyIssue)
      }
      if (issues.length) return { ok: false, issues }
      const config = readNativeFile(targets.config), auth = readNativeFile(targets.auth, true)
      if (cli === 'omp') {
        const reserved = context.ompReserved
        if (!reserved) return failed('无法确认已有服务商，请稍后重试或在原生终端中配置', 'providerId')
        const file = auth, local = parseOmpModels(file.text), global = parseOmpModels(readNativeFile(targets.conflicts!.configs[0]!).text)
        // Effective names: a saved label, otherwise the id. Compare trimmed and case-insensitive.
        const labels = managedProviderLabels(dirname(file.path), local.value, {})
        const names = [...Object.keys(local.providers).map(key => labels.get(key) ?? key), ...Object.keys(global.providers)].map(name => name.trim().toLowerCase())
        const ids = [...Object.keys(local.providers), ...Object.keys(global.providers)].map(key => key.toLowerCase())
        if (reserved.has(id) || OMP_RESERVED_PROVIDER_IDS.includes(id) || isLoginProvider(cli, id) || ids.includes(id) || names.includes(id))
          return failed('服务商 ID 已存在或与 OMP 内置服务商重名，请使用其他 ID', 'providerId')
        if (names.includes(label.toLowerCase()) || reserved.has(label.toLowerCase())) return failed('服务商名称已存在，请使用其他名称', 'providerLabel')
        const node = ompProviderNode({ baseUrl: url, api, apiKey: secret, models: models as string[] })
        const text = addOmpProvider(file.text, id, node)
        const changes = [{ file, text }, managedProviderReceiptChange(dirname(file.path), id, node, undefined, label === id ? undefined : label)]
        commitNativeFiles(changes, () => {
          assertCurrent()
          if (ticket.expires <= this.now()) throw new Error('Expired')
          if (JSON.stringify(this.targets(source.cli)) !== ticket.targets) throw new Error('Changed account source')
        }, () => {
          // Independent readback of both files: content, private mode and the literal key.
          for (const change of changes) {
            const actual = readNativeFile(change.file.path)
            if (actual.text !== change.text || actual.mode !== 0o600) throw new Error('Readback failed')
          }
          if (!isDeepStrictEqual(parseOmpModels(readNativeFile(file.path).text).providers[id], node)) throw new Error('Readback failed')
        })
        this.tickets.delete(token)
        return { ok: true, cli, providerId: id, providerLabel: label, notice: '已保存到 CLI Worker 的 OMP 账号目录；密钥有效性与模型可用性尚未验证' }
      }
      let configText: string, authText: string
      if (cli === 'hermes') {
        // Match the existing own-account reader's bounded dotenv subset; no redirects or interpolation.
        const oldEnvironment = parseHermesOwnEnvironment(auth.text ?? '')
        const doc = parseDocument(config.text ?? '', { uniqueKeys: true })
        if (doc.errors.length || doc.warnings.length) throw new Error('Invalid YAML')
        const data: unknown = doc.toJS({ maxAliasCount: 0 }) ?? {}
        // Hermes' stock config has no top-level providers, or only a commented example (null).
        if (!object(data) || data.providers != null && !object(data.providers)) throw new Error('Invalid YAML')
        const providers = (data.providers ?? {}) as Record<string, unknown>
        const legacy = data.custom_providers
        if (legacy !== undefined && !Array.isArray(legacy)) throw new Error('Invalid YAML')
        const rows = [...Object.entries(providers).map(([key, value]) => ({ key, value })), ...(Array.isArray(legacy) ? legacy.map(value => ({ key: '', value })) : [])]
        if (isLoginProvider(cli, id) || rows.some(({ key, value }) => key.toLowerCase() === id || object(value) && String(value.name ?? '').toLowerCase() === id)) return failed('服务商 ID 或名称已存在，请使用其他名称', 'providerId')
        const variable = `CLIWORKER_PROVIDER_${createHash('sha256').update(id).digest('hex').toUpperCase()}_API_KEY`
        if (Object.hasOwn(this.options.env ?? process.env, variable) || Object.hasOwn(oldEnvironment, variable)) return failed('服务商凭据名称已存在，请使用其他 ID', 'providerId')
        if (doc.contents && !isMap(doc.contents)) throw new Error('Invalid YAML')
        // A plain object stored via set() is not a YAML node, so setIn() could not descend into it.
        if (data.providers == null) doc.set('providers', doc.createNode({}))
        doc.setIn(['providers', id], { api: url, key_env: variable, api_mode: api, models: Object.fromEntries((models as string[]).map(model => [model, {}])) })
        const indent = /(?:^|\n)( +)\S/.exec(config.text ?? '')?.[1].length ?? 2
        configText = doc.toString({ lineWidth: 0, indent })
        if (config.text?.includes('\r\n')) configText = configText.replace(/\n/g, '\r\n')
        const eol = auth.text?.includes('\r\n') ? '\r\n' : '\n'
        authText = (auth.text ?? '') + (auth.text && !auth.text.endsWith('\n') ? eol : '') + `${variable}='${secret.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'${eol}`
        const writtenEnvironment = parseHermesOwnEnvironment(authText)
        if (writtenEnvironment[variable] !== secret) return failed('此密钥无法由当前原生环境文件与账号读取器一致读取，请使用原生终端', 'apiKey')
        if (Object.entries(oldEnvironment).some(([key, value]) => writtenEnvironment[key] !== value)) throw new Error('Invalid environment')
      } else {
        const doc = nativeJson(config.text), credentials = nativeJson(auth.text)
        const key = cli === 'pi' ? 'providers' : 'provider'
        if (cli === 'opencode' && Object.hasOwn(doc.value, 'providers')) return failed('检测到另一版原生配置，请在原生终端中配置')
        const providers = doc.value[key] ?? {}
        if (!object(providers)) throw new Error('Invalid providers')
        const collision = Object.entries(providers).some(([key, value]) => key.toLowerCase() === id || object(value) && typeof value.name === 'string' && value.name.toLowerCase() === label.toLowerCase())
        if (collision || Object.keys(credentials.value).some(key => key.toLowerCase() === id) || isLoginProvider(cli, id)) return failed('服务商 ID 或名称已存在，请使用其他名称', 'providerId')
        if (cli === 'pi') {
          // Adding to the higher-priority plugin source must not shadow an existing global provider.
          const global = join(this.options.home ?? homedir(), '.pi', 'agent')
          const globalProviders = nativeJson(readNativeFile(join(global, 'models.json')).text).value.providers ?? {}
          const globalAuth = nativeJson(readNativeFile(join(global, 'auth.json'), true).text).value
          if (!object(globalProviders)) throw new Error('Invalid providers')
          if (Object.entries(globalProviders).some(([key, value]) => key.toLowerCase() === id || object(value) && typeof value.name === 'string' && value.name.toLowerCase() === label.toLowerCase()) || Object.keys(globalAuth).some(key => key.toLowerCase() === id)) return failed('服务商 ID 或名称已存在，请使用其他名称', 'providerId')
          configText = doc.add(['providers', id], { name: label, baseUrl: url, api, models: (models as string[]).map(id => ({ id })) })
          // Pi treats leading ! as a command and $NAME as interpolation even in auth.json.
          const key = secret.replace(/[$!]/g, char => char === '$' ? '$$' : '$!')
          authText = credentials.add([id], { type: 'api_key', key })
          // proper-lockfile uses this exact directory. Never steal a stale native lock.
          if (auth.text !== undefined) {
            mkdirSync(`${auth.path}.lock`, { mode: 0o700 })
            unlock = () => { rmdirSync(`${auth.path}.lock`) }
          }
        } else {
          // Worker merges global config.json/json/jsonc first, then plugin configuration/auth.
          // Reject collisions across every consumed global overlay instead of shadowing them.
          for (const path of targets.conflicts!.configs) {
            const global = nativeJson(readNativeFile(path).text).value
            if (Object.hasOwn(global, 'providers')) return failed('检测到另一版原生配置，请在原生终端中配置')
            const providers = global.provider ?? {}
            if (!object(providers)) throw new Error('Invalid providers')
            if (Object.entries(providers).some(([key, value]) => key.toLowerCase() === id || object(value) && typeof value.name === 'string' && value.name.toLowerCase() === label.toLowerCase())) return failed('服务商 ID 或名称已存在，请使用其他名称', 'providerId')
          }
          const globalAuth = nativeJson(readNativeFile(targets.conflicts!.auth, true).text).value
          if (Object.keys(globalAuth).some(key => key.toLowerCase() === id)) return failed('服务商 ID 或名称已存在，请使用其他名称', 'providerId')
          configText = doc.add(['provider', id], { name: label, npm: api, options: { baseURL: url }, models: Object.fromEntries((models as string[]).map(id => [id, { name: id }])) })
          authText = credentials.add([id], { type: 'api', key: secret })
        }
      }
      const ownership = cli === 'pi' ? [managedProviderReceiptChange(dirname(config.path), id,
        (nativeJson(configText).value.providers as Record<string, unknown>)[id], nativeJson(authText).value[id])] : []
      commitNativeFiles([{ file: auth, text: authText }, { file: config, text: configText }, ...ownership], () => {
        assertCurrent()
        if (ticket.expires <= this.now()) throw new Error('Expired')
        if (JSON.stringify(this.targets(source.cli)) !== ticket.targets) throw new Error('Changed account source')
      })
      this.tickets.delete(token)
      return { ok: true, cli, providerId: id, providerLabel: label, notice: '已保存原生配置；密钥有效性与模型可用性尚未验证' }
    } catch (error) {
      return failed(error instanceof NativeRollbackError ? error.message : '保存失败，原生配置未更改；请检查文件格式、权限或原生账号锁后重试')
    } finally { try { unlock?.() } catch { /* Do not expose filesystem details or credentials. */ } }
  }
}
