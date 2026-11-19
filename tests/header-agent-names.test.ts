import { expect, it, vi } from 'vitest'
import {
  RemoteStream,
  RemoteStreamCarrierError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { installHeaderAgentNames } from '../src/client/header-agent-names.ts'
import type { API } from '../src/client/workers.ts'

type Source = (parent: string) => HostObservable<ReadonlyMap<string, string>>

function packet(name: string) {
  return JSON.stringify({
    child: { name, registeredName: 'reviewer', formerNames: ['reviewer'], kind: 'native', overridden: true },
    legacy: { name: 'dsh-1', formerNames: [], kind: 'native' },
    named: { name: 'old-host-alias', registeredName: 'agent-2', formerNames: ['agent-2'], kind: 'worker' },
  })
}

it('模拟：冷启动共享父订阅，断线清空后重取，切换及卸载取消旧代次', async () => {
  let source!: Source
  const unregister = vi.fn()
  let generation: object | undefined = {}
  const connectionListeners = new Set<() => void>()
  const connection = {
    generation: {
      getSnapshot: () => generation,
      subscribe(listener: () => void) {
        connectionListeners.add(listener)
        return () => {
          connectionListeners.delete(listener)
        }
      },
    },
  }
  const initial = vi.fn(async (parent: string) => ({ ok: true, value: packet(parent) }))
  const watches: { parent: string; signal: AbortSignal; disconnect(): void }[] = []
  async function* watch(parent: string, signal: AbortSignal) {
    const end = Promise.withResolvers<void>()
    watches.push({ parent, signal, disconnect: end.resolve })
    signal.addEventListener('abort', () => end.resolve(), { once: true })
    yield packet(parent + '-live')
    await end.promise
    if (!signal.aborted) throw new RemoteStreamCarrierError('simulated disconnect')
  }
  const api = {
    $stream: <Item>(options: RemoteStreamOptions<Item>) => new RemoteStream(connection as never, options),
    cliworker: { agentNames: initial, watchAgentNames: watch },
  } as unknown as API
  const dispose = installHeaderAgentNames(
    {
      provideRoot(contribution) {
        source = contribution.props!.cliworkerHeaderNames as Source
        return unregister
      },
    },
    api,
  )
  const first = source('first')
  const seen: (string | undefined)[] = []
  const off = first.subscribe(() => seen.push(first.getSnapshot().get('child')))
  const offAlso = source('first').subscribe(() => {})
  await vi.waitFor(() => expect(seen).toEqual(['first', 'first-live']))
  expect(first.getSnapshot().has('legacy')).toBe(false)
  expect(first.getSnapshot().get('named')).toBe('old-host-alias')
  expect(watches).toHaveLength(1)
  offAlso()
  expect(watches[0]!.signal.aborted).toBe(false)

  generation = undefined
  watches[0]!.disconnect()
  await vi.waitFor(() => expect(connectionListeners.size).toBe(1))
  expect(first.getSnapshot().size).toBe(0)
  generation = {}
  connectionListeners.forEach((listener) => listener())
  await vi.waitFor(() => expect(watches).toHaveLength(2))
  expect(initial.mock.calls.map(([id]) => id)).toEqual(['first', 'first'])
  expect(watches[0]!.signal.aborted).toBe(true)
  const second = source('second')
  second.subscribe(() => {})
  off()
  expect(first.getSnapshot().size).toBe(0)
  expect(watches[1]!.signal.aborted).toBe(true)
  await vi.waitFor(() => expect(second.getSnapshot().get('child')).toBe('second-live'))
  dispose()
  expect(watches[2]!.signal.aborted).toBe(true)
  expect(second.getSnapshot().size).toBe(0)
  expect(connectionListeners.size).toBe(0)
  expect(unregister).toHaveBeenCalledOnce()
})

it('模拟：切换父会话后丢弃延迟返回的旧快照', async () => {
  let source!: Source
  const delayed = Promise.withResolvers<{ ok: true; value: string }>()
  const watch = vi.fn(async function* () {
    yield '{}'
  })
  const api = {
    $stream: <Item>(options: RemoteStreamOptions<Item>) =>
      new RemoteStream({ generation: { getSnapshot: () => undefined } } as never, options),
    cliworker: { agentNames: () => delayed.promise, watchAgentNames: watch },
  } as unknown as API
  const dispose = installHeaderAgentNames(
    {
      provideRoot(contribution) {
        source = contribution.props!.cliworkerHeaderNames as Source
        return () => {}
      },
    },
    api,
  )
  const old = source('first')
  const changed = vi.fn()
  const off = old.subscribe(changed)
  off()
  delayed.resolve({ ok: true, value: packet('stale') })
  await delayed.promise
  await Promise.resolve()
  expect(watch).not.toHaveBeenCalled()
  expect(changed).not.toHaveBeenCalled()
  expect(old.getSnapshot().size).toBe(0)
  expect(source('second').getSnapshot().size).toBe(0)
  dispose()
})
