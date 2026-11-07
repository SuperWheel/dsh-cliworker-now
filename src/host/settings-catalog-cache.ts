import { isWorkBuddyCli } from './workbuddy-variant.ts'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  mkdirSync,
  chmodSync,
  realpathSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { join, resolve, dirname, parse } from 'node:path'
import { z } from 'zod'
import { CLI_IDS, EFFORTS, type CliId } from '../shared/types.ts'
import type { Catalog } from './adapters.ts'
import { atomicJSON } from './storage.ts'

const text = z.string().min(1).max(2048)
const schema = z
  .object({
    policy: z.literal(1),
    key: z.string().length(64),
    binding: z.string().min(1).max(256),
    catalog: z
      .object({
        cli: z.enum(CLI_IDS),
        notice: z.string().max(8192),
        models: z
          .array(
            z
              .object({
                id: text,
                label: text,
                efforts: z.array(z.enum(EFFORTS)).max(EFFORTS.length).optional(),
                variants: z.partialRecord(z.enum(EFFORTS), text).optional(),
                cost: z.enum(['free', 'paid', 'unknown']).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(4096),
      })
      .strict(),
  })
  .strict()
type Entry = z.infer<typeof schema>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const MAX_BYTES = 2 * 1024 * 1024
function privateDirectory(path: string): void {
  const ancestors: { path: string; dev: number; ino: number }[] = []
  const root = parse(resolve(path)).root
  for (let current = dirname(resolve(path)); ; current = dirname(current)) {
    const info = lstatSync(current)
    const trustedAlias =
      process.platform === 'darwin' &&
      ((current === '/tmp' && realpathSync(current) === '/private/tmp') ||
        (current === '/var' && realpathSync(current) === '/private/var'))
    if ((!info.isDirectory() || info.isSymbolicLink()) && !trustedAlias)
      throw new Error('模型目录缓存路径不可用')
    ancestors.push({ path: current, dev: info.dev, ino: info.ino })
    if (current === root) break
  }
  mkdirSync(path, { mode: 0o700, recursive: true })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('模型目录缓存路径不可用')
  for (const ancestor of ancestors) {
    const current = lstatSync(ancestor.path)
    if (current.dev !== ancestor.dev || current.ino !== ancestor.ino)
      throw new Error('模型目录缓存路径已变化')
  }
  chmodSync(path, 0o700)
}
function wait(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason ?? new Error('模型查询已取消'))
    }
    signal.addEventListener('abort', aborted, { once: true })
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

/** Display choices only, never execution authorization. Settings still discover
 * once per Host; a Worker may read a saved list matching its original account. */
export class SettingsCatalogCache {
  private ready = new Map<string, Entry>()
  private pending = new Map<string, Promise<void>>()
  private revisions = new Map<CliId, number>()
  private failed = new Set<string>()
  private directory: string
  constructor(root: string) {
    this.directory = join(root, 'settings-catalogs')
    privateDirectory(this.directory)
  }
  invalidate(cli: CliId): void {
    this.revisions.set(cli, (this.revisions.get(cli) ?? 0) + 1)
    for (const [key, entry] of this.ready) if (entry.catalog.cli === cli) this.ready.delete(key)
  }
  revision(cli: CliId): number {
    return this.revisions.get(cli) ?? 0
  }
  /** This Host's last verified display receipt. Never recovers a disk-only identity. */
  displayBinding(project: string, cli: CliId): string | undefined {
    const key = this.key(project, cli)
    if (this.pending.has(key) || this.failed.has(key)) return
    return this.ready.get(key)?.binding
  }
  private key(project: string, cli: CliId): string {
    return hash(JSON.stringify([process.platform, hostname(), project, cli]))
  }
  /** Local display read: no account lookup, CLI process or execution admission. */
  display(project: string, cli: CliId, binding: string): Catalog | undefined {
    const key = this.key(project, cli)
    if (this.pending.has(key) || this.failed.has(key)) return
    const entry = this.ready.get(key) ?? (this.revision(cli) === 0 ? this.previous(key) : undefined)
    if (entry?.catalog.cli !== cli || entry.binding !== binding) return
    return structuredClone(entry.catalog)
  }
  /** Save a freshly authorized directory without allowing an invalidated query
   * to republish its previous source. Used by the initial dispatch selection. */
  remember(project: string, result: { catalog: Catalog; binding: string }, revision: number): void {
    const cli = result.catalog.cli
    if (this.revision(cli) !== revision) throw new Error('模型来源已变化，请刷新重试')
    const key = this.key(project, cli)
    const entry = schema.parse({ policy: 1, key, ...result })
    const serialized = JSON.stringify(entry)
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('模型目录过大，请检查 CLI 配置')
    if (JSON.stringify(this.previous(key)) !== serialized) {
      privateDirectory(this.directory)
      atomicJSON(join(this.directory, `${key}.json`), entry)
    }
    this.ready.set(key, entry)
    this.failed.delete(key)
  }
  private previous(key: string): Entry | undefined {
    let fd: number | undefined
    let buffer: Buffer | undefined
    try {
      privateDirectory(this.directory)
      const path = join(this.directory, `${key}.json`),
        entry = lstatSync(path)
      if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > MAX_BYTES) return
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const info = fstatSync(fd)
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.dev !== entry.dev ||
        info.ino !== entry.ino ||
        info.size > MAX_BYTES
      )
        return
      buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const size = readSync(fd, buffer, length, buffer.length - length, null)
        if (!size) break
        length += size
      }
      const after = fstatSync(fd),
        current = lstatSync(path)
      if (
        length !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        after.nlink !== 1 ||
        current.isSymbolicLink() ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        current.nlink !== 1 ||
        current.size !== info.size ||
        current.mtimeMs !== info.mtimeMs
      )
        return
      const parsed = schema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')))
      return parsed.key === key ? parsed : undefined
    } catch {
      return undefined
    } finally {
      buffer?.fill(0)
      if (fd !== undefined) closeSync(fd)
    }
  }
  async get(input: {
    cli: CliId
    project: string
    signal: AbortSignal
    refresh?: boolean
    /** Qoder discovery itself verifies current account + complete sources before publishing. */
    selfVerifiedDiscovery?: boolean
    binding: () => Promise<string>
    discover: () => Promise<{ catalog: Catalog; binding: string }>
  }): Promise<{ catalog: Catalog; binding: string }> {
    const { cli, signal } = input
    const key = this.key(input.project, cli)
    // Serialize concurrent opens without letting a cancelled caller publish data.
    while (this.pending.has(key)) {
      signal.throwIfAborted()
      await wait(this.pending.get(key)!, signal)
    }
    signal.throwIfAborted()
    let release!: () => void
    this.pending.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    try {
      if (input.refresh) this.ready.delete(key)
      const revision = this.revision(cli)
      const current = this.ready.get(key)
      const binding = (cli === 'qoder' || cli === 'qodercn' || isWorkBuddyCli(cli)) && input.selfVerifiedDiscovery && !current ? undefined : await input.binding()
      signal.throwIfAborted()
      if (current && current.binding === binding) return structuredClone({ catalog: current.catalog, binding })
      this.ready.delete(key)
      const result = await input.discover()
      signal.throwIfAborted()
      if (this.revision(cli) !== revision || binding !== undefined && result.binding !== binding || result.catalog.cli !== cli || !result.catalog.models.length)
        throw new Error('模型来源已变化，请刷新重试')
      this.remember(input.project, result, revision)
      return structuredClone(result)
    } catch (error) {
      this.ready.delete(key)
      this.failed.add(key)
      throw error
    } finally {
      this.pending.delete(key)
      release()
    }
  }
}
