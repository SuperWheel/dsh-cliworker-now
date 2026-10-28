import { createElement, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type { PropsRuntime, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { harnessFeatureReason } from './harness-feature-support.ts'
import {
  useHarnessSessionBinding,
  type HarnessBindingRegistry,
  type HarnessNativeBinding,
} from './harness-binding-registry.ts'
import { NativeCliModelDirectory } from './native-cli-model-directory.ts'
import { useWorkers, value, type API } from './workers.ts'
import { active, cliOf, type TaskMode, type Worker, type WorkerLevel } from '../shared/types.ts'
import { cliLevelOptions, type WorkerPermissionState } from '../shared/worker-permissions.ts'
import { t, useT, type MessageKey } from './i18n.ts'
import { hostText } from './operation-error.ts'

const seats = {
  'conversation.input.model': { feature: 'model', label: '模型与强度' as MessageKey },
  'conversation.input.permission': { feature: 'permission', label: '权限' as MessageKey },
  'conversation.input.plan': { feature: 'plan', label: '规划模式' as MessageKey },
} as const

type Feature = (typeof seats)[keyof typeof seats]['feature']
type ControlProps = PropsRuntime<'conversation.input.model'> & Record<string, unknown>
type NativeControl = ComponentType<ControlProps>

// PermissionSelect uses these public preset values to choose its native glyph,
// narrow-container layout and full-access confirmation. Not `auto`: DSH would
// relabel it 自动审查. Keep Worker levels at the Gateway boundary.
const nativePermissionPreset = { ask: 'read-only', auto: 'workspace-write', full: 'danger-full-access' } as const
function cliPermissionLevel(preset: string): WorkerLevel | undefined {
  return (Object.keys(nativePermissionPreset) as WorkerLevel[]).find((level) => nativePermissionPreset[level] === preset)
}

/** Native components own every menu, focus rule, confirmation and interaction. */
function CliControl({
  Native,
  props,
  binding,
  feature,
  api,
  unavailable,
}: {
  Native: NativeControl
  props: ControlProps
  binding: HarnessNativeBinding
  feature: Feature
  api: API
  /** A permanent reason the control stays locked; it still shows the CLI's real mode. */
  unavailable?: string
}) {
  const { snapshot, connecting, error } = useWorkers(api, binding.parentSessionId, binding.workerId!)
  // The public session-list store receives the same Host projection frames as
  // the parent's controls. Observe its exact parent; do not retain or navigate it.
  // These values invalidate a read, never grant a permission locally.
  const parentSessionId = binding.parentSessionId as typeof props.sessionId
  const parentPermission = props.useSessions((state) => state.projectionsBySession[parentSessionId]?.values.permissions)
  const parentPlan = props.useSessions((state) => state.projectionsBySession[parentSessionId]?.values.plan)
  // Equivalent replayed frames must not cancel a valid in-flight save.
  const parentAuthority = JSON.stringify([
    parentSessionId, parentPermission?.currentValue, parentPlan?.active, parentPlan?.pending,
  ])
  const selected = snapshot.selected
  const worker =
    selected &&
    selected.id === binding.workerId &&
    selected.parentSessionId === binding.parentSessionId &&
    selected.harnessConversation?.sessionId === binding.sessionId
      ? selected
      : undefined
  const nativeBusy = props.useSession((session) => session.running || session.pendingSubmissions.length > 0)
  const inbox = props.useProjection('inbox')
  const nativeQueued = !!(inbox?.['next-turn'].length || inbox?.['next-step'].length)
  const reason =
    connecting || error || !worker
      ? error || t('正在读取当前 CLI 设置')
      : nativeBusy || active(worker.status) || snapshot.selectedBusy
        ? t('请等待本轮结束后再修改设置')
        : nativeQueued || snapshot.queuedFollowups?.length
          ? t('请先发送或移除待发消息（包含已暂停消息），再修改设置')
          : hostText(snapshot.resumeBlockedReason)
  const locked = props.locked || !!reason || !!unavailable
  const [directory, setDirectory] = useState<NativeCliModelDirectory>()
  const initialWorker = useRef(worker)
  initialWorker.current = worker
  useEffect(() => {
    if (feature !== 'model' || !initialWorker.current) return
    const next = new NativeCliModelDirectory(api, binding.parentSessionId, initialWorker.current)
    setDirectory(next)
    next.load()
    return () => next.dispose()
  }, [api, binding.parentSessionId, binding.workerId, !!worker, feature])
  useLayoutEffect(() => {
    if (worker) directory?.sync(worker, locked)
  }, [directory, worker, locked])
  const [permissionState, setPermissionState] = useState<{
    authority: typeof parentAuthority
    value: WorkerPermissionState
  }>()
  // An old writable receipt cannot keep the native control enabled between
  // the parent projection changing and the replacement read effect running.
  const permission = permissionState?.authority === parentAuthority ? permissionState.value : undefined
  const [toast, setToast] = useState<string>()
  const mounted = useRef(false)
  const saving = useRef<AbortController>()
  const permissionRead = useRef<AbortController>()
  const permissionVersion = useRef(0)
  const [permissionSaving, setPermissionSaving] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      saving.current?.abort()
    }
  }, [])
  useEffect(() => () => saving.current?.abort(), [parentAuthority])
  useEffect(() => {
    if (feature === 'model' || !worker || !api.cliworker.permissionForWorker) return
    const request = (permissionRead.current = new AbortController())
    const version = ++permissionVersion.current
    setPermissionState(undefined)
    void api.cliworker
      .permissionForWorker(binding.parentSessionId, worker.id, request.signal)
      .then((result) => {
        if (!request.signal.aborted && version === permissionVersion.current)
          setPermissionState({ authority: parentAuthority, value: JSON.parse(value(result)) })
      })
      .catch((failure) => {
        if (!request.signal.aborted) setToast(failure instanceof Error ? failure.message : String(failure))
      })
    return () => request.abort()
  }, [api, feature, binding.parentSessionId, binding.workerId, worker?.mode, worker?.level, worker?.status, locked, parentAuthority])
  /** @param setting - A level from the menu, or the plan switch (`plan` / `accept-edits`). */
  const selectPermission = async (setting: TaskMode | WorkerLevel): Promise<boolean> => {
    if (
      locked ||
      saving.current ||
      !worker ||
      !permission?.writable ||
      !api.cliworker.configureWorkerPermission ||
      (setting === 'plan'
        ? !permission.plan.supported
        : setting !== 'accept-edits' && !permission.options.some((option) => option.value === setting))
    )
      return false
    permissionRead.current?.abort()
    const request = (saving.current = new AbortController())
    const version = ++permissionVersion.current
    setPermissionSaving(true)
    try {
      const saved = JSON.parse(
        value(
          await api.cliworker.configureWorkerPermission(
            binding.parentSessionId,
            worker.id,
            setting,
            request.signal,
          ),
        ),
      ) as Worker
      if (request.signal.aborted || !mounted.current) return false
      if (saved.id !== worker.id || saved.parentSessionId !== binding.parentSessionId)
        throw new Error(t('收到不匹配的 Worker 设置'))
      if (version === permissionVersion.current)
        setPermissionState({
          authority: parentAuthority,
          value: {
            ...permission,
            // A saved level is never above the parent cap the Host checked.
            currentValue: setting === 'plan' || setting === 'accept-edits' ? permission.currentValue : (saved.level ?? 'full'),
            plan: { ...permission.plan, active: saved.mode === 'plan' },
          },
        })
      return true
    } catch (failure) {
      if (!request.signal.aborted && mounted.current)
        setToast(failure instanceof Error ? failure.message : String(failure))
      return false
    } finally {
      if (saving.current === request) saving.current = undefined
      if (mounted.current) setPermissionSaving(false)
    }
  }
  let control
  if (feature === 'model') {
    control = directory
      ? createElement(Native, {
          ...props,
          locked,
          available: true,
          directory: directory.store,
          load: directory.load,
          select: directory.select,
        })
      : createElement(Native, { ...props, locked: true })
  } else {
    // Until the Host answers, the control stays locked; the CLI's own levels stand in.
    const options = (permission?.options ?? (worker ? cliLevelOptions(cliOf(worker.preference)) : [])).map((option) => ({
      ...option,
      value: nativePermissionPreset[option.value],
    }))
    const currentLevel = permission?.currentValue ?? worker?.level
    const currentValue = currentLevel && nativePermissionPreset[currentLevel]
    const planActive = permission?.plan.active ?? worker?.mode === 'plan'
    const catalog = {
      value: { options, defaultOptions: options, defaultPreset: currentValue ?? 'workspace-write' },
    }
    const originalProjection = props.useProjection
    // Only these two setting projections are mapped. Inbox, draft and Agent lifecycle stay native.
    const useProjection = ((key: string, selector?: (state: unknown) => unknown) => {
      if (key === 'permissions' || key === 'plan') {
        const state =
          key === 'permissions'
            ? currentValue
              ? { currentValue }
              : undefined
            : { active: planActive, pending: false }
        return selector ? selector(state) : state
      }
      return originalProjection(key as never, selector as never)
    }) as typeof props.useProjection
    control = createElement(Native, {
      ...props,
      locked: locked || permissionSaving || !permission?.writable,
      useProjection,
      usePermissionCatalog: (selector?: (state: typeof catalog) => unknown) =>
        selector ? selector(catalog) : catalog,
      select: (preset: string) => {
        const level = cliPermissionLevel(preset)
        return level ? selectPermission(level) : Promise.resolve(false)
      },
      exitPlanMode: async () =>
        (await selectPermission('accept-edits')) ? null : t('权限设置未保存，请核对当前任务与权限状态'),
    })
  }
  const explanation = unavailable || reason || (feature !== 'model' ? permission?.reason : undefined)
  return (
    <>
      {explanation ? (
        <Tooltip label={explanation} side="top" portal>
          <span tabIndex={0} aria-label={explanation}>
            {control}
          </span>
        </Tooltip>
      ) : (
        control
      )}
      {toast && <Toast text={toast} onDone={() => setToast(undefined)} />}
    </>
  )
}

