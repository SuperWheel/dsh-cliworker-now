import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AccountLogin } from '../shared/accounts.ts'
import { accountLoginId, parseAccountLoginId } from '../shared/account-links.ts'
import type { CustomProviderField, CustomProviderIssue, CustomProviderPreset, CustomProviderResult } from '../shared/custom-provider.ts'
import { commitNativeFiles, NativeRollbackError, readNativeFile } from './custom-provider-files.ts'
import { managedPiOmpProviders, managedProviderReceiptChange, managedProviderReceiptRemoval } from './custom-provider-managed.ts'
import {
  parsePersonal,
  readZCodeBuiltin,
  readZCodePersonalSources,
  safeZCodeProviderName,
  type ZCodeDiscoveryOptions,
} from './zcode-adapter.ts'

/*
 * ZCode 「其他服务商」（openspec/changes/v0.9.0-zcode-custom-key-leeyl）：用户自己的 API Key 服务商，
 * 只写插件账号目录 `<zcodeAuthDirectory>/.zcode/v2/provider_config.json`，不改全局
 * `~/.zcode/v2/provider_config.json`。格式与 ZCode 桌面端「自定义服务商」写入的条目一致：
 * UUID providerId、providerName、group=standard-personal、access.type=api-key。
 * 密钥只进这个 0600 文件，不进票据、结果、日志或设置缓存。
 */

export const ZCODE_API_TYPES: readonly (readonly [string, string])[] = [
  ['anthropic-messages', 'Anthropic Messages'],
  ['openai-chat-completions', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
]
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const rejectedKeys = new Set(['__proto__', 'prototype', 'constructor'])
const keyTypes = ['api-key', 'zhipu-coding-plan-api-key']
const failed = (message: string, field?: string): CustomProviderResult => ({ ok: false, issues: [{ ...(field ? { field } : {}), message }] })
const invalid = () => new Error('账号来源已变化，请刷新后重试')

export interface ZCodeProviderTarget {
  /** The plugin's ZCode data base directory (ZCODE_DATA_BASE_DIR of every Worker). */
  authDirectory: string
  /** `<authDirectory>/.zcode/v2`, also home of the ownership receipt. */
  directory: string
  /** The one file this form writes. */
  file: string
  /** Read-only conflict source; tests point it at a synthetic home. */
  nativeHome?: string
}
export function zcodeProviderTarget(authDirectory: string, nativeHome?: string): ZCodeProviderTarget {
  const directory = join(authDirectory, '.zcode', 'v2')
  return { authDirectory, directory, file: join(directory, 'provider_config.json'), ...(nativeHome ? { nativeHome } : {}) }
}
const discovery = (target: ZCodeProviderTarget): ZCodeDiscoveryOptions => (target.nativeHome ? { nativeHome: target.nativeHome } : {})

export function zcodeProviderFields(): CustomProviderField[] {
  return [
    { id: 'providerLabel', label: '名称', kind: 'text', required: true, maxLength: 80, help: '显示在模型列表和账号窗口中；不能与 ZCode 已有服务商重名。' },
    { id: 'api', label: '接口类型', kind: 'select', required: true, options: ZCODE_API_TYPES.map(([value, label]) => ({ value, label })) },
    { id: 'baseUrl', label: 'Base URL', kind: 'url', required: true, maxLength: 2048, placeholder: 'https://api.example.com/v1', help: '填写服务商要求的完整 API 根路径；不自动添加 /v1。' },
    { id: 'apiKey', label: 'API Key', kind: 'secret', required: true, maxLength: 8192 },
    { id: 'models', label: '模型 ID', kind: 'list', required: true, help: '每行一个准确模型 ID；不请求服务商或推测模型能力。' },
    { id: 'contextWindow', label: '上下文窗口', kind: 'text', pattern: '[1-9][0-9]{0,8}', maxLength: 9, placeholder: '可选，例如 200000', help: '以 token 计，应用于本次填写的全部模型；留空时使用 ZCode 内置规则。' },
  ]
}

/** ZCode's own API-key templates as prefills; coding-plan and account templates stay out. */
export function zcodeProviderPresets(executable: string | undefined, builtinConfig?: string): CustomProviderPreset[] {
  if (!executable) return []
  let builtin: unknown
  try { builtin = readZCodeBuiltin(executable, builtinConfig) } catch { return [] }
  if (!object(builtin) || !object(builtin.config)) return []
  const templates = builtin.config.providerConfigRules?.templateRules
  const disabled = new Set<string>()
  for (const rule of builtin.config.modelConfigRules?.templateModelRules ?? [])
    if (object(rule) && object(rule.config) && rule.config.enabled === false) disabled.add(JSON.stringify([rule.templateId, rule.modelId]))
  if (!Array.isArray(templates)) return []
  const presets: CustomProviderPreset[] = []
  for (const template of templates) {
    if (presets.length >= 64) break
    if (!object(template) || typeof template.templateId !== 'string' || !object(template.config)) continue
    const { access, api, builtinModelIds } = template.config
    if (!object(access) || access.type !== 'api-key' || !object(api) || !ZCODE_API_TYPES.some(([type]) => type === api.type) ||
      typeof api.baseUrl !== 'string' || api.headers != null) continue
    const name = safeZCodeProviderName(template.templateNameMap?.['zh-CN']) ?? safeZCodeProviderName(template.templateId)
    const models = (Array.isArray(builtinModelIds) ? builtinModelIds : [])
      .filter((id: unknown): id is string => typeof id === 'string' && validModel(id) && !disabled.has(JSON.stringify([template.templateId, id])))
      .slice(0, 100)
    if (!name || !validUrl(api.baseUrl)) continue
    presets.push({ id: template.templateId.slice(0, 128), label: name, values: { providerLabel: name, api: api.type, baseUrl: api.baseUrl, models: models.join('\n') } })
  }
  return presets
}

function validUrl(url: string) {
  try {
    const parsed = new URL(url)
    return /^https?:\/\//i.test(url) && ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username &&
      !parsed.password && !parsed.search && !parsed.hash && url.length <= 2048 && !/[\\\s\x00-\x1f\x7f]/.test(url)
  } catch { return false }
}
/** ZCode model IDs may contain inner spaces (e.g. Desktop's「K2.7 Code」); never control characters. */
const validModel = (id: string) => !!id && id === id.trim() && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id) && !rejectedKeys.has(id)

