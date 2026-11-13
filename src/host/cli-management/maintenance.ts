import { CLI_LABELS, type CliId } from '../../shared/types.ts'

export class MaintenanceError extends Error {
  readonly code = 'MAINTENANCE'
  constructor(cli: CliId) { super(`MAINTENANCE：${CLI_LABELS[cli]} 正在更新，请等待更新或取消清理完成`) }
}
export class CliBusyError extends Error {
  readonly code = 'CLI_BUSY'
  constructor(readonly busyWorkers: number) { super(`CLI_BUSY：有 ${busyWorkers} 个任务正在使用此 CLI，或账号窗口、模型目录、路径读取尚未结束，请结束后再更新`) }
}
/** Both admission and reservation are synchronous. Readers hold their lease across awaits. */
export class CliMaintenance {
  private held = new Set<CliId>()
  private readers = new Map<CliId, number>()
  assertAvailable(cli: CliId) { if (this.held.has(cli)) throw new MaintenanceError(cli) }
  using(cli: CliId): () => void {
    this.assertAvailable(cli)
    this.readers.set(cli, (this.readers.get(cli) ?? 0) + 1)
    let released = false
    return () => { if (!released) { released = true; const count = this.readers.get(cli)! - 1; if (count) this.readers.set(cli, count); else this.readers.delete(cli) } }
  }
  begin(cli: CliId, busy: () => { workers: number; accounts: boolean }): () => void {
    this.assertAvailable(cli)
    const state = busy()
    if (state.workers || state.accounts || this.readers.has(cli)) throw new CliBusyError(state.workers)
    this.held.add(cli)
    return () => { this.held.delete(cli) }
  }
}
