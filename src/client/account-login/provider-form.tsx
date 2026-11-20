import { useEffect, useId, useRef, useState } from 'react'
import {
  Button,
  IconEyeOffOutlineRegular,
  IconEyeOutlineRegular,
  IconInfoOutlineRegular,
  Input,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CustomProviderField,
  CustomProviderForm,
  CustomProviderIssue,
  CustomProviderPreset,
  CustomProviderValues,
} from '../../shared/custom-provider.ts'
import { t, useT } from '../i18n.ts'
import { NativeChoice } from '../native-settings-choice.tsx'
import { hostText, operationMessage } from '../operation-error.ts'
import { Result } from './login-window.tsx'

/*
 * 「服务商表单」模板（openspec/archives/vnext-custom-provider-form-leeyl）：账号窗口里填写服务商配置的
 * 唯一实现，完全由表单描述驱动，不为某个 CLI 写专用字段。样式沿用 `.cwn-accounts-*` / `.cwn-login-*`，
 * 规则见 doc/settings-ui-design.md「服务商表单模板」。
 *
 * secret 字段只活在本组件的 React 状态里：不进草稿、localStorage 或日志；返回、关闭窗口（卸载）或保存成功后即清空。
 */

/** What the template renders: a Host `CustomProviderForm`, or any menu that describes itself the same way. */
export type ProviderFormSpec = Pick<CustomProviderForm, 'title' | 'description' | 'fields' | 'target' | 'presets'>

/** The owner's answer to one submit; a thrown error is shown as a whole-form issue. */
export type ProviderFormOutcome =
  | { ok: true; title: string; detail?: string }
  | { ok: false; issues: CustomProviderIssue[] }

const KINDS = new Set<CustomProviderField['kind']>(['text', 'url', 'secret', 'select', 'list'])

/** Whether a parsed description can be drawn by the template; anything else keeps the native terminal. */
export function validProviderForm(form: unknown): form is CustomProviderForm {
  if (!form || typeof form !== 'object') return false
  const value = form as Partial<CustomProviderForm>
  return (
    typeof value.title === 'string' &&
    typeof value.token === 'string' &&
    typeof value.nativeFallback === 'boolean' &&
    Array.isArray(value.fields) &&
    value.fields.length > 0 &&
    value.fields.every(
      (field) =>
        !!field &&
        typeof field.id === 'string' &&
        typeof field.label === 'string' &&
        KINDS.has(field.kind) &&
        (field.kind !== 'select' || (Array.isArray(field.options) && field.options.length > 0)),
    )
  )
}

/** Well-formed templates only; a malformed one is dropped rather than rejecting the whole form. */
const usablePresets = (form: ProviderFormSpec): CustomProviderPreset[] =>
  (Array.isArray(form.presets) ? form.presets : []).filter(
    (preset) =>
      !!preset &&
      typeof preset.id === 'string' &&
      typeof preset.label === 'string' &&
      !!preset.values &&
      typeof preset.values === 'object',
  )

/** The public fields a template may fill: never a secret, never a field the form does not have. */
const presetValues = (fields: CustomProviderField[], preset: CustomProviderPreset) =>
  Object.fromEntries(
    Object.entries(preset.values).filter(
      ([id, value]) => typeof value === 'string' && fields.some((field) => field.id === id && field.kind !== 'secret'),
    ),
  )

const initialValues = (fields: CustomProviderField[]) =>
  Object.fromEntries(fields.map((field) => [field.id, field.kind === 'secret' ? '' : (field.defaultValue ?? '')]))

const listItems = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

/** Pasted keys often carry a trailing newline; the value itself never contains one. */
const secretValue = (text: string) => text.replace(/[\r\n]/g, '').trim()

function collect(fields: CustomProviderField[], raw: Record<string, string>): CustomProviderValues {
  return Object.fromEntries(
    fields.map((field) => {
      const text = raw[field.id] ?? ''
      if (field.kind === 'list') return [field.id, listItems(text)]
      if (field.kind === 'secret') return [field.id, secretValue(text)]
      return [field.id, field.kind === 'select' ? text : text.trim()]
    }),
  )
}

/** Client-side hints only (required, URL scheme, pattern); Host re-validates everything. */
function check(fields: CustomProviderField[], values: CustomProviderValues): CustomProviderIssue[] {
  const issues: CustomProviderIssue[] = []
  for (const field of fields) {
    const value = values[field.id]
    const label = hostText(field.label)
    const empty = Array.isArray(value) ? value.length === 0 : !value
    if (empty) {
      if (field.required)
        issues.push({
          field: field.id,
          message: field.kind === 'select' ? t('请选择{label}', { label }) : t('请填写{label}', { label }),
        })
      continue
    }
    if (field.kind === 'url' && typeof value === 'string') {
      let scheme = ''
      try {
        scheme = new URL(value).protocol
      } catch {
        // Not an absolute address.
      }
      if (scheme !== 'http:' && scheme !== 'https:') {
        issues.push({ field: field.id, message: t('请填写以 http:// 或 https:// 开头的地址') })
        continue
      }
    }
    if (field.pattern && field.kind !== 'select') {
      let pattern: RegExp | undefined
      try {
        pattern = new RegExp(`^(?:${field.pattern})$`, 'u')
      } catch {
        // A pattern this browser cannot read is left to the Host.
      }
      const items = Array.isArray(value) ? value : [value]
      if (pattern && items.some((item) => !pattern.test(item)))
        issues.push({ field: field.id, message: t('{label}格式不正确', { label }) })
    }
  }
  return issues
}

