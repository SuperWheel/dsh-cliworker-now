/**
 * Recover the Harness page after a hot plugin switch crashed its React root.
 *
 * Enabling or disabling this plugin swaps the stock session/conversation/
 * subagent/chat UI for the bundled copies (or back). The Harness client
 * removes the old modules before it imports the new ones, so for a moment no
 * `session` scope adapter is installed; the root renderer wraps the whole page
 * in `ScopeProvider scope="session-maybe"`, throws `SlotAssemblyError`, and
 * every error boundary rethrows that error by design. React then empties
 * `#root` and the page stays white even after the new adapter arrives, while a
 * reload boots the same graph normally.
 *
 * At cold boot the Harness mounts React only after every client plugin has
 * activated, so a mounted-but-empty root seen by this plugin can only be a
 * crash from a live switch. Prefer restarting DSH's own web mount fiber after
 * module reconciliation settles. Its effect disposes the old React root before
 * mounting again, and DSH continues to own the replacement root's cleanup.
 *
 * DSH Desktop must not reload: its boot IPC answers every page load with the
 * module injections captured when the Host started (apps/desktop main.ts
 * `DESKTOP_IPC.boot`), so a reload after a live switch requests module
 * revisions that no longer exist and lands in the startup-failure dialog,
 * which offers to rewrite the profile. The page exposes no restart API, so
 * Desktop gets a plain-text notice only when in-place recovery is unavailable
 * or fails. Browsers retain the guarded reload as their fallback.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'

const STORAGE_KEY = 'dsh-cliworker-now:root-recovery'
/** Minimum time between two automatic reloads of one tab. */
export const RELOAD_GAP_MS = 30_000
/** How long a check keeps looking after a live activation or disposal. */
export const ACTIVATION_WATCH_MS = 10_000
export const DISPOSAL_WATCH_MS = 60_000
const POLL_MS = 250
/** Confirm an empty root after the module graph has settled. */
const SETTLE_MS = 500

type RootElement = { childElementCount: number }

type RemountDecision = 'waiting' | 'unavailable' | 'stopped' | { restart: () => Promise<void> }
// Shared by activation/disposal watches. Also guards attempts when storage is denied.
const remountAttempts = new WeakMap<RootElement, { at: number; pending: boolean }>()

/**
 * 只重启 DSH 自己拥有的 web mount fiber，不直接调用 uiRenderer.mount。
 * 依据 0.2.2-rc.1：web/src/mount.ts 的根级 inject + effect，以及 Cordis
 * Fiber.getEffects()/restart() 的公开接口。restart 等旧 disposer 完成才重挂；
 * 不改服务、配置、私有 effects 或 React 内部对象。标签/结构不匹配即回退。
 * 保存的是应用 root context，停用本插件后仍可使用；不在已销毁的插件上注册资源。
 */
export function hostRootRemount(ctx: Context): () => RemountDecision {
  const root = ctx.root
  return () => {
    // FiberState.ACTIVE = 2；避免运行时导入 const enum 或额外 Cordis 副本。
    if (!root || root.fiber.state !== 2) return 'stopped'
    const modules = root.get('modules') as {
      version?: string
      entries?: { state?: { getSnapshot: () => { syncing: boolean; failures: readonly unknown[] } } }
    } | undefined
    if (modules?.version !== 'client' || !modules.entries?.state) return 'unavailable'
    const state = modules.entries.state.getSnapshot()
    if (state.syncing) return 'waiting'
    if (state.failures.length) return 'unavailable'
    if (!root.get('uiRenderer')) return 'unavailable'
    const candidates = [...root.registry.values()].flatMap(runtime => [...runtime.fibers]).filter(fiber =>
      fiber.parent.fiber === root.fiber && Object.keys(fiber.inject).length === 1 && 'uiRenderer' in fiber.inject,
    )
    // 多个候选、额外 effect 或提供服务时，不能证明这是唯一的应用挂载 owner。
    if (candidates.length !== 1) return 'unavailable'
    const fiber = candidates[0]!
    if (fiber.inertia) return 'waiting'
    if (fiber.uid === null || fiber.state !== 2 || fiber.provisions.size) return 'unavailable'
    const effects = fiber.getEffects()
    if (effects.length !== 1 || effects[0]!.label !== 'web boot: application mount') return 'unavailable'
    return { restart: () => fiber.restart() }
  }
}