/** Every provider name and ID ZCode can already see: both personal files and the builtin catalog. */
function existingProviders(target: ZCodeProviderTarget, builtin: unknown) {
  const ids = new Set<string>(), names = new Set<string>()
  const add = (rule: unknown) => {
    if (!object(rule) || typeof rule.providerId !== 'string') return
    ids.add(rule.providerId.toLowerCase())
    const name = typeof rule.providerName === 'string' ? rule.providerName.trim() : ''
    names.add((name || rule.providerId).toLowerCase())
  }
  for (const source of readZCodePersonalSources(target.authDirectory, discovery(target)))
    for (const rule of source.document?.config.providerConfigRules.providerRules ?? []) add(rule)
  if (object(builtin) && object(builtin.config)) for (const rule of builtin.config.providerConfigRules?.providerRules ?? []) add(rule)
  return { ids, names }
}

function emptyDocument() {
  return { schemaVersion: 1, config: { providerConfigRules: { providerRules: [] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] } } }
}
/** The plugin file as written; a missing file starts empty. Its content must pass the native personal schema. */
function readPluginDocument(target: ZCodeProviderTarget) {
  const file = readNativeFile(target.file, true)
  const raw: unknown = file.text === undefined ? emptyDocument() : JSON.parse(file.text)
  parsePersonal(raw)
  const value = raw as Record<string, any>
  value.config.modelConfigRules ??= { providerModelRules: [], manualProviderModelRules: [] }
  return { file, value }
}
const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