/** Help that would otherwise be permanent small text: an info mark with a hover/focus tooltip. */
function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip label={text} side="top" portal maxWidth={280}>
      <span className="cwn-provider-help" tabIndex={0} role="img" aria-label={text}>
        <IconInfoOutlineRegular size={14} />
      </span>
    </Tooltip>
  )
}

function Field({
  field,
  id,
  value,
  issue,
  disabled,
  focusRef,
  onChange,
}: {
  field: CustomProviderField
  id: string
  value: string
  issue?: string
  disabled: boolean
  focusRef: (element: HTMLElement | null) => void
  onChange: (value: string) => void
}) {
  const [revealed, setRevealed] = useState(false)
  const label = hostText(field.label)
  const help = hostText(field.help)
  const placeholder = hostText(field.placeholder)
  const issueId = `${id}-issue`
  const control = {
    id,
    disabled,
    'aria-invalid': issue ? true : undefined,
    'aria-required': field.required || undefined,
    'aria-describedby': issue ? issueId : undefined,
  }
  let input
  if (field.kind === 'select')
    input = (
      <NativeChoice
        className="cwn-provider-choice"
        label={label}
        selected={value}
        placeholder={placeholder ?? t('请选择')}
        describedBy={issue ? issueId : undefined}
        disabled={disabled}
        choices={(field.options ?? []).map((option) => ({
          id: option.value,
          label: hostText(option.label),
          ...(option.detail ? { description: hostText(option.detail) } : {}),
        }))}
        onChange={onChange}
      />
    )
  else if (field.kind === 'list')
    input = (
      <textarea
        {...control}
        ref={focusRef}
        className="cwn-provider-textarea"
        value={value}
        rows={3}
        maxLength={field.maxLength}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder ?? t('每行一项')}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  else
    input = (
      <span className="cwn-provider-control" data-secret={field.kind === 'secret' || undefined}>
        <Input
          {...control}
          ref={focusRef}
          className="cwn-control-input cwn-provider-input"
          type={field.kind === 'secret' && !revealed ? 'password' : field.kind === 'url' ? 'url' : 'text'}
          inputMode={field.kind === 'url' ? 'url' : undefined}
          value={value}
          maxLength={field.maxLength}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.kind === 'secret' && (
          <Tooltip label={revealed ? t('隐藏') : t('显示')} side="top" portal>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cwn-provider-reveal"
              aria-label={revealed ? t('隐藏 {label}', { label }) : t('显示 {label}', { label })}
              aria-pressed={revealed}
              disabled={disabled}
              onClick={() => setRevealed((old) => !old)}
            >
              {revealed ? <IconEyeOffOutlineRegular size={16} /> : <IconEyeOutlineRegular size={16} />}
            </Button>
          </Tooltip>
        )}
      </span>
    )
  return (
    <div className="cwn-provider-field" data-invalid={issue ? true : undefined}>
      <div className="cwn-provider-label">
        {field.kind === 'select' ? <span>{label}</span> : <label htmlFor={id}>{label}</label>}
        {field.required && (
          <span className="cwn-provider-required" aria-hidden="true">
            *
          </span>
        )}
        {help && <HelpTip text={help} />}
      </div>
      {input}
      {issue && (
        <p id={issueId} className="cwn-provider-issue">
          {issue}
        </p>
      )}
    </div>
  )
}

/**
 * The provider form template: lead, fields, whole-form callout, and one right-aligned action row
 * (an optional native-terminal alternative on its left). After a successful save it shows the
 * login windows' result view with a single 「完成」.
 */
