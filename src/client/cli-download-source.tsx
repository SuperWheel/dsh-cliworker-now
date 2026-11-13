import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CLI_DOWNLOAD_SOURCES,
  NPMMIRROR_REGISTRY,
  OFFICIAL_NPM_REGISTRY,
  customRegistryProblem,
  type CliDownloadSource,
  type CliDownloadSourceSettings,
  type CliDownloadSourceTest,
} from '../shared/cli-management.ts'
import { NativeChoice } from './native-settings-choice.tsx'
import { hostText, operationMessage } from './operation-error.ts'
import { useT } from './i18n.ts'
import { value, type API } from './workers.ts'

/**
 * Styles owned by the settings integration of the 「更新 CLI」 page: the navigation badge,
 * two-line menu choices and the 「下载源」 row. Injected next to `settingsStyles`.
 */
export const cliUpdateSettingsStyles = `
.cwn-settings-nav-badge{flex:none;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:var(--dsw-font-xxs-12-font-size);line-height:18px;font-weight:500;text-align:center;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.cwn-settings-choice-text{display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left;white-space:normal}.cwn-settings-choice-text>span:first-child{font-size:var(--cwn-settings-label-size,14px);line-height:var(--cwn-settings-label-line,22px)}.cwn-settings-choice-description{font-size:var(--cwn-settings-description-size,12px);line-height:var(--cwn-settings-description-line,18px);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-settings-choice.cwn-download-source-choice{width:auto;min-width:208px;max-width:48%}
.cwn-download-source[data-supported=false] .cwn-setting-row-text>span:first-child{color:var(--dsw-alias-label-caption)}
.cwn-download-source-custom{display:flex;flex-direction:column;gap:var(--cwn-settings-action-gap);padding-bottom:var(--cwn-settings-row-padding);min-width:0}
.cwn-download-source-label{font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-secondary)}
.cwn-download-source-input{width:100%;min-width:0;height:var(--cwn-settings-control-height);border-radius:12px;padding:0 12px}
.cwn-download-source-hint{margin:0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cwn-download-source-hint[data-problem=true],.cwn-download-source-result[data-state=failed]{color:var(--dsw-alias-state-error-primary)}
.cwn-download-source-actions{display:flex;align-items:center;justify-content:space-between;gap:var(--cwn-settings-action-gap);flex-wrap:wrap}
.cwn-download-source-actions>button{margin-left:auto}
.cwn-download-source-result{display:flex;align-items:center;gap:6px;min-width:0;font-size:var(--cwn-settings-description-size);line-height:var(--cwn-settings-description-line);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.cwn-download-source-result[data-state=testing]{color:var(--dsw-alias-label-tertiary)}
.cwn-download-source-result>.cwn-connection-dot{flex:none}
`