/** Synchronous validation and commit; the caller holds the ZCode account reservation. */
export function saveZCodeProvider(
  target: ZCodeProviderTarget,
  input: Record<string, unknown>,
  builtin: unknown,
  assertCurrent: () => void,
): CustomProviderResult {
  if (Object.keys(input).some((key) => !['providerLabel', 'api', 'baseUrl', 'apiKey', 'models', 'contextWindow'].includes(key)))
    return failed('表单内容无效，请重新填写')
  const issues: CustomProviderIssue[] = []
  const issue = (field: string, message: string) => { issues.push({ field, message }) }
  const text = (field: string) => (typeof input[field] === 'string' ? (input[field] as string) : '')
  const label = text('providerLabel').trim(), url = text('baseUrl').trim(), api = text('api'), secret = text('apiKey')
  const window = text('contextWindow').trim()
  if (!label || safeZCodeProviderName(label) !== label) issue('providerLabel', '请填写 80 字以内、不含控制字符或尖括号的名称')
  if (!validUrl(url)) issue('baseUrl', '请填写不含凭据、查询参数或片段的 http(s) URL')
  if (!ZCODE_API_TYPES.some(([value]) => value === api)) issue('api', '请选择 ZCode 支持的接口类型')
  if (!secret || secret.length > 8192 || /[\s\x00-\x1f\x7f]/.test(secret)) issue('apiKey', '密钥为空或包含空白、控制字符')
  const models = Array.isArray(input.models) ? input.models : []
  if (!models.length || models.length > 100 || models.some((model) => typeof model !== 'string' || !validModel(model)) || new Set(models).size !== models.length)
    issue('models', '请填写 1–100 个不重复的模型 ID，每行一个')
  if (input.contextWindow !== undefined && typeof input.contextWindow !== 'string' || window && !/^[1-9][0-9]{0,8}$/.test(window))
    issue('contextWindow', '请填写正整数或留空')
  // A credential pasted into a public field must not reach metadata, the result or later caches.
  if (secret) for (const [field, value] of Object.entries({ providerLabel: label, baseUrl: url, models, contextWindow: window }))
    if ((Array.isArray(value) ? value : [value]).some((item) => typeof item === 'string' && item.includes(secret))) issue(field, '此字段不能包含 API Key')
  if (issues.length) return { ok: false, issues }
  const existing = existingProviders(target, builtin)
  if (existing.names.has(label.toLowerCase())) return failed('名称已被 ZCode 的其他服务商使用，请换一个名称', 'providerLabel')
  let providerId = randomUUID()
  while (existing.ids.has(providerId)) providerId = randomUUID()
  const ids = models as string[]
  const rule = {
    providerId,
    providerName: label,
    config: {
      group: 'standard-personal',
      access: { type: 'api-key', apiKey: secret },
      api: { type: api, baseUrl: url },
      personalModelIds: ids,
      modelOrder: ids,
    },
  }
  const { file, value } = readPluginDocument(target)
  value.config.providerConfigRules.providerRules.push(rule)
  if (window)
    value.config.modelConfigRules.providerModelRules.push(
      ...ids.map((modelId) => ({ providerId, modelId, config: { properties: { contextWindow: Number(window) } } })),
    )
  const next = serialize(value)
  parsePersonal(JSON.parse(next))
  const receipt = managedProviderReceiptChange(target.directory, providerId, rule)
  commitNativeFiles([{ file, text: next }, receipt], assertCurrent, () => {
    const actual = readNativeFile(target.file, true)
    if (actual.text !== next) throw invalid()
  })
  return { ok: true, cli: 'zcode', providerId, providerLabel: label, notice: '已保存到插件账号目录；密钥有效性与模型可用性尚未验证' }
}

