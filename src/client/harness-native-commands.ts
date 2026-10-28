import type { Context } from '@deepseek-ai/cordis'
import type { InboxWireState } from '@deepseek-ai/dsh-agent/types'
import type {
  ClientSessionContext,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  IconBranchOutlineRegular,
  IconDataOutlineRegular,
  IconGoalOutlineRegular,
  IconPaperPlaneOutlineRegular,
  IconPlanOutlineRegular,
  PermissionIconFullAccessRegular,
  rankByName,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PopupSelectController,
  SelectOption,
  TokenSegment,
} from '@deepseek-ai/dsh-client-ui-commands/client'
import {
  active,
  cliOf,
  CLI_LABELS,
  type ModelChoice,
  type Preference,
  type TaskMode,
  type Worker,
  type WorkerLevel,
} from '../shared/types.ts'
import type { WorkerPermissionState } from '../shared/worker-permissions.ts'
import { visibleModelChoices } from '../shared/model-presentation.ts'
import type { HarnessBindingRegistry, HarnessNativeBinding } from './harness-binding-registry.ts'
import { value, type API, type Snapshot } from './workers.ts'
import type { installHarnessNativeAttachments } from './harness-native-attachments.ts'
import { harnessFeatureReason } from './harness-feature-support.ts'
import { openHarnessWorkerGoal } from './harness-goal-editor.ts'
import { effortLabel, languagePreference, t } from './i18n.ts'
import { hostText } from './operation-error.ts'

type Command = 'model' | 'permission' | 'plan' | 'goal' | 'feedback' | 'fork'
type SettingCommand = 'model' | 'permission' | 'plan'
export interface HarnessCommandFeatures {
  openFeedback?: (sessionId: string) => void
  fork?: (sessionId: string) => void
  forkReason?: (sessionId: string) => string | undefined
}
type OwnedBinding = HarnessNativeBinding & { workerId: string }
type CommandContext = Pick<Context, 'sessions' | 'inputTriggers' | 'commandUi'>
export const HARNESS_COMMAND_SOURCE = 'cliworker-settings'
export type HarnessCommandServices = Pick<Context, 'sessions' | 'inputTriggers'>
// Capture service faces only from the scope declaring their injection. React
// renderers may live in an outer scope that must never read those properties.
const installedSources = new WeakMap<HarnessBindingRegistry, HarnessCommandServices>()
const sourceListeners = new WeakMap<HarnessBindingRegistry, Set<() => void>>()
export const harnessNativeCommandServices = (bindings: HarnessBindingRegistry) =>
  installedSources.get(bindings)
export function subscribeHarnessNativeCommands(bindings: HarnessBindingRegistry, listener: () => void) {
  let listeners = sourceListeners.get(bindings)
  if (!listeners) sourceListeners.set(bindings, (listeners = new Set()))
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function publishCommandServices(bindings: HarnessBindingRegistry, services?: HarnessCommandServices) {
  if (services) installedSources.set(bindings, services)
  else installedSources.delete(bindings)
  for (const listener of sourceListeners.get(bindings) ?? []) listener()
}
// Native '/' menu faces: the same rows, glyphs and section order as DSH's own
// command menu (ui-commands presentation and ui-model-selection), so a CLI child
// reads like the root composer. Fork is CLI-only and closes the Commands section.
const commands = [
  { name: 'goal', label: '目标', section: 'add', icon: IconGoalOutlineRegular, description: '设置或编辑当前 CLI 的目标' },
  { name: 'plan', label: '计划', section: 'add', icon: IconPlanOutlineRegular, description: '切换当前 CLI 的计划模式' },
  { name: 'feedback', label: '反馈', section: 'add', icon: IconPaperPlaneOutlineRegular, description: '向当前 Harness 子会话提交反馈' },
  { name: 'permission', label: '权限', section: 'commands', icon: PermissionIconFullAccessRegular, description: '选择当前 CLI 的权限模式' },
  { name: 'model', label: '模型', section: 'commands', icon: IconDataOutlineRegular, description: '选择当前 CLI 的模型和思考强度' },
  { name: 'fork', label: '分支', section: 'commands', icon: IconBranchOutlineRegular, description: '从最新完成轮创建 CLI 子会话分支' },
] as const
const commandOf = (text: string) =>
  commands.find((command) => command.name === text || command.label === text || t(command.label) === text || (text === '规划' && command.name === 'plan'))
type Translate = (key: string) => string
/** The native `command` dictionary's section headings, so the language follows DSH. */
function sectionTitles(ctx: unknown) {
  // An explicit plugin language overrides DSH's own headings.
  if (languagePreference() !== 'follow') return { add: t('添加'), commands: t('指令') }
  const locale = (ctx as { get?(name: 'locale'): { bind(ns: string): Translate } | undefined }).get?.('locale')
  const native = locale?.bind('command')
  const title = (key: string, fallback: string) => {
    const text = native?.(key)
    return text && text !== key ? text : fallback
  }
  return { add: title('section.add', t('添加')), commands: title('section.commands', t('指令')) }
}
const sameBinding = (left: HarnessNativeBinding | undefined, right: OwnedBinding) =>
  left?.sessionId === right.sessionId &&
  left.parentSessionId === right.parentSessionId &&
  left.workerId === right.workerId

/** One bounded read through the same Gateway stream used by the Worker view. */
async function snapshotFor(api: API, binding: OwnedBinding, signal: AbortSignal): Promise<Snapshot> {
  signal.throwIfAborted()
  const stream = api.$stream<string>({
    name: `CLI Worker command ${binding.workerId}`,
    open: (lifetime) => api.cliworker.watch(binding.parentSessionId, binding.workerId, lifetime),
    ended: () => new Error(t('任务连接已结束')),
  })
  const abort = () => {
    void stream.dispose().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const item of stream) {
      signal.throwIfAborted()
      const snapshot = JSON.parse(item.value) as Snapshot
      item.accept()
      return snapshot
    }
    throw new Error(t('未收到当前任务的记录'))
  } finally {
    signal.removeEventListener('abort', abort)
    await stream.dispose()
  }
}

