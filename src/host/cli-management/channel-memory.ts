import { trackUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ActiveCliId } from '../../shared/types.ts'
import { CLI_CHANNEL_REASONS, type CliChannelReason } from '../../shared/cli-management.ts'
import type { InstallationIdentity } from './identity.ts'
export const CHANNEL_MEMORY_TTL = 7 * 24 * 60 * 60_000
const records = z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ failedAt: z.number().finite().nonnegative(), reason: z.enum(CLI_CHANNEL_REASONS) }))
export function channelMemoryKey(cli: ActiveCliId, identity: InstallationIdentity, platform = process.platform, arch: string = process.arch) {
  const path = (v: string | undefined) => v && (platform === 'win32' ? win32.normalize(v).toLowerCase() : v)
  return createHash('sha256').update(JSON.stringify([cli, platform, arch, path(identity.executable), path(identity.updateRoot)])).digest('hex')
}
/** Local to this Host data root. No log, URL, account or credential data is persisted. */
export class ChannelMemory {
  readonly file: string
  private directory: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(root: string) { this.directory = join(root, 'cli-management'); this.file = join(this.directory, 'channel-memory.json') }
  private async read() {
    try {
      const parent = await lstat(this.directory)
      if (!parent.isDirectory() || parent.isSymbolicLink()) return {}
      const handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024) return {}
        const data = await handle.readFile('utf8')
        if (Buffer.byteLength(data) > 64 * 1024) return {}
        return records.parse(JSON.parse(data))
      } finally { await handle.close() }
    } catch { return {} }
  }
  async get(key: string, now = Date.now()) {
    await this.queue
    const entry = (await this.read())[key]
    return entry && now >= entry.failedAt && now - entry.failedAt < CHANNEL_MEMORY_TTL ? entry : undefined
  }
  set(key: string, reason: CliChannelReason | undefined, now = Date.now()): Promise<void> {
    const operation = this.queue.then(async () => {
      const state = await this.read()
      for (const [id, value] of Object.entries(state)) if (now < value.failedAt || now - value.failedAt >= CHANNEL_MEMORY_TTL) delete state[id]
      if (reason) state[key] = { failedAt: now, reason }; else delete state[key]
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const info = await lstat(this.directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('CLI channel memory directory invalid')
      await chmod(this.directory, 0o700)
      const temporary = trackUpdateTemporary(join(this.directory, `.channel-memory-${randomUUID()}.tmp`))
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify(records.parse(state))); await handle.sync() } finally { await handle.close() }
        await rename(temporary, this.file)
      } finally { await removeUpdateTemporary(temporary) }
    })
    this.queue = operation.catch(() => undefined); return operation
  }
}