/** Reuse each actual native leaf; only its documented business data/actions change. */
const controlGuards = new WeakMap<Context['slots'], {
  bindings: HarnessBindingRegistry; api?: API; owners: number; release: () => void
}>()

/** Share one delegating registration per slot registry and exact authority. */
export function installHarnessControlGuards(
  ctx: Pick<Context, 'slots'>,
  bindings: HarnessBindingRegistry,
  api?: API,
): () => void {
  let held = controlGuards.get(ctx.slots)
  if (held && (held.bindings !== bindings || held.api !== api))
    throw new Error(t('原生 CLI 控件已由另一组会话权限绑定接管'))
  if (!held) {
    held = { bindings, api, owners: 0, release: registerHarnessControlGuards(ctx, bindings, api) }
    controlGuards.set(ctx.slots, held)
  }
  const lease = held
  lease.owners++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--lease.owners) return
    controlGuards.delete(ctx.slots)
    lease.release()
  }
}

function registerHarnessControlGuards(
  ctx: Pick<Context, 'slots'>,
  bindings: HarnessBindingRegistry,
  api?: API,
): () => void {
  const releases: (() => void)[] = []
  for (const name of Object.keys(seats) as (keyof typeof seats)[]) {
    let original: StoredEntry | undefined, own: StoredEntry | undefined, dispose: (() => void) | undefined
    let updating = false
    const sync = () => {
      if (updating) return
      const next = ctx.slots
        .entries(name)
        .filter((entry) => entry !== own)
        .sort((left, right) => (left.options.priority ?? 0) - (right.options.priority ?? 0))[0]
      if (next === original) return
      updating = true
      dispose?.()
      dispose = undefined
      own = undefined
      original = next
      if (next) {
        const Native = next.component as NativeControl
        const { feature, label } = seats[name]
        function BoundControl(props: ControlProps) {
          useT()
          const binding = useHarnessSessionBinding(bindings, props.sessionId)
          if (!binding) return createElement(Native, props)
          const unavailable =
            feature === 'plan' ? harnessFeatureReason(binding, 'plan') : undefined
          // Locked, but mapped to the CLI's real mode instead of the parent's preset.
          if (unavailable && feature === 'permission' && api && binding.workerId)
            return (
              <CliControl
                key={`${binding.sessionId}:${binding.workerId}`}
                Native={Native}
                props={props}
                binding={binding}
                feature={feature}
                api={api}
                unavailable={unavailable}
              />
            )
          // No plan mode: leave the seat empty; the "+" menu still explains why.
          if (unavailable && feature === 'plan') return null
          if (unavailable) return (
            <Tooltip label={unavailable} side="top" portal>
              <span tabIndex={0} aria-label={unavailable}>
                {createElement(Native, { ...props, locked: true, select: async () => false, exitPlanMode: async () => null })}
              </span>
            </Tooltip>
          )
          if (api && binding.workerId)
            return (
              <CliControl
                key={`${binding.sessionId}:${binding.workerId}`}
                Native={Native}
                props={props}
                binding={binding}
                feature={feature}
                api={api}
              />
            )
          const reason = hostText(binding.reasons?.[feature]) || t('{label}正在等待 CLI 连接信息', { label: t(label) })
          return (
            <Tooltip label={reason} side="top" portal>
              <span tabIndex={0} aria-label={reason}>
                {createElement(Native, { ...props, locked: true })}
              </span>
            </Tooltip>
          )
        }
        const unregister = ctx.slots.register(
          {
            name,
            priority: (next.options.priority ?? 0) - 1,
            ...(next.inject ? { inject: next.inject } : {}),
            ...(next.locale ? { locale: next.locale } : {}),
            ...(next.store ? { store: next.store } : {}),
            ...(next.select ? { select: next.select } : {}),
          } as never,
          BoundControl as never,
        )
        const shadow = ctx.slots.entries(name).find((entry) => entry.component === BoundControl)
        // The original remains the sole child-slot declarant. Re-registering
        // its children would conflict; this delegating shadow needs the same
        // render kit without taking ownership of those declarations.
        if (shadow && next.children) shadow.children = next.children
        own = shadow
        dispose = () => {
          // SlotCore releases an entry's children on disposal. Drop only our
          // borrowed render metadata so native label entries remain live.
          if (shadow && shadow.children === next.children) delete shadow.children
          unregister()
        }
      }
      updating = false
    }
    releases.push(ctx.slots.subscribe(name, sync))
    sync()
    releases.push(() => {
      updating = true
      dispose?.()
    })
  }
  return () => {
    for (const release of releases.reverse()) release()
  }
}