/** Plugin-created rules whose exact content still matches the ownership receipt. */
function managed(target: ZCodeProviderTarget, rules: Record<string, any>[]): Set<string> {
  return managedPiOmpProviders(target.directory, { providers: Object.fromEntries(rules.map((rule) => [rule.providerId, rule])) }, {})
}

/**
 * Safe account rows for API-key providers: name, method and location only. Plugin-created rows
 * carry a deletion handle; global ones stay read-only (they belong to ZCode Desktop).
 */
export function zcodeProviderLogins(target: ZCodeProviderTarget): AccountLogin[] {
  const rows: AccountLogin[] = []
  for (const source of readZCodePersonalSources(target.authDirectory, discovery(target))) {
    const rules = source.document?.config.providerConfigRules.providerRules ?? []
    const owned = source.source === 'plugin' ? managed(target, rules) : new Set<string>()
    for (const rule of rules) {
      const access = rule.config.access
      if (rule.enabled === false || rule.config.visibility === 'hidden' || !object(access) || !keyTypes.includes(access.type) ||
        typeof access.apiKey !== 'string' || !access.apiKey.trim()) continue
      const id = owned.has(rule.providerId) ? accountLoginId('zcode', rule.providerId, 'plugin.config') : undefined
      rows.push({
        providerLabel: safeZCodeProviderName(rule.providerName) ?? '自定义服务商',
        authMethod: 'api',
        source: source.source,
        ...(id ? { id, managedConfiguration: true } : {}),
      })
    }
  }
  return rows
}

function selected(target: ZCodeProviderTarget, login: string) {
  const parsed = parseAccountLoginId(login)
  if (parsed?.cli !== 'zcode' || parsed.entry !== 'plugin.config') throw invalid()
  const { file, value } = readPluginDocument(target)
  const rules = value.config.providerConfigRules.providerRules as Record<string, any>[]
  return { provider: parsed.provider, file, value, rules }
}

/** Authoritative readback for the deletion handle. */
export function zcodeManagedProviderExists(target: ZCodeProviderTarget, login: string): boolean {
  const current = selected(target, login)
  return current.rules.some((rule) => rule.providerId === current.provider)
}

/** Caller holds the ZCode reservation. Removes the rule, its model rules and order entry, and the receipt entry atomically. */
export function deleteZCodeManagedProvider(target: ZCodeProviderTarget, login: string, assertCurrent: () => void): void {
  try {
    assertCurrent()
    const { provider, file, value, rules } = selected(target, login)
    const rule = rules.find((item) => item.providerId === provider)
    // A changed or foreign entry never matches the receipt, so it is never deleted here.
    if (!rule || !managed(target, rules).has(provider)) throw invalid()
    const next = structuredClone(value)
    next.config.providerConfigRules.providerRules = rules.filter((item) => item.providerId !== provider)
    for (const group of ['providerModelRules', 'manualProviderModelRules'])
      if (Array.isArray(next.config.modelConfigRules[group]))
        next.config.modelConfigRules[group] = next.config.modelConfigRules[group].filter((item: any) => item?.providerId !== provider)
    if (Array.isArray(next.config.providerOrder)) next.config.providerOrder = next.config.providerOrder.filter((id: unknown) => id !== provider)
    const text = serialize(next)
    parsePersonal(JSON.parse(text))
    const changes = [{ file, text }, managedProviderReceiptRemoval(target.directory, provider)]
    commitNativeFiles(changes, assertCurrent, () => {
      for (const change of changes) {
        const actual = readNativeFile(change.file.path)
        if (actual.text !== change.text || actual.mode !== change.file.mode) throw invalid()
      }
      const after = JSON.parse(readNativeFile(target.file, true).text ?? '{}')
      if (after.config.providerConfigRules.providerRules.some((item: any) => item.providerId === provider) ||
        !isDeepStrictEqual(after, JSON.parse(text))) throw invalid()
    })
  } catch (error) { throw error instanceof NativeRollbackError ? error : invalid() }
}
