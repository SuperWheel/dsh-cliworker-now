import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parseDocument, isMap } from 'yaml'
import type { CustomProviderField, CustomProviderForm, CustomProviderIssue, CustomProviderResult } from '../shared/custom-provider.ts'
import { CLI_LABELS, type CliId } from '../shared/types.ts'
import { isLoginProvider } from './account-guide/providers.ts'
import { parseHermesOwnEnvironment } from './hermes-env.ts'
import { commitNativeFiles, nativeJson, NativeRollbackError, readNativeFile } from './custom-provider-files.ts'

type Supported = 'pi' | 'opencode' | 'hermes'
const APIs: Record<Supported, [string, string][]> = {
  pi: [['openai-completions', 'OpenAI Chat Completions'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages'], ['google-generative-ai', 'Google Generative AI']],
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
interface Targets { config: string; auth: string; display: string }
interface Ticket { source: string; targets: string; expires: number; parent: string }

/** No secrets are held in tickets or persisted by this service. */
export class CustomProviders {
  private tickets = new Map<string, Ticket>()
  constructor(private options: { home?: string; env?: NodeJS.ProcessEnv; hermesHome?: string; now?: () => number } = {}) {}
  closeParent(parent: string) { for (const [key, ticket] of this.tickets) if (ticket.parent === parent) this.tickets.delete(key) }
  close() { this.tickets.clear() }
  private now() { return this.options.now?.() ?? Date.now() }
  private source(source: CustomProviderSource) { return JSON.stringify(source) }
  private targets(cli: CliId): Targets | undefined {
    const home = this.options.home ?? homedir(), env = this.options.env ?? process.env
    if (cli === 'pi') {
      const agent = join(home, '.pi', 'agent')
      // Existing worker account discovery uses the default native directory, not arbitrary inherited profiles.
      if (env.PI_CODING_AGENT_DIR && resolve(env.PI_CODING_AGENT_DIR) !== agent) return undefined
      return { config: join(agent, 'models.json'), auth: join(agent, 'auth.json'), display: '~/.pi/agent/models.json + auth.json' }
    }
    if (cli === 'opencode') {
      if (env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_DIR || env.OPENCODE_CONFIG_CONTENT || env.OPENCODE_AUTH_CONTENT) return undefined
      const configRoot = env.XDG_CONFIG_HOME || join(home, '.config'), dataRoot = env.XDG_DATA_HOME || join(home, '.local', 'share')
      if (!isAbsolute(configRoot) || !isAbsolute(dataRoot)) return undefined
      const config = join(configRoot, 'opencode', 'opencode.json'), jsonc = config + 'c'
      const primary = readNativeFile(config), commented = readNativeFile(jsonc)
      // Do not silently choose between two overlays with potentially conflicting provider definitions.
      if (primary.text !== undefined && commented.text !== undefined) return undefined
      return { config: commented.text === undefined ? config : jsonc, auth: join(dataRoot, 'opencode', 'auth.json'),
        display: 'XDG_CONFIG_HOME/opencode/opencode.json(c) + XDG_DATA_HOME/opencode/auth.json' }
    }
    if (cli === 'hermes') {
      if (env.HERMES_PROFILE) return undefined
      const root = this.options.hermesHome || env.HERMES_HOME || (process.platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'hermes') : join(home, '.hermes'))
      if (!isAbsolute(root)) return undefined
      return { config: join(root, 'config.yaml'), auth: join(root, '.env'), display: 'Hermes HOME/config.yaml + .env' }
    }
    return undefined
  }
  form(source: CustomProviderSource): CustomProviderForm | null {
    if (!Object.hasOwn(APIs, source.cli) || !source.entry) return null
    let targets: Targets | undefined
    try { targets = this.targets(source.cli) } catch { return null }
    if (!targets) return null
    const cli = source.cli as Supported
    const fields: CustomProviderField[] = [
      { id: 'providerId', label: '服务商 ID', kind: 'text', required: true, pattern: '^[a-z][a-z0-9_-]{0,63}$', maxLength: 64, help: '小写字母开头，可含数字、下划线和短横线；不可覆盖已有服务商。' },
      ...(cli === 'hermes' ? [] : [{ id: 'providerLabel', label: '服务商名称', kind: 'text', maxLength: 80 } as CustomProviderField]),
      { id: 'baseUrl', label: 'Base URL', kind: 'url', required: true, maxLength: 2048, placeholder: 'https://api.example.com/v1', help: '填写服务商要求的完整 API 根路径；不自动添加 /v1。' },
      { id: 'api', label: 'API 协议', kind: 'select', required: true, options: APIs[cli].map(([value, label]) => ({ value, label })) },
      { id: 'apiKey', label: 'API Key', kind: 'secret', required: true, maxLength: 8192 },
      { id: 'models', label: '模型 ID', kind: 'list', required: true, help: '每行一个准确模型 ID；不请求服务商或推测模型能力。' },
    ]
    const now = this.now()
    for (const [key, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(key)
    while (this.tickets.size >= 256) this.tickets.delete(this.tickets.keys().next().value!)
    const token = randomUUID()
    this.tickets.set(token, { source: this.source(source), targets: JSON.stringify(targets), expires: now + 10 * 60_000, parent: source.parent })
    return { cli, title: '添加其他服务商', description: `保存到 ${CLI_LABELS[cli]} 原生配置，不验证密钥或调用模型。`, fields, target: targets.display, nativeFallback: true, token }
  }
  save(source: CustomProviderSource, token: string, valuesJson: string, assertCurrent: () => void): CustomProviderResult {
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
      if (issues.length) return { ok: false, issues }
      const config = readNativeFile(targets.config), auth = readNativeFile(targets.auth, true)
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
          configText = doc.add(['provider', id], { name: label, npm: api, options: { baseURL: url }, models: Object.fromEntries((models as string[]).map(id => [id, { name: id }])) })
          authText = credentials.add([id], { type: 'api', key: secret })
        }
      }
      commitNativeFiles([{ file: auth, text: authText }, { file: config, text: configText }], () => {
        assertCurrent()
        if (ticket.expires <= this.now()) throw new Error('Expired')
      })
      this.tickets.delete(token)
      return { ok: true, cli, providerId: id, providerLabel: label, notice: '已保存原生配置；密钥有效性与模型可用性尚未验证' }
    } catch (error) {
      return failed(error instanceof NativeRollbackError ? error.message : '保存失败，原生配置未更改；请检查文件格式、权限或原生账号锁后重试')
    } finally { try { unlock?.() } catch { /* Do not expose filesystem details or credentials. */ } }
  }
}
