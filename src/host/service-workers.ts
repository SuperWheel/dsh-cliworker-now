import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MergeResolution } from './isolated-workspace.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

export async function renameWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    host.runtime.get(parentSessionId, workerId)
    if (host.renamingWorkers.has(workerId)) throw new Error('名称正在被其他操作修改，请刷新后重试')
    host.renamingWorkers.add(workerId)
    try {
      await host.parent(parentSessionId)
      await host.dshSubagents.readDirectoryNames(parentSessionId, signal)
      await host.runtime.renameWorker(parentSessionId, workerId, name, signal)
    } finally {
      host.renamingWorkers.delete(workerId)
    }
  } catch (error) {
    throw failure(error)
  }
}

export async function renameWorkerTitle(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  title: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.renameWorkerTitle(parentSessionId, workerId, title)
  } catch (error) {
    throw failure(error)
  }
}

export async function setWorkerGoal(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  objective: string,
  expectedRevision: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.runtime.setWorkerGoal(parentSessionId, workerId, objective, expectedRevision))
  } catch (error) {
    throw failure(error)
  }
}

export async function setWorkerGoalStatus(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  status: 'active' | 'paused',
  expectedRevision: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(
      host.runtime.setWorkerGoalStatus(parentSessionId, workerId, status, expectedRevision),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function clearWorkerGoal(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  expectedRevision: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.clearWorkerGoal(parentSessionId, workerId, expectedRevision)
  } catch (error) {
    throw failure(error)
  }
}

export async function deleteWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.deleteWorker(parentSessionId, workerId)
  } catch (error) {
    throw failure(error)
  }
}

export async function restoreWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.restoreWorker(parentSessionId, workerId)
  } catch (error) {
    throw failure(error)
  }
}

export async function forkWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  atMessageId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    await host.dshSubagents.readDirectoryNames(parentSessionId, signal)
    if (!host.harnessConversation) throw new Error('Harness CLI 会话桥未就绪')
    return JSON.stringify(
      await host.runtime.forkWorker(parent, workerId, atMessageId, host.harnessConversation, signal),
    )
  } catch (error) {
    throw failure(error)
  }
}

/** Writes into the parent's project, so the host's plan/read-only boundary applies. */
export async function mergeIsolatedWorker(
  this: ServiceContext,
  agent: Agent,
  workerId: string,
  signal: AbortSignal,
  resolutions?: Record<string, MergeResolution>,
) {
  const worker = this.runtime.get(agent.id, workerId)
  this.assertExecution(agent)
  if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目合并')
  return this.runtime.mergeIsolation(
    agent.id,
    workerId,
    AbortSignal.any([signal, this.disposed.signal]),
    resolutions,
  )
}
