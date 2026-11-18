import { z as validate } from 'zod'
import { type RunOrigin } from './native-approval-policy.ts'
import { cliOf } from '../shared/types.ts'
import { RUNNING_MESSAGE_MODES } from '../shared/running-message.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

const messageSubmissionSchema = validate
  .object({
    id: validate.uuid(),
    clientId: validate.uuid(),
    sequence: validate.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    prompt: validate
      .string()
      .min(1)
      .max(100_000)
      .refine((text) => !!text.trim()),
    mode: validate.enum(RUNNING_MESSAGE_MODES),
    intent: validate.enum(['direct', 'running']),
    expectedRunId: validate.string().min(1).max(128),
  })
  .strict()

export async function submitMessage(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  requestJSON: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const request = messageSubmissionSchema.parse(JSON.parse(requestJSON))
    const key = `${parentSessionId}:${workerId}:${request.id}`
    const canonical = JSON.stringify(request)
    const submissions = (host.messageSubmissions ??= new Map())
    const prior = submissions.get(key)
    if (prior) {
      if (prior.request === canonical) return await prior.done
      const original = messageSubmissionSchema.parse(JSON.parse(prior.request))
      const promotion =
        original.mode === 'queue' &&
        original.intent === 'running' &&
        request.mode === 'interrupt' &&
        request.intent === 'running' &&
        request.prompt === original.prompt &&
        request.clientId === original.clientId &&
        request.sequence > original.sequence
      if (!promotion) throw new Error('重复提交标识对应的消息不同')
    }
    // Occupancy and the Stop boundary must exist before parent lookup or model preparation awaits.
    const reservation = host.runtime.reserveSubmission(parentSessionId, workerId, request.id)
    const control = AbortSignal.any([signal, host.disposed.signal, reservation.signal])
    const done = (async () => {
      const agent = await host.parent(parentSessionId)
      control.throwIfAborted()
      reservation.assertCurrent()
      host.assertExecution(agent, true)
      const worker = host.runtime.get(agent.id, workerId)
      if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      if (request.intent === 'direct') {
        const receipt = host.runtime.directMessageReceipt(agent.id, workerId, request.prompt, request.id)
        if (receipt) return JSON.stringify({ ...receipt, revision: host.runtime.revision })
        return await host.launch(
          agent,
          worker.title,
          request.prompt,
          worker.preference,
          worker.mode,
          workerId,
          undefined,
          control,
          undefined,
          undefined,
          undefined,
          request.id,
        )
      }
      if (request.mode === 'interrupt')
        return JSON.stringify(
          host.runtime.interruptMessage(
            agent.id,
            workerId,
            request.prompt,
            request.id,
            request.clientId,
            request.sequence,
            control,
          ),
        )
      const receipt = await host.runtime.sendRunningMessage(
        agent.id,
        workerId,
        request.prompt,
        request.expectedRunId,
        request.id,
        control,
        request.mode,
      )
      return JSON.stringify({ ...(receipt ?? { accepted: true }), revision: host.runtime.revision })
    })()
    const operation = { request: canonical, done }
    submissions.set(key, operation)
    try {
      return await done
    } finally {
      if (submissions.get(key) === operation) submissions.delete(key)
      reservation.release()
    }
  } catch (error) {
    throw failure(error)
  }
}

export async function queueFollowup(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  expectedRunId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    return JSON.stringify(host.runtime.queueFollowup(agent.id, workerId, prompt, expectedRunId, requestId))
  } catch (error) {
    throw failure(error)
  }
}

export async function steerMessage(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  expectedRunId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    validate.uuid().parse(requestId)
    validate
      .string()
      .min(1)
      .max(100_000)
      .refine((text) => !!text.trim())
      .parse(prompt)
    const observed = host.runtime.get(parentSessionId, workerId)
    if (observed.runId !== expectedRunId) throw new Error('本轮状态已变化，请核对当前运行后发送引导')
    const control = AbortSignal.any([signal, host.disposed.signal])
    const agent = await host.parent(parentSessionId)
    control.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
    // After an account switch the message is queued for the next turn instead.
    const queued = await host.runtime.steerMessage(
      agent.id,
      workerId,
      prompt,
      expectedRunId,
      requestId,
      control,
    )
    return JSON.stringify({
      accepted: true,
      requestId,
      runId: expectedRunId,
      ...(queued ? { queued } : {}),
      revision: host.runtime.revision,
    })
  } catch (error) {
    throw failure(error)
  }
}

export async function sendRunningMessage(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  expectedRunId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
    const receipt = await host.runtime.sendRunningMessage(
      agent.id,
      workerId,
      prompt,
      expectedRunId,
      requestId,
      signal,
    )
    return JSON.stringify(receipt ?? { accepted: true })
  } catch (error) {
    throw failure(error)
  }
}

export async function interruptMessage(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  requestId: string,
  clientId: string,
  sequence: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
    return JSON.stringify(
      host.runtime.interruptMessage(agent.id, workerId, prompt, requestId, clientId, sequence, signal),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function interruptQueuedFollowup(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  queuedId: string,
  expectedRunId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
    await host.runtime.interruptQueuedFollowup(agent.id, workerId, queuedId, expectedRunId, signal)
    return JSON.stringify({ queuedId, revision: host.runtime.revision })
  } catch (error) {
    throw failure(error)
  }
}

export async function cancelQueuedFollowup(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  queuedId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.cancelQueuedFollowup(agent.id, workerId, queuedId)
  } catch (error) {
    throw failure(error)
  }
}

export async function retryQueuedFollowups(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  expectedRunId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.get(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    host.runtime.retryQueuedFollowups(agent.id, workerId, expectedRunId)
  } catch (error) {
    throw failure(error)
  }
}

export async function followup(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  return host.continueWorker(parentSessionId, workerId, prompt, signal, 'user')
}

/** Shared follow-up admission; `origin` decides where this turn's approvals appear. */
export async function continueWorker(
  this: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  signal: AbortSignal,
  origin: RunOrigin,
): Promise<string> {
  try {
    const agent = await this.parent(parentSessionId)
    signal.throwIfAborted()
    this.assertExecution(agent, true)
    const worker = this.runtime.get(agent.id, workerId)
    this.runtime.assertCliEnabled(cliOf(worker.preference))
    return this.launch(
      agent,
      worker.title,
      prompt,
      worker.preference,
      worker.mode,
      workerId,
      undefined,
      signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      origin,
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function restartWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(agent, true)
    const worker = host.runtime.assertLegacyRestart(agent.id, workerId)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目新建对话')
    return await host.launch(
      agent,
      worker.title,
      prompt,
      { ...worker.preference },
      worker.mode,
      undefined,
      { role: worker.role ? structuredClone(worker.role) : undefined },
      signal,
      workerId,
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function stop(host: ServiceContext, parentSessionId: string, workerId: string): Promise<string> {
  try {
    return JSON.stringify(await host.runtime.stop(parentSessionId, workerId))
  } catch (error) {
    throw failure(error)
  }
}