export interface RootRecoveryEnv {
  getRoot: () => RootElement | null
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
  /** Inspect the host-owned mount and graph; never allocate an independent React root. */
  remount?: () => RemountDecision
  /** Desktop: show the restart notice instead of reloading. */
  showNotice?: () => void
  now: () => number
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  warn?: (message: string) => void
}

/** React marks its container with `__reactContainer$<id>`; unmount sets it to null. */
export function mountedRoot(element: RootElement | null): boolean {
  if (element === null) return false
  return Object.keys(element).some(
    (key) => key.startsWith('__reactContainer$') && (element as unknown as Record<string, unknown>)[key] != null,
  )
}

/** A root React mounted that now renders nothing: the uncaught-render-error state. */
export function crashedRoot(element: RootElement | null): boolean {
  return mountedRoot(element) && element!.childElementCount === 0
}

function lastReload(env: RootRecoveryEnv): number {
  try {
    const value = Number(env.storage?.getItem(STORAGE_KEY))
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/**
 * Prefer the host-owned remount. If unavailable/unsuccessful, reload once in
 * browsers or show the Desktop restart notice. Never interrupt host teardown.
 * @returns whether remount succeeded or a reload/notice was requested.
 */
export async function recoverCrashedRoot(env: RootRecoveryEnv): Promise<boolean> {
  const root = env.getRoot()
  if (!root || !crashedRoot(root)) return false
  const decision = remountDecision(env)
  if (decision === 'waiting' || decision === 'stopped') return false
  const previous = remountAttempts.get(root)
  if (previous?.pending) return false
  if (typeof decision === 'object' && (!previous || env.now() - previous.at >= RELOAD_GAP_MS)) {
    const attempt = { at: env.now(), pending: true }
    remountAttempts.set(root, attempt)
    try {
      await decision.restart()
      if (env.getRoot() === root && root.childElementCount > 0) return true
    } catch {
      env.warn?.('CLI Worker: the Harness-owned application remount failed; using the page recovery fallback')
    } finally {
      attempt.pending = false
    }
    // A host teardown or another owner transition must not trigger page recovery.
    if (env.getRoot() !== root || !crashedRoot(root)) return false
    const after = remountDecision(env)
    if (after === 'stopped' || after === 'waiting') return false
  }
  if (env.showNotice) {
    env.warn?.('CLI Worker: the Harness page went blank during a live plugin switch; DSH Desktop needs a full restart')
    env.showNotice()
    return true
  }
  const now = env.now(),
    since = now - lastReload(env)
  if (since >= 0 && since < RELOAD_GAP_MS) {
    env.warn?.('CLI Worker: the Harness page crashed again right after an automatic reload; leaving it for a manual restart')
    return false
  }
  try {
    env.storage?.setItem(STORAGE_KEY, String(now))
  } catch {
    // Without session storage the gap guard is per page load; a cold boot cannot crash this way.
  }
  env.warn?.('CLI Worker: the Harness page went blank during a live plugin switch; reloading it once')
  env.reload()
  return true
}

function remountDecision(env: RootRecoveryEnv): RemountDecision {
  try {
    return env.remount?.() ?? 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Watch for a crashed root for a bounded time, then recover once it stays
 * crashed for {@link SETTLE_MS}. The watch ends by itself, on recovery or when
 * the returned stop function is called.
 */
export function watchCrashedRoot(env: RootRecoveryEnv, durationMs: number): () => void {
  const deadline = env.now() + durationMs
  let handle: unknown,
    stopped = false,
    observedRoot: RootElement | null = null,
    crashedSince = env.now()
  const finish = (fallbackOnly = false) => {
    stopped = true
    void recoverCrashedRoot(fallbackOnly ? { ...env, remount: () => 'unavailable' } : env)
      .catch(() => env.warn?.('CLI Worker: page recovery failed'))
  }
  const schedule = (ms: number, step: () => void) => {
    handle = env.setTimeout(() => {
      handle = undefined
      if (!stopped) step()
    }, ms)
  }
  const poll = () => {
    const root = env.getRoot()
    const crashed = crashedRoot(root)
    if (!crashed || root !== observedRoot) {
      observedRoot = crashed ? root : null
      crashedSince = env.now()
    }
    if (env.now() >= deadline) {
      // 图长期未收敛时停止尝试重挂；保留原有网页刷新 / Desktop 提示兜底。
      if (crashed && env.now() - crashedSince >= SETTLE_MS && remountDecision(env) !== 'stopped') finish(true)
      return
    }
    if (crashed) {
      const decision = remountDecision(env)
      if (decision === 'stopped') return
      if (decision === 'waiting') {
        schedule(Math.min(POLL_MS, deadline - env.now()), poll)
        return
      }
      if (env.now() + SETTLE_MS > deadline) return
      schedule(SETTLE_MS, () => {
        // A newer graph may have started during the confirmation interval.
        if (remountDecision(env) === 'waiting') { poll(); return }
        finish()
      })
      return
    }
    if (env.now() < deadline) schedule(POLL_MS, poll)
  }
  poll()
  return () => {
    stopped = true
    if (handle !== undefined) env.clearTimeout(handle)
    handle = undefined
  }
}

/**
 * Install the recovery for one activation of the plugin client.
 * - Live activation (root already mounted): watch briefly, since the swap that
 *   brought this client in may have crashed the page just before.
 * - Cold boot (root not mounted yet): nothing to recover.
 * - Disposal: keep a bounded watch running after this client is gone, because
 *   removing the bundled UI crashes the page the same way and the stock UI that
 *   comes back cannot recover it.
 * @returns the disposer for the plugin effect.
 */
export function installRootRecovery(env: RootRecoveryEnv | undefined): () => void {
  if (env === undefined) return () => {}
  const stop = mountedRoot(env.getRoot()) ? watchCrashedRoot(env, ACTIVATION_WATCH_MS) : () => {}
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    stop()
    // Deliberately outlives this effect; it is bounded and stops on its own.
    watchCrashedRoot(env, DISPOSAL_WATCH_MS)
  }
}

/** True inside the DSH Desktop application window (its preload exposes the boot bridge). */
export function inDshDesktop(): boolean {
  return (globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot !== undefined
}

/** Fill a crashed root with plain text; React no longer owns any node in it. */
export function renderRestartNotice(root: Pick<HTMLElement, "append" | "ownerDocument">, text: string): void {
  const notice = root.ownerDocument.createElement('div')
  notice.setAttribute('role', 'alert')
  notice.setAttribute('data-cliworker-restart-notice', '')
  notice.textContent = text
  notice.style.cssText = [
    'box-sizing:border-box',
    'max-width:520px',
    'margin:30vh auto 0',
    'padding:0 24px',
    'text-align:center',
    'line-height:1.6',
    'font-size:var(--dsw-font-s-14-font-size, 14px)',
    'color:var(--dsw-alias-label-primary, inherit)',
  ].join(';')
  root.append(notice)
}

/**
 * The browser environment, or undefined outside a page (tests, server).
 * @param desktopNotice - text for the Desktop restart notice, resolved when it is shown.
 */
export function browserRootRecoveryEnv(desktopNotice: () => string, ctx?: Context): RootRecoveryEnv | undefined {
  if (typeof document === 'undefined' || typeof location === 'undefined') return undefined
  let storage: Storage | undefined
  try {
    storage = globalThis.sessionStorage
  } catch {
    storage = undefined
  }
  const getRoot = () => document.getElementById('root')
  return {
    getRoot,
    ...(ctx ? { remount: hostRootRemount(ctx) } : {}),
    ...(storage ? { storage } : {}),
    reload: () => location.reload(),
    ...(inDshDesktop()
      ? {
          showNotice: () => {
            const root = getRoot()
            if (root) renderRestartNotice(root, desktopNotice())
          },
        }
      : {}),
    now: () => Date.now(),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    warn: (message) => console.warn(message),
  }
}
