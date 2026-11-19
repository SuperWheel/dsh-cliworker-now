import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { agentNameProblem, DSH_AGENT_NAME_MAX } from '../shared/agent-names.ts'
import { workerName, type Worker } from '../shared/types.ts'
import { hostText, operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
import { useT } from './i18n.ts'

export function RenameWorker({
  api,
  sessionId,
  worker,
  mode = 'name',
  onClose,
}: {
  api: API
  sessionId: string
  worker: Worker
  mode?: 'name' | 'title'
  onClose: () => void
}) {
  const titleMode = mode === 'title'
  return (
    <RenameDialog
      mode={titleMode ? 'title' : 'worker-name'}
      initialName={titleMode ? worker.title : workerName(worker)}
      onSave={(name, signal) =>
        titleMode
          ? api.cliworker.renameWorkerTitle(sessionId, worker.id, name, signal)
          : api.cliworker.renameWorker(sessionId, worker.id, name, signal)
      }
      onClose={onClose}
    />
  )
}

export function RenameDialog({
  mode,
  initialName,
  onSave,
  onClose,
}: {
  mode: 'worker-name' | 'dsh-name' | 'title'
  initialName: string
  onSave: (name: string, signal: AbortSignal) => Promise<RemoteResult<void>>
  onClose: () => void
}) {
  const t = useT()
  const titleMode = mode === 'title'
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [validateName, setValidateName] = useState(false)
  const problem = titleMode ? undefined : agentNameProblem(name)
  const feedback = validateName && problem ? hostText(problem) : error
  const descriptionId = useId()
  const errorId = useId()
  const pending = useRef<AbortController>()
  useEffect(() => () => pending.current?.abort(), [])
  const close = () => {
    pending.current?.abort()
    pending.current = undefined
    onClose()
  }
  const save = async () => {
    if (pending.current) return
    if (problem) {
      setValidateName(true)
      return
    }
    const candidate = titleMode ? name.trim() : name
    if (!candidate) {
      setError(t('请输入聊天标题。'))
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setSaving(true)
    setError('')
    try {
      const result = await onSave(candidate, controller.signal)
      if (controller.signal.aborted) return
      if (!titleMode && !result.ok) {
        setError(result.error.message)
        return
      }
      value(result)
      onClose()
    } catch (e) {
      if (!controller.signal.aborted) setError(operationMessage(e))
    } finally {
      if (!controller.signal.aborted) {
        pending.current = undefined
        setSaving(false)
      }
    }
  }
  return (
    <Modal
      open
      onClose={close}
      title={titleMode ? t('聊天标题') : t('智能体名称')}
      closeLabel={titleMode ? t('关闭聊天标题编辑') : t('关闭智能体命名')}
      className="cwn-rename-dialog"
      contentClassName="cwn-rename-content"
    >
      <form
        className="cwn-rename-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Input
          className="cwn-control-input cwn-rename-input"
          aria-label={titleMode ? t('新的聊天标题') : t('新的智能体名称')}
          data-modal-autofocus
          value={name}
          maxLength={titleMode ? 160 : DSH_AGENT_NAME_MAX}
          disabled={saving}
          aria-invalid={!titleMode && !!feedback ? true : undefined}
          aria-describedby={
            !titleMode ? (feedback ? `${descriptionId} ${errorId}` : descriptionId) : undefined
          }
          onChange={(event) => {
            setName(event.target.value)
            if (!titleMode) {
              setValidateName(true)
              setError('')
            }
          }}
        />
        {mode === 'worker-name' && <p>{t('之后可在主对话中通过这个名字继续调用。')}</p>}
        {!titleMode && (
          <p id={descriptionId}>
            {mode === 'worker-name'
              ? t(
                  '只改名称：子会话、历史和运行中的任务不变；改名前的名称仍可用于续聊，且不能再给其他子 Agent 使用。DSH 中未接入的界面（如团队看板）可能仍显示原名。',
                )
              : t('仅修改显示名：DSH 中该子 Agent 的身份提示和发出消息的署名仍是原名。')}
          </p>
        )}
        {feedback && (
          <div id={errorId} className="cwn-rename-error" role="alert">
            {feedback}
          </div>
        )}
        <div className="cwn-rename-actions">
          <Button type="button" size="md" variant="outline" onClick={close}>
            {t('取消')}
          </Button>
          <Button type="submit" size="md" variant="primary" disabled={saving}>
            {saving && <StateDot state="ongoing" size={14} />}
            {titleMode ? t('保存标题') : t('保存名称')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
