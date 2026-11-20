import type { CliId } from './types.ts'

/*
 * 「其他服务商」图形化配置协议（openspec/archives/vnext-custom-provider-form-leeyl）。
 * Host 按 CLI 已核实的原生格式生成表单描述；Client 用同一个模板渲染，不为某个 CLI 写专用组件。
 */

/** One selectable value of a `select` field. */
export interface CustomProviderOption {
  value: string
  label: string
  /** Optional one-line hint shown as a tooltip or secondary text. */
  detail?: string
}

/**
 * One form field. `secret` values are write-only: Host never returns them, and the client must not
 * persist them anywhere (no drafts, no localStorage, no logs). `list` holds one entry per line (e.g. model ids).
 */
export interface CustomProviderField {
  id: string
  label: string
  kind: 'text' | 'url' | 'secret' | 'select' | 'list'
  required?: boolean
  placeholder?: string
  /** Short help text; the client may show it as a hover tip instead of permanent small text. */
  help?: string
  options?: CustomProviderOption[]
  /** Initial value for text/url/select fields (never for secret). For `list`, one entry per line. */
  defaultValue?: string
  /** Client-side hint only; Host re-validates everything. */
  pattern?: string
  maxLength?: number
}

/**
 * A built-in template that fills public fields (never `secret`) when chosen, e.g. ZCode's own
 * provider templates. Values use the field's text form; a `list` value holds one entry per line.
 * Choosing one only edits the form: Host still validates the submitted values, not the preset.
 */
export interface CustomProviderPreset {
  id: string
  label: string
  values: Record<string, string>
}

/** Form description for one CLI. Absent (Host returns `null`) means the CLI keeps the native terminal. */
export interface CustomProviderForm {
  cli: CliId
  /** Window title, e.g. 「添加其他服务商」. */
  title: string
  /** One-sentence lead under the title. */
  description?: string
  fields: CustomProviderField[]
  /** Optional templates for prefilling; older clients ignore them. */
  presets?: CustomProviderPreset[]
  /** Where the CLI keeps this configuration, as a safe display string (e.g. `~/.pi/agent/models.json`). */
  target?: string
  /** True when the native terminal can still be offered as an alternative. */
  nativeFallback: boolean
  /** Opaque Host token binding this form to the CLI entry/revision it was generated for. */
  token: string
}

/** Values submitted by the client; `list` fields are arrays, everything else strings. */
export type CustomProviderValues = Record<string, string | string[]>

/** Per-field validation failure returned by Host. `field` is absent for whole-form errors. */
export interface CustomProviderIssue {
  field?: string
  message: string
}

/** Result of `saveCustomProvider`. Never carries secrets. */
export type CustomProviderResult =
  | { ok: true; cli: CliId; providerId: string; providerLabel: string; notice?: string }
  | { ok: false; issues: CustomProviderIssue[] }

/*
 * Remote methods (Host `src/host/index.ts`):
 *   customProviderForm(parentSessionId, cli, signal) -> JSON CustomProviderForm | 'null'
 *   saveCustomProvider(parentSessionId, cli, token, valuesJson, signal) -> JSON CustomProviderResult
 * After `ok: true` Host invalidates the CLI's account and catalog connection cache; the client then
 * calls `refreshAccountStatus` + `refreshCatalogForCli` as for other account operations.
 */