/** `registry.npmjs.org` style text for an https registry; other text is shown unchanged. */
export function registryHost(url: string): string {
  return url.trim().replace(/^https:\/\//i, '').replace(/\/+$/, '')
}

function readSource(raw: string, t: ReturnType<typeof useT>): CliDownloadSourceSettings {
  const next = JSON.parse(raw)
  if (
    !(CLI_DOWNLOAD_SOURCES as readonly unknown[]).includes(next?.source) ||
    (next.customUrl !== undefined && typeof next.customUrl !== 'string') ||
    (next.followRegistry !== undefined && typeof next.followRegistry !== 'string')
  )
    throw new Error(t('收到无效的下载源设置，请重试'))
  return next
}
function readTest(raw: string, t: ReturnType<typeof useT>): CliDownloadSourceTest {
  const next = JSON.parse(raw)
  if (
    typeof next?.ok !== 'boolean' ||
    (next.elapsedMs !== undefined && (typeof next.elapsedMs !== 'number' || !Number.isFinite(next.elapsedMs))) ||
    (next.message !== undefined && typeof next.message !== 'string')
  )
    throw new Error(t('无法连接这个源'))
  return next
}

type TestState = { kind: 'testing' } | { kind: 'done'; result: CliDownloadSourceTest }

/** 「下载设置」分区内容（不含分区标题行，标题与折叠按钮由页面统一渲染）。 */
export function CliDownloadSourceSection({ api, sessionId }: { api: API; sessionId: string }) {
  const t = useT()
  const service = api.cliworker
  const supported = !!service.cliDownloadSource && !!service.saveCliDownloadSource
  const [settings, setSettings] = useState<CliDownloadSourceSettings>()
  /** The visible choice; differs from `settings.source` only while a custom address is not saved yet. */
  const [mode, setMode] = useState<CliDownloadSource>()
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(supported)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ read?: boolean; message: string }>()
  const [test, setTest] = useState<TestState>()
  const [attempt, retry] = useState(0)
  const [focusCustom, setFocusCustom] = useState(false)
  const hintId = useId()
  const inputId = useId()
  const customHintId = useId()
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController>()
  const testRequest = useRef<AbortController>()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const next = readSource(value(await service.cliDownloadSource!(sessionId, controller.signal)), t)
        if (controller.signal.aborted) return
        setSettings(next)
        setMode(next.source)
        setDraft(next.customUrl ?? '')
      } catch (error) {
        if (!controller.signal.aborted) setError({ read: true, message: operationMessage(error) })
      } finally {
        if (request.current === controller) {
          request.current = undefined
          setLoading(false)
        }
      }
    })()
    return () => controller.abort()
    // `t` changes with the language; a language switch must not re-read the setting.
  }, [service, sessionId, supported, attempt])
  useEffect(() => () => testRequest.current?.abort(), [])
  useEffect(() => {
    if (!focusCustom) return
    setFocusCustom(false)
    input.current?.focus()
  }, [focusCustom])

  async function save(next: { source: CliDownloadSource; customUrl?: string }) {
    if (!settingsRef.current || request.current) return
    const previous = settingsRef.current
    const controller = new AbortController()
    request.current = controller
    setSaving(true)
    setError(undefined)
    try {
      const updated = readSource(
        value(await service.saveCliDownloadSource!(sessionId, JSON.stringify(next), controller.signal)),
        t,
      )
      if (controller.signal.aborted) return
      if (updated.source !== next.source || (next.customUrl !== undefined && updated.customUrl !== next.customUrl))
        throw new Error(t('下载源未保存，请重试'))
      setSettings(updated)
      setMode(updated.source)
    } catch (error) {
      if (controller.signal.aborted) return
      setError({ message: operationMessage(error) })
      // A preset choice falls back to the saved one; a custom address stays editable to fix and retry.
      if (next.source !== 'custom') setMode(previous.source)
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setSaving(false)
      }
    }
  }

  const trimmed = draft.trim()
  const problem = trimmed ? customRegistryProblem(trimmed) : undefined
  function commitCustom() {
    if (!trimmed || problem || saving) return
    const saved = settingsRef.current
    if (saved?.source === 'custom' && saved.customUrl === trimmed) return
    void save({ source: 'custom', customUrl: trimmed })
  }
  function choose(id: string) {
    const source = id as CliDownloadSource
    if (source === mode) return
    setError(undefined)
    if (source !== 'custom') {
      setMode(source)
      void save({ source })
      return
    }
    setMode('custom')
    const saved = settingsRef.current?.customUrl ?? ''
    const url = trimmed || saved
    setDraft(url)
    setTest(undefined)
    if (url && !customRegistryProblem(url)) void save({ source: 'custom', customUrl: url.trim() })
    else setFocusCustom(true)
  }
  async function testConnection() {
    if (!service.testCliDownloadSource || !trimmed || problem) return
    testRequest.current?.abort()
    const controller = new AbortController()
    testRequest.current = controller
    setTest({ kind: 'testing' })
    try {
      const result = readTest(value(await service.testCliDownloadSource(sessionId, trimmed, controller.signal)), t)
      if (!controller.signal.aborted) setTest({ kind: 'done', result })
    } catch (error) {
      if (!controller.signal.aborted) setTest({ kind: 'done', result: { ok: false, message: operationMessage(error) } })
    } finally {
      if (testRequest.current === controller) testRequest.current = undefined
    }
  }

  const follow = settings?.followRegistry
  const choices = [
    {
      id: 'follow',
      label: t('跟随 npm 设置'),
      description: follow
        ? t('使用这台电脑 npm 配置里的源，当前是 {registry}', { registry: registryHost(follow) })
        : t('使用这台电脑 npm 配置里的源'),
    },
    { id: 'official', label: t('npm 官方源'), description: registryHost(OFFICIAL_NPM_REGISTRY) },
    { id: 'npmmirror', label: t('国内镜像'), description: `npmmirror · ${registryHost(NPMMIRROR_REGISTRY)}` },
    {
      id: 'custom',
      label: t('自定义地址…'),
      buttonLabel: t('自定义地址'),
      description: t('公司内部源或其他镜像'),
      separatorBefore: true,
    },
  ]
  const disabled = !supported || loading || saving || !settings
  const result = test?.kind === 'done' ? test.result : undefined
  return (
    <div className="cwn-settings-form cwn-download-source" data-supported={supported}>
      <div className="cwn-setting-row">
        <span className="cwn-setting-row-text">
          <span>{t('下载源')}</span>
          <span className="cwn-setting-description" id={hintId}>
            {supported
              ? t('npm 包从哪里下载。官方安装脚本、Homebrew 和桌面安装包不受影响')
              : t('插件服务尚未支持切换下载源，请重启 DeepSeek Harness 后重试')}
          </span>
        </span>
        <NativeChoice
          label={t('下载源')}
          describedBy={hintId}
          className="cwn-download-source-choice"
          menuWidth={360}
          selected={mode ?? ''}
          placeholder={loading ? t('正在读取…') : t('下载源')}
          choices={choices}
          disabled={disabled}
          onChange={choose}
        />
      </div>
      {supported && mode === 'custom' && (
        <div className="cwn-download-source-custom">
          <label className="cwn-download-source-label" htmlFor={inputId}>
            {t('源地址')}
          </label>
          <Input
            ref={input}
            id={inputId}
            className="cwn-control-input cwn-download-source-input"
            aria-describedby={customHintId}
            aria-invalid={problem ? true : undefined}
            value={draft}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            placeholder="https://npm.example.com/"
            onChange={(event) => {
              setDraft(event.target.value)
              setTest(undefined)
              setError(undefined)
            }}
            onBlur={commitCustom}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitCustom()
            }}
          />
          <p className="cwn-download-source-hint" id={customHintId} data-problem={!!problem}>
            {problem ? hostText(problem) : t('只支持 https，地址里不能带用户名或密码')}
          </p>
          <div className="cwn-download-source-actions">
            {test && (
              <span
                className="cwn-download-source-result"
                role="status"
                data-state={test.kind === 'testing' ? 'testing' : result?.ok ? 'connected' : 'failed'}
              >
                {test.kind === 'testing' ? (
                  <>
                    <StateDot state="ongoing" size={12} />
                    {t('正在检查连接…')}
                  </>
                ) : result?.ok ? (
                  <>
                    <span className="cwn-connection-dot" data-state="connected" />
                    {result.elapsedMs === undefined
                      ? t('连接正常')
                      : t('连接正常 · {seconds} 秒', { seconds: (result.elapsedMs / 1000).toFixed(1) })}
                  </>
                ) : (
                  hostText(result?.message) || t('无法连接这个源')
                )}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!service.testCliDownloadSource || !trimmed || !!problem || test?.kind === 'testing'}
              onClick={() => void testConnection()}
            >
              {t('检查连接')}
            </Button>
          </div>
        </div>
      )}
      {(saving || error) && (
        <div className="cwn-settings-save">
          <span className="cwn-settings-feedback-slot" role="status">
            {saving && <StateDot state="ongoing" size={14} />}
            {error ? error.message : t('正在保存下载源…')}
          </span>
          {error?.read && (
            <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => retry((old) => old + 1)}>
              {t('重新读取下载源')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