export function ProviderForm({
  form,
  submit,
  onBack,
  onDone,
  native,
  submitLabel,
}: {
  form: ProviderFormSpec
  submit: (values: CustomProviderValues, signal: AbortSignal) => Promise<ProviderFormOutcome>
  onBack: () => void
  onDone: () => void
  /** The CLI's own terminal as an alternative, e.g. 「在原生终端中配置」. */
  native?: { label: string; onStart: () => void }
  submitLabel?: string
}) {
  useT()
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(form.fields))
  const presets = usablePresets(form)
  const [preset, setPreset] = useState('')
  const [issues, setIssues] = useState<CustomProviderIssue[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ title: string; detail?: string }>()
  const controller = useRef<AbortController | undefined>(undefined)
  const controls = useRef(new Map<string, HTMLElement>())
  // Closing the window or going back unmounts the form: the save in flight is abandoned with it.
  useEffect(() => () => controller.current?.abort(), [])

  const known = new Set(form.fields.map((field) => field.id))
  const fieldIssue = (id: string) =>
    issues
      .filter((issue) => issue.field === id)
      .map((issue) => hostText(issue.message))
      .join(' ') || undefined
  const formIssues = issues.filter((issue) => !issue.field || !known.has(issue.field))

  const focusFirst = (found: CustomProviderIssue[]) => {
    const first = form.fields.find((field) => found.some((issue) => issue.field === field.id))
    const element = first && controls.current.get(first.id)
    if (element && typeof element.focus === 'function') element.focus()
  }

  const onSubmit = async () => {
    if (saving) return
    const collected = collect(form.fields, values)
    const local = check(form.fields, collected)
    if (local.length) {
      setIssues(local)
      focusFirst(local)
      return
    }
    const request = new AbortController()
    controller.current = request
    setSaving(true)
    setIssues([])
    let outcome: ProviderFormOutcome
    try {
      outcome = await submit(collected, request.signal)
    } catch (error) {
      outcome = { ok: false, issues: [{ message: operationMessage(error) }] }
    }
    if (request.signal.aborted) return
    controller.current = undefined
    setSaving(false)
    if (outcome.ok) {
      // Nothing typed outlives a successful save.
      setValues(initialValues(form.fields))
      setPreset('')
      setSaved({ title: outcome.title, ...(outcome.detail ? { detail: outcome.detail } : {}) })
      return
    }
    const found = outcome.issues.length ? outcome.issues : [{ message: t('保存失败，请检查后重试') }]
    setIssues(found)
    focusFirst(found)
  }

  if (saved)
    return (
      <div className="cwn-accounts-window cwn-provider-form">
        <Result tone="success" title={saved.title} detail={saved.detail}>
          <Button type="button" variant="primary" size="md" onClick={onDone}>
            {t('完成')}
          </Button>
        </Result>
      </div>
    )

  const title = hostText(form.title)
  const description = hostText(form.description)
  return (
    <form
      className="cwn-accounts-window cwn-provider-form"
      noValidate
      autoComplete="off"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <div className="cwn-accounts-lead">
        <strong className="cwn-provider-title">
          {title}
          {form.target && <HelpTip text={t('保存到 {target}', { target: form.target })} />}
        </strong>
        {description && <span>{description}</span>}
      </div>
      {formIssues.length > 0 && (
        <p className="cwn-login-callout" data-tone="error" role="alert">
          <span>{formIssues.map((issue) => hostText(issue.message)).join(' ')}</span>
        </p>
      )}
      <div className="cwn-provider-fields">
        {presets.length > 0 && (
          <Field
            field={{
              id: 'preset',
              label: t('从内置模板预填'),
              kind: 'select',
              placeholder: t('不使用模板'),
              help: t('选择后填入名称、接口类型、Base URL 和模型 ID，可再修改；API Key 仍需自己填写。'),
              options: presets.map((item) => ({ value: item.id, label: item.label })),
            }}
            id={`cwn-provider-${base}-preset`}
            value={preset}
            disabled={saving}
            focusRef={() => undefined}
            onChange={(next) => {
              setPreset(next)
              const chosen = presets.find((item) => item.id === next)
              if (!chosen) return
              const filled = presetValues(form.fields, chosen)
              setValues((old) => ({ ...old, ...filled }))
              setIssues((old) => old.filter((issue) => !issue.field || !Object.hasOwn(filled, issue.field)))
            }}
          />
        )}
        {form.fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            id={`cwn-provider-${base}-${field.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
            value={values[field.id] ?? ''}
            issue={fieldIssue(field.id)}
            disabled={saving}
            focusRef={(element) => {
              if (element) controls.current.set(field.id, element)
              else controls.current.delete(field.id)
            }}
            onChange={(next) => {
              setValues((old) => ({ ...old, [field.id]: next }))
              setIssues((old) => (old.some((issue) => issue.field === field.id) ? old.filter((issue) => issue.field !== field.id) : old))
            }}
          />
        ))}
      </div>
      <div className="cwn-accounts-actions cwn-provider-actions">
        {native && (
          <Button type="button" variant="outline" size="md" className="cwn-provider-native" disabled={saving} onClick={native.onStart}>
            {native.label}
          </Button>
        )}
        <Button type="button" variant="ghost" size="md" disabled={saving} onClick={onBack}>
          {t('返回')}
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={saving}>
          {saving ? t('正在保存…') : (submitLabel ?? t('保存'))}
        </Button>
      </div>
    </form>
  )
}
