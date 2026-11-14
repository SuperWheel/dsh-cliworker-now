import type { ProcessBackend } from './process.ts'
import { prepareProbeTemporaryEnvironment } from './temporary-tree.mjs'

/** Explicit query boundary: Worker/update launches keep using the original backend. */
export async function spawnProbe(
  backend: ProcessBackend,
  spec: Parameters<ProcessBackend['spawn']>[0],
  platform: NodeJS.Platform = process.platform,
): Promise<ReturnType<ProcessBackend['spawn']>> {
  spec.signal?.throwIfAborted()
  if (platform !== 'win32') return backend.spawn(spec)
  const temporary = await prepareProbeTemporaryEnvironment(spec.env, platform)
  let child: ReturnType<ProcessBackend['spawn']>
  try {
    spec.signal?.throwIfAborted()
    child = backend.spawn({ ...spec, env: temporary.env })
  } catch (error) { await temporary.release(); throw error }
  // Preserve native handle getters/method receivers. `done` is not range-exit evidence.
  return new Proxy(child, {
    get(target, key) {
      if (key === 'waitForExit') return async (...args: Parameters<typeof child.waitForExit>) => {
        const exited = await target.waitForExit(...args)
        if (exited) await temporary.release()
        return exited
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