function ownedWorker(snapshot: Snapshot, binding: OwnedBinding): Worker {
  const worker = snapshot.selected
  if (
    !worker ||
    worker.id !== binding.workerId ||
    worker.parentSessionId !== binding.parentSessionId ||
    worker.harnessConversation?.sessionId !== binding.sessionId ||
    worker.harnessConversation.parentSessionId !== binding.parentSessionId
  )
    throw new Error(t('收到不匹配的 CLI 子会话记录'))
  if (snapshot.selectedBusy || active(worker.status) || snapshot.configuring)
    throw new Error(t('请等待本轮结束后再修改设置'))
  if (snapshot.queuedFollowups?.length) throw new Error(t('请发送或移除待发消息后再修改设置'))
  if (snapshot.resumeBlockedReason) throw new Error(snapshot.resumeBlockedReason)
  return worker
}

/**
 * Data-only source for owned CLI children. DSH owns trigger detection, menu,
 * PopupSelectView, keyboard, token CAS and focus through its existing session
 * controller. No original source, command contribution or component is replaced.
 */
export function installHarnessNativeCommands(
  ctx: CommandContext,
  bindings: HarnessBindingRegistry,
  api: API,
  attachments?: ReturnType<typeof installHarnessNativeAttachments>,
  features: HarnessCommandFeatures = {},
): () => void {
  let disposed = false
  const openings = new Map<string, { binding: OwnedBinding; command: Command; close: () => void }>()
  const owned = (session: ClientSessionContext): OwnedBinding | undefined => {
    if (disposed) return
    const binding = bindings.get(session.sessionId)
    if (!binding?.workerId || binding.parentSessionId === session.sessionId) return
    const address = ctx.sessions.subagentAddress(session.sessionId)
    if (address?.parentSessionId !== binding.parentSessionId || address.childSessionId !== session.sessionId)
      return
    if (!ctx.sessions.binding(session.sessionId)) return
    return binding as OwnedBinding
  }
  const reasonFor = (binding: OwnedBinding, command: Command) =>
    harnessFeatureReason(binding, command) ||
    (command === 'feedback' && !features.openFeedback ? t('Harness 反馈服务尚未就绪') : undefined) ||
    (command === 'fork' ? features.forkReason?.(binding.sessionId) || (!features.fork ? t('CLI 分支入口尚未就绪') : undefined) : undefined)
  const open = (session: ClientSessionContext, command: SettingCommand, segment: TokenSegment) => {
    const binding = owned(session)
    if (!binding || reasonFor(binding, command)) return
    const scope = ctx.sessions.binding(session.sessionId)!
    const popup: PopupSelectController<ClientSessionContext> = ctx.commandUi.popupFor(scope.ctx)
    openings.get(session.sessionId)?.close()
    const lifetime = new AbortController()
    let popupSignal: AbortSignal | undefined
    let releaseScope: (() => void) | undefined
    let releaseState: (() => void) | undefined
    let closed = false
    const finish = () => {
      if (closed) return
      closed = true
      lifetime.abort()
      popupSignal?.removeEventListener('abort', finish)
      releaseState?.()
      releaseScope?.()
      if (openings.get(session.sessionId)?.close === close) openings.delete(session.sessionId)
    }
    const close = () => {
      if (closed) return
      finish()
      popup.dismiss()
    }
    openings.set(session.sessionId, { binding, command, close })
    releaseScope = scope.ctx.effect(() => () => close(), 'cliworker: native command opening')
    releaseState = popup.state.subscribe(() => {
      if (!popup.state.getSnapshot().open) finish()
    })
    const check = () => {
      lifetime.signal.throwIfAborted()
      if (
        !sameBinding(owned(session), binding) ||
        !owned(session)?.capabilities[command] ||
        ctx.sessions.binding(session.sessionId) !== scope
      )
        throw new Error(t('会话已切换，请重新打开设置'))
      const state = scope.session.getSnapshot()
      const inbox = scope.session.projections.faceOf('inbox').getSnapshot() as InboxWireState | undefined
      if (state.openState !== 'open') throw new Error(t('原生会话尚未就绪'))
      if (
        state.running ||
        state.pendingSubmissions.length ||
        inbox?.['next-turn']?.length ||
        inbox?.['next-step']?.length
      )
        throw new Error(t('请等待原生对话结束，并发送或移除待发消息后再修改设置'))
    }
    let worker: Worker | undefined
    let selections = new Map<string, Preference>()
    let modes = new Set<string>()
    popup.open(
      command,
      {
        searchMode: command === 'model' ? 'fuzzy-label' : 'substring',
        options: async (_session, signal) => {
          popupSignal = signal
          signal.addEventListener('abort', finish, { once: true })
          if (signal.aborted) finish()
          check()
          worker = ownedWorker(await snapshotFor(api, binding, lifetime.signal), binding)
          check()
          if (command === 'model') {
            const cli = cliOf(worker.preference)
            const catalog = JSON.parse(
              value(
                await api.cliworker.catalogForWorker(
                  binding.parentSessionId,
                  binding.workerId,
                  lifetime.signal,
                ),
              ),
            ) as { cli: string; models: ModelChoice[]; notice?: string }
            check()
            if (catalog.cli !== cli || !Array.isArray(catalog.models))
              throw new Error(t('收到不匹配的 CLI 模型目录'))
            const current = worker.preference
            selections = new Map()
            const options: SelectOption[] = []
            for (const model of visibleModelChoices(catalog.models, current.model)) {
              for (const effort of model.efforts ?? []) {
                const id = JSON.stringify([cli, model.id, effort])
                if (selections.has(id)) continue
                selections.set(id, { cli, model: model.id, effort })
                options.push({
                  id,
                  label: `${model.label} · ${effortLabel(effort)}`,
                  detail: model.id,
                  group: { name: cli, label: CLI_LABELS[cli] },
                  active:
                    (model.id === current.model ||
                      Object.values(model.variants ?? {}).includes(current.model)) &&
                    effort === current.effort,
                })
              }
            }
            if (!options.length) throw new Error(hostText(catalog.notice) || t('当前 CLI 未返回可用的模型和思考强度'))
            return options
          }
          if (!api.cliworker.permissionForWorker || !api.cliworker.configureWorkerPermission)
            throw new Error(t('Host 尚未提供 CLI 权限设置'))
          const permission = JSON.parse(
            value(
              await api.cliworker.permissionForWorker(
                binding.parentSessionId,
                binding.workerId,
                lifetime.signal,
              ),
            ),
          ) as WorkerPermissionState
          check()
          if (!permission.writable) throw new Error(hostText(permission.reason) || t('当前任务暂不可修改权限'))
          if (command === 'plan') {
            if (!permission.plan.supported) throw new Error(t('当前 CLI 不支持规划模式'))
            // The plan switch is separate from the level and keeps it.
            modes = new Set(['plan', 'accept-edits'])
            return [
              { id: 'plan', label: t('开启规划'), detail: t('以 CLI 原生规划模式运行，只出方案、不改文件'), active: permission.plan.active },
              { id: 'accept-edits', label: t('关闭规划'), detail: t('按当前权限档位执行'), active: !permission.plan.active },
            ]
          }
          modes = new Set(permission.options.map((option) => option.value))
          return permission.options.map((option) => ({
            id: option.value,
            label: hostText(option.name),
            detail: hostText(option.description),
            active: option.value === permission.currentValue,
          }))
        },
        onSelect: async (option) => {
          check()
          const current = ownedWorker(await snapshotFor(api, binding, lifetime.signal), binding)
          check()
          if (
            !worker ||
            cliOf(current.preference) !== cliOf(worker.preference) ||
            current.conversationId !== worker.conversationId
          )
            throw new Error(t('任务身份已改变，请重新打开设置'))
          let saved: Worker
          if (command === 'model') {
            const preference = selections.get(option.id)
            if (!preference || cliOf(preference) !== cliOf(current.preference))
              throw new Error(t('只能选择当前 CLI 真实目录中的模型和思考强度'))
            saved = JSON.parse(
              value(
                await api.cliworker.configureWorker(
                  binding.parentSessionId,
                  binding.workerId,
                  JSON.stringify(preference),
                  lifetime.signal,
                ),
              ),
            ) as Worker
          } else {
            if (!modes.has(option.id) || !api.cliworker.configureWorkerPermission)
              throw new Error(t('当前 CLI 不支持此权限模式'))
            saved = JSON.parse(
              value(
                await api.cliworker.configureWorkerPermission(
                  binding.parentSessionId,
                  binding.workerId,
                  option.id as TaskMode | WorkerLevel,
                  lifetime.signal,
                ),
              ),
            ) as Worker
          }
          check()
          if (
            saved.id !== binding.workerId ||
            saved.parentSessionId !== binding.parentSessionId ||
            saved.harnessConversation?.sessionId !== binding.sessionId ||
            cliOf(saved.preference) !== cliOf(current.preference) ||
            saved.conversationId !== current.conversationId
          )
            throw new Error(t('收到不匹配的 Worker 设置'))
        },
      },
      session,
      segment,
    )
  }
  const execute = (session: ClientSessionContext, command: Command, segment: TokenSegment) => {
    const binding = owned(session)
    if (!binding || reasonFor(binding, command)) return
    if (command === 'goal') openHarnessWorkerGoal(bindings, binding.sessionId)
    else if (command === 'feedback') features.openFeedback?.(binding.sessionId)
    else if (command === 'fork') features.fork?.(binding.sessionId)
    else open(session, command, segment)
  }
  const source: InputTriggerSource = {
    trigger: '/',
    name: HARNESS_COMMAND_SOURCE,
    showGroupTitle: false,
    candidates: async (session, req) => {
      req.signal.throwIfAborted()
      const binding = owned(session)
      if (!binding) return []
      const rows = [
        ...(attachments?.candidates(session.sessionId) ?? []),
        ...commands.map(({ section, ...command }) => ({
          ...command,
          label: t(command.label),
          section,
          description: reasonFor(binding, command.name) || t(command.description),
        })),
      ]
      // Like the native menu: sections for an empty query, shared name-and-label ranking otherwise.
      if (req.query) return rankByName(rows, req.query).map(({ section: _, ...row }) => row)
      const titles = sectionTitles(ctx)
      return (['add', 'commands'] as const).flatMap((section) =>
        rows.filter((row) => row.section === section).map((row) => ({ ...row, section: titles[section] })),
      )
    },
    onPick: (pick) => {
      if (!owned(pick.session)) return
      if (attachments?.pick(pick)) return 'handled'
      const command = commandOf(pick.candidate.name)
      if (!command) return
      execute(pick.session, command.name, { via: 'menu', span: pick.span })
      return 'handled'
    },
    matchEnter: async (session, line, signal, envelope) => {
      const binding = owned(session)
      if (!binding) return
      const [token, ...args] = line.trim().split(/\s+/u)
      if (!token?.startsWith('/')) return
      const command = commandOf(token.slice(1))
      if (!command) return
      signal.throwIfAborted()
      if (reasonFor(binding, command.name)) return 'handled'
      if (args.length) throw new Error(t('请通过 /{command} 的原生选项修改设置', { command: command.name }))
      if (envelope.attachments) throw new Error(t('设置命令不接受附件，请保留附件并单独打开设置'))
      execute(session, command.name, { via: 'enter', token })
      return 'handled'
    },
  }
  const unregister = ctx.inputTriggers.registerSource(source)
  publishCommandServices(bindings, { sessions: ctx.sessions, inputTriggers: ctx.inputTriggers })
  const unsubscribe = bindings.subscribe(() => {
    for (const { binding, command, close } of openings.values()) {
      if (
        !sameBinding(bindings.get(binding.sessionId), binding) ||
        !bindings.get(binding.sessionId)?.capabilities[command]
      )
        close()
    }
  })
  return () => {
    if (disposed) return
    disposed = true
    publishCommandServices(bindings)
    unregister()
    unsubscribe()
    for (const opening of [...openings.values()]) opening.close()
  }
}
