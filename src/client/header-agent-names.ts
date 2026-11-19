import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { API } from './workers.ts'

type Names = ReadonlyMap<string, string>
type Entry = {
  names: Names
  listeners: Set<() => void>
  close(): void
}
const empty: Names = new Map()

function overrides(json: string): Names {
  const snapshot: unknown = JSON.parse(json)
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    throw new Error('Invalid agent name snapshot')
  const names = new Map<string, string>()
  for (const [id, row] of Object.entries(snapshot)) {
    // Older Hosts include registeredName only on a real overlay. Unnamed legacy
    // children need the explicit marker to distinguish a rename from a dsh-N fallback.
    if (
      (row?.overridden === true || typeof row?.registeredName === 'string') &&
      typeof row.name === 'string' &&
      row.name
    )
      names.set(id, row.name)
  }
  return names
}

/** Only mounted header consumers retain a parent stream, including nested catalogs. */
export function installHeaderAgentNames(slots: Pick<Context['slots'], 'provideRoot'>, api: API) {
  const parents = new Map<string, Entry>()
  let disposed = false

  function connect(parent: string): Entry {
    let stream: ReturnType<API['$stream']> | undefined
    const entry: Entry = {
      names: empty,
      listeners: new Set(),
      close: () => {
        void stream?.dispose().catch(() => undefined)
      },
    }
    parents.set(parent, entry)
    function publish(names: Names) {
      if (parents.get(parent) !== entry) return
      entry.names = names
      for (const listener of entry.listeners) listener()
    }
    void (async () => {
      try {
        const active = api.$stream<string>({
          name: `CLI Worker header names ${parent}`,
          async *open(signal) {
            const baseline = await api.cliworker.agentNames(parent, signal).catch(() => undefined)
            signal.throwIfAborted()
            if (baseline?.ok) yield baseline.value
            // watch opens with another complete snapshot, including changes during the read.
            yield* api.cliworker.watchAgentNames(parent, signal)
          },
          carrierFailed: () => publish(empty),
          ended: () => new Error('Agent name stream ended'),
        })
        stream = active
        for await (const item of active) {
          if (!item.signal.aborted) publish(overrides(item.value))
          item.accept()
        }
      } catch {
        // With no usable name source the header renders the official catalog.
        publish(empty)
      }
    })()
    return entry
  }

  function source(parent: string): HostObservable<Names> {
    return {
      getSnapshot: () => parents.get(parent)?.names ?? empty,
      subscribe(listener) {
        if (disposed) return () => {}
        const entry = parents.get(parent) ?? connect(parent)
        entry.listeners.add(listener)
        return () => {
          if (!entry.listeners.delete(listener) || entry.listeners.size) return
          if (parents.get(parent) === entry) parents.delete(parent)
          entry.close()
        }
      },
    }
  }

  const unregister = slots.provideRoot({ props: { cliworkerHeaderNames: source } })
  return () => {
    disposed = true
    for (const [parent, entry] of parents) {
      parents.delete(parent)
      entry.close()
      for (const listener of entry.listeners) listener()
      entry.listeners.clear()
    }
    unregister()
  }
}
