import { useEffect, useId, useRef, useState } from 'react'
import { Button, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  LANGUAGE_PREFERENCES,
  MAX_CONCURRENT_LIMIT,
  MAX_TASK_TIME_LIMIT_MS,
  TASK_TIME_LIMIT_CHOICES,
  IDLE_TIME_LIMIT_CHOICES,
  type GeneralSettings,
  type LanguagePreference,
} from '../shared/cli-settings.ts'
import { BrandIcon } from './icons.tsx'
import { NativeChoice } from './native-settings-choice.tsx'
import { operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
import { setLanguagePreference, t, useT, type MessageKey } from './i18n.ts'

function readSettings(raw: string): GeneralSettings {
  const next = JSON.parse(raw)
  const count = (input: unknown) =>
    Number.isInteger(input) && (input as number) >= 1 && (input as number) <= MAX_CONCURRENT_LIMIT
  // Absent fields are an older Host's defaults (`follow`, off, asking, 30 minutes, no idle limit); any other value is rejected.
  const language = next?.language ?? 'follow'
  const isolatedParallelWrites = next?.isolatedParallelWrites ?? false
  const askBeforeDispatch = next?.askBeforeDispatch ?? true
  const taskTimeLimitMs = next?.taskTimeLimitMs === undefined ? 1_800_000 : next.taskTimeLimitMs
  const defaultTaskTimeLimitMs = next?.defaultTaskTimeLimitMs === undefined ? 1_800_000 : next.defaultTaskTimeLimitMs
  const idleTimeLimitMs = next?.idleTimeLimitMs === undefined ? 0 : next.idleTimeLimitMs
  const duration = (input: unknown, minimum: number) =>
    Number.isInteger(input) && (input as number) >= minimum && (input as number) <= MAX_TASK_TIME_LIMIT_MS
  if (
    !count(next?.maxConcurrent) ||
    !count(next?.defaultMaxConcurrent) ||
    !LANGUAGE_PREFERENCES.includes(language) ||
    typeof isolatedParallelWrites !== 'boolean' ||
    typeof askBeforeDispatch !== 'boolean' ||
    !duration(taskTimeLimitMs, 1000) ||
    !duration(defaultTaskTimeLimitMs, 1000) ||
    (idleTimeLimitMs !== 0 && !duration(idleTimeLimitMs, 60_000))
  )
    throw new Error(t('收到无效的通用设置，请重试'))
  return { ...next, language, isolatedParallelWrites, askBeforeDispatch, taskTimeLimitMs, defaultTaskTimeLimitMs, idleTimeLimitMs }
}

type Field = 'language' | 'maxConcurrent' | 'isolatedParallelWrites' | 'askBeforeDispatch' | 'taskTimeLimitMs' | 'idleTimeLimitMs'
const SAVING: Record<Field, MessageKey> = {
  language: '正在保存界面语言…',
  maxConcurrent: '正在保存同时对话数…',
  isolatedParallelWrites: '正在保存同目录写任务并行…',
  askBeforeDispatch: '正在保存调用前询问模型…',
  taskTimeLimitMs: '正在保存总时限…',
  idleTimeLimitMs: '正在保存空闲时限…',
}
const UNSAVED: Record<Field, MessageKey> = {
  language: '界面语言未保存，请重新选择重试',
  maxConcurrent: '同时对话数未保存，请重新选择重试',
  isolatedParallelWrites: '同目录写任务并行未保存，请重试',
  askBeforeDispatch: '调用前询问模型未保存，请重试',
  taskTimeLimitMs: '总时限未保存，请重新选择重试',
  idleTimeLimitMs: '空闲时限未保存，请重新选择重试',
}
// Each language is named in itself, so the choice stays findable after a switch.
const LANGUAGE_LABELS: Record<LanguagePreference, () => string> = {
  follow: () => t('跟随 DSH'),
  zh: () => '中文',
  en: () => 'English',
}

/** Profile-wide plugin settings; each section owns its own save feedback. */
export function GeneralSettingsPane({ api, sessionId }: { api: API; sessionId: string }) {
  const t = useT()
  const [settings, setSettings] = useState<GeneralSettings>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Field>()
  const [error, setError] = useState<{ field?: Field; message: string }>()
  const [attempt, retry] = useState(0)
  const languageHintId = useId()
  const hintId = useId()
  const isolationHintId = useId()
  const askHintId = useId()
  const taskTimeHintId = useId()
  const idleTimeHintId = useId()
  const request = useRef<AbortController>()
  const service = api.cliworker

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const next = readSettings(value(await service.generalSettings(sessionId, controller.signal)))
        if (controller.signal.aborted) return
        setSettings(next)
        setLanguagePreference(next.language)
      } catch (error) {
        if (!controller.signal.aborted) setError({ message: operationMessage(error) })
      } finally {
        if (request.current === controller) {
          request.current = undefined
          setLoading(false)
        }
      }
    })()
    return () => controller.abort()
  }, [service, sessionId, attempt])

  async function save<K extends Field>(field: K, next: GeneralSettings[K]) {
    if (!settings || request.current || next === settings[field]) return
    const controller = new AbortController()
    request.current = controller
    setSaving(field)
    setError(undefined)
    try {
      const updated = readSettings(
        value(await service.saveGeneralSettings(sessionId, JSON.stringify({ [field]: next }), controller.signal)),
      )
      if (controller.signal.aborted) return
      if (updated[field] !== next) throw new Error(t(UNSAVED[field]))
      setSettings(updated)
      // Switch the whole plugin at once; other windows follow through the Worker stream.
      if (field === 'language') setLanguagePreference(updated.language)
    } catch (error) {
      if (!controller.signal.aborted) setError({ field, message: operationMessage(error) })
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setSaving(undefined)
      }
    }
  }

  // A saved choice shows in its own control; only progress and failures get a line.
  const feedback = (field: Field) =>
    (saving === field || error?.field === field) && (
      <div className="cwn-settings-save">
        <span className="cwn-settings-feedback-slot" role="status">
          {saving === field && <StateDot state="ongoing" size={14} />}
          {error?.field === field ? error.message : t(SAVING[field])}
        </span>
      </div>
    )
  const progress = (
    <span className="cwn-section-progress" role="status" aria-label={loading ? t('正在读取通用设置') : undefined}>
      {loading && <StateDot state="ongoing" size={14} />}
    </span>
  )
  const disabled = loading || !!saving || !settings
  const placeholder = loading ? t('正在读取…') : undefined
  const choices = Array.from({ length: MAX_CONCURRENT_LIMIT }, (_, index) => {
    const count = index + 1
    return {
      id: String(count),
      label: count === settings?.defaultMaxConcurrent ? t('{count}（默认）', { count }) : String(count),
    }
  })
  const taskTimeLabel = (ms: number) => {
    if (ms === MAX_TASK_TIME_LIMIT_MS) return t('不限制（最长 24 小时）')
    if (ms % 3_600_000 === 0) return t('{count} 小时', { count: ms / 3_600_000 })
    if (ms % 60_000 === 0) return t('{count} 分钟', { count: ms / 60_000 })
    return t('{count} 秒', { count: Math.ceil(ms / 1000) })
  }
  const taskTimeChoices = [...new Set([
    ...TASK_TIME_LIMIT_CHOICES,
    ...(settings ? [settings.defaultTaskTimeLimitMs, settings.taskTimeLimitMs] : []),
  ])].sort((a, b) => a - b).map((ms) => ({
    id: String(ms),
    label: ms === settings?.defaultTaskTimeLimitMs ? t('{label}（默认）', { label: taskTimeLabel(ms) }) : taskTimeLabel(ms),
  }))
  const idleTimeChoices = [...new Set([
    ...IDLE_TIME_LIMIT_CHOICES,
    ...(settings ? [settings.idleTimeLimitMs] : []),
  ])].sort((a, b) => a - b).map((ms) => ({
    id: String(ms),
    // 「关闭」 already names the Close button, so the off choice has its own key.
    label: ms === 0 ? t('不启用') : t('{count} 分钟', { count: Math.ceil(ms / 60_000) }),
  }))
  return (
    <div className="cwn-settings-pane" aria-label={t('CLI Worker 通用设置')}>
      <div className="cwn-cli-identity">
        <div className="cwn-settings-cli-name">
          <BrandIcon size={40} />
          <div>
            <h2>{t('CLI Worker 设置')}</h2>
            <p className="cwn-cli-subtitle">{t('适用于所有 CLI 与对话')}</p>
          </div>
        </div>
      </div>
      <section className="cwn-settings-section" aria-label={t('语言')}>
        <div className="cwn-settings-section-head">
          <h3>{t('语言')}</h3>
          <div className="cwn-settings-section-tools">{progress}</div>
        </div>
        <div className="cwn-settings-form">
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('界面语言')}</span>
              <span className="cwn-setting-description" id={languageHintId}>
                {t('跟随 DSH 时与 DeepSeek Harness 当前语言一致；只影响 CLI Worker 界面。')}
              </span>
            </span>
            <NativeChoice
              label={t('界面语言')}
              describedBy={languageHintId}
              selected={settings?.language ?? ''}
              placeholder={placeholder ?? t('选择语言')}
              choices={LANGUAGE_PREFERENCES.map((id) => ({ id, label: LANGUAGE_LABELS[id]() }))}
              disabled={disabled}
              onChange={(language) => void save('language', language as LanguagePreference)}
            />
          </div>
          {feedback('language')}
        </div>
      </section>
      <section className="cwn-settings-section" aria-label={t('任务调度')}>
        <div className="cwn-settings-section-head">
          <h3>{t('任务调度')}</h3>
        </div>
        <div className="cwn-settings-form">
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('最高同时对话数')}</span>
              <span className="cwn-setting-description" id={hintId}>
                {t('所有 CLI 共用；超出后新任务排队。调低不会中断进行中的任务。')}
              </span>
            </span>
            <NativeChoice
              label={t('最高同时对话数')}
              describedBy={hintId}
              selected={settings ? String(settings.maxConcurrent) : ''}
              placeholder={placeholder ?? t('选择数量')}
              choices={choices}
              disabled={disabled}
              onChange={(count) => void save('maxConcurrent', Number(count))}
            />
          </div>
          {feedback('maxConcurrent')}
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('同目录写任务并行')}</span>
              <span className="cwn-setting-description" id={isolationHintId}>
                {t('在项目副本中同时运行，完成后由主 Agent 合并回项目')}
              </span>
            </span>
            <Switch
              checked={settings?.isolatedParallelWrites ?? false}
              onChange={(enabled) => void save('isolatedParallelWrites', enabled)}
              label={t('同目录写任务并行')}
              disabled={disabled}
            />
          </div>
          {feedback('isolatedParallelWrites')}
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('调用前询问模型')}</span>
              <span className="cwn-setting-description" id={askHintId}>
                {t('关闭后新对话直接使用项目的默认模型、强度与上次确认的角色；无有效设定时仍会询问')}
              </span>
            </span>
            <Switch
              checked={settings?.askBeforeDispatch ?? true}
              onChange={(enabled) => void save('askBeforeDispatch', enabled)}
              label={t('调用前询问模型')}
              disabled={disabled}
            />
          </div>
          {feedback('askBeforeDispatch')}
          {error && !error.field && (
            <div className="cwn-settings-save">
              <span className="cwn-settings-feedback-slot" role="status">
                {error.message}
              </span>
              {!settings && (
                <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => retry((old) => old + 1)}>
                  {t('重试读取通用设置')}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="cwn-settings-section" aria-label={t('任务时限')}>
        <div className="cwn-settings-section-head">
          <h3>{t('任务时限')}</h3>
        </div>
        <div className="cwn-settings-form">
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('总时限')}</span>
              <span className="cwn-setting-description" id={taskTimeHintId}>
                {t('从任务开始计时，到时停止任务；修改只影响之后开始的任务')}
              </span>
            </span>
            <NativeChoice
              label={t('总时限')}
              describedBy={taskTimeHintId}
              selected={settings ? String(settings.taskTimeLimitMs) : ''}
              placeholder={placeholder ?? t('总时限')}
              choices={taskTimeChoices}
              disabled={disabled}
              onChange={(id) => void save('taskTimeLimitMs', Number(id))}
            />
          </div>
          {feedback('taskTimeLimitMs')}
          <div className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('空闲时限')}</span>
              <span className="cwn-setting-description" id={idleTimeHintId}>
                {t('CLI 连续这段时间没有任何事件（回复、工具、思考）时停止任务')}
              </span>
            </span>
            <NativeChoice
              label={t('空闲时限')}
              describedBy={idleTimeHintId}
              selected={settings ? String(settings.idleTimeLimitMs) : ''}
              placeholder={placeholder ?? t('空闲时限')}
              choices={idleTimeChoices}
              disabled={disabled}
              onChange={(id) => void save('idleTimeLimitMs', Number(id))}
            />
          </div>
          {feedback('idleTimeLimitMs')}
        </div>
      </section>
    </div>
  )
}
