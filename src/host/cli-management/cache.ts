import { chmodSync, constants, closeSync, fstatSync, fchmodSync, readSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CLI_IDS, type ActiveCliId } from '../../shared/types.ts'
import { CLI_DOWNLOAD_SOURCES, CLI_INSTALL_SOURCES, CLI_UPDATE_GROUPS, CLI_UPDATE_REASONS, customRegistryProblem, type CliUpdateEntry, type CliDownloadSourceSettings } from '../../shared/cli-management.ts'
import type { AccountStatus } from '../../shared/accounts.ts'
import { atomicJSON } from '../storage.ts'
import { fingerprintToken, type Fingerprint } from './identity.ts'
import { validVersion, validAppVersion, type ReleaseRecord } from './versions.ts'
export const RELEASE_TTL = 6 * 60 * 60 * 1000, ACCOUNT_TTL = 10 * 60 * 1000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const version = z.string().refine(v => validVersion(v) || validAppVersion(v)), time = z.number().finite().nonnegative()
const fingerprintSchema = z.object({ realpath: z.string().max(4096), size: time, mtimeMs: time, appVersion: z.string().max(128).optional(), manifestVersion: z.string().max(128).optional(), metadataToken: z.string().length(64).optional() }).strict()
const entrySchema = z.object({ cli: z.enum(CLI_IDS), group: z.enum(CLI_UPDATE_GROUPS), installed: z.boolean(), source: z.enum(CLI_INSTALL_SOURCES).optional(), currentVersion: version.optional(), appVersion: version.optional(), notice: z.string().max(2048).optional(), channel: z.string().max(64).optional(), latestVersion: version.optional(), latestCompatibleVersion: version.optional(), checkedAt: time.optional(), latestCheckedAt: time.optional(), mirrored: z.boolean().optional(), reason: z.enum(CLI_UPDATE_REASONS).optional(), planToken: z.string().length(64).optional() }).strict()
const accountSchema = z.object({ cli: z.enum(CLI_IDS), installed: z.boolean(), state: z.enum(['authenticated', 'unconfigured', 'unauthenticated', 'configured', 'unknown', 'unavailable']), accountLabel: z.string().max(256).optional(), authMethod: z.enum(['oauth', 'api']).optional(), verification: z.enum(['cli', 'local']).optional() }).strict()
const url = z.string().max(2048).transform(value => value.trim()).refine(value => !customRegistryProblem(value))
export const downloadSettingsSchema = z.object({ source: z.enum(CLI_DOWNLOAD_SOURCES), customUrl: url.optional() }).strict().refine(s => s.source !== 'custom' || !!s.customUrl)
const stateSchema = z.object({ policy: z.literal(2),
  entries: z.partialRecord(z.enum(CLI_IDS), entrySchema),
  versions: z.partialRecord(z.enum(CLI_IDS), z.object({ fingerprint: fingerprintSchema, version: version.optional() }).strict()),
  releases: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ latest: version, versions: z.array(version).max(10000), checkedAt: time, registry: url }).strict()),
  accounts: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ checkedAt: time, value: accountSchema }).strict()),
  settings: downloadSettingsSchema,
}).strict()
type State = z.infer<typeof stateSchema>
const empty = (): State => ({ policy: 2, entries: {}, versions: {}, releases: {}, accounts: {}, settings: { source: 'follow' } })
const summaries: Record<AccountStatus['state'], string> = { authenticated: '已登录', configured: '已配置', unconfigured: '尚未配置', unauthenticated: '未登录或登录已过期', unknown: '登录状态未知', unavailable: '暂时无法读取登录状态' }
/** Display data only. Account action handles and all command output are deliberately excluded. */
export class CliManagementCache {
  readonly file: string
  private directory: string
  private state: State = empty()
  private accountEpochs = new Map<ActiveCliId, number>()
  constructor(root: string) {
    this.directory = join(root, 'cli-management')
    this.file = join(this.directory, `state-${process.platform}-${hash(hostname())}.json`)
    let fd: number | undefined
    try {
      this.prepare()
      const info = lstatSync(this.file)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) return
      fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const opened = fstatSync(fd)
      if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size) return
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) { const bytes = readSync(fd, buffer, length, buffer.length - length, null); if (!bytes) break; length += bytes }
      const after = fstatSync(fd)
      if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) return
      this.state = stateSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')))
      fchmodSync(fd, 0o600)
    } catch { this.state = empty() } finally { if (fd !== undefined) closeSync(fd) }
  }
  private prepare() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const info = lstatSync(this.directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('CLI cache directory invalid')
    chmodSync(this.directory, 0o700)
  }
  private save() { this.prepare(); atomicJSON(this.file, stateSchema.parse(this.state)) }
  entries(): CliUpdateEntry[] { return structuredClone(Object.values(this.state.entries)) }
  rememberEntry(entry: CliUpdateEntry) {
    const { cli, group, installed, source, currentVersion, appVersion, notice, channel, latestVersion, latestCompatibleVersion, checkedAt, latestCheckedAt, mirrored, reason, planToken } = entry
    this.state.entries[cli] = entrySchema.parse({ cli, group, installed, source, currentVersion, appVersion, notice, channel, latestVersion, latestCompatibleVersion, checkedAt, latestCheckedAt, mirrored, reason, planToken }); this.save()
  }
  version(cli: ActiveCliId, fingerprint: Fingerprint) {
    const old = this.state.versions[cli]
    return old && fingerprintToken(old.fingerprint) === fingerprintToken(fingerprint) ? { version: old.version } : undefined
  }
  rememberVersion(cli: ActiveCliId, fingerprint: Fingerprint, value?: string) { this.state.versions[cli] = { fingerprint, version: value }; this.save() }
  invalidateVersion(cli: ActiveCliId) { delete this.state.versions[cli]; this.save() }
  releaseKey(cli: ActiveCliId, source: string, registry: string) { return hash(JSON.stringify([cli, source, registry])) }
  release(key: string, now = Date.now()): ReleaseRecord | undefined {
    const value = this.state.releases[key]; return value && now >= value.checkedAt && now - value.checkedAt < RELEASE_TTL ? structuredClone(value) : undefined
  }
  rememberRelease(key: string, value: ReleaseRecord) { this.state.releases[key] = value; this.save() }
  settings(): CliDownloadSourceSettings { return { ...this.state.settings } }
  saveSettings(input: unknown): CliDownloadSourceSettings {
    const settings = downloadSettingsSchema.parse(input)
    if (JSON.stringify(settings) !== JSON.stringify(this.state.settings)) this.state.releases = {}
    this.state.settings = settings; this.save(); return this.settings()
  }
  accountRevision(cli: ActiveCliId) { return this.accountEpochs.get(cli) ?? 0 }
  invalidateAccount(cli: ActiveCliId) {
    this.accountEpochs.set(cli, this.accountRevision(cli) + 1)
    for (const [key, entry] of Object.entries(this.state.accounts)) if (entry.value.cli === cli) delete this.state.accounts[key]
    this.save()
  }
  private accountKey(cli: ActiveCliId, project: string) { return hash(JSON.stringify([cli, resolve(project)])) }
  account(cli: ActiveCliId, project: string, now = Date.now()): (AccountStatus & { cache: { checkedAt: number; stale: boolean; displayOnly: true } }) | undefined {
    const entry = this.state.accounts[this.accountKey(cli, project)]
    if (!entry) return
    return { ...entry.value, summary: summaries[entry.value.state], actions: [], cache: { checkedAt: entry.checkedAt, stale: now < entry.checkedAt || now - entry.checkedAt >= ACCOUNT_TTL, displayOnly: true } }
  }
  rememberAccount(cli: ActiveCliId, project: string, status: AccountStatus, revision = this.accountRevision(cli)) {
    if (revision !== this.accountRevision(cli) || status.cleanupBlocked) return
    // Do not persist summaries, source ids, route URLs, login handles or provider outputs.
    const label = status.authMethod === 'oauth' && status.accountLabel && !/(?:bearer|token|secret|api[_ -]?key|sk-|cookie|https?:)/i.test(status.accountLabel) ? status.accountLabel.slice(0, 256) : undefined
    const value = accountSchema.parse({ cli, installed: status.installed, state: status.state, accountLabel: label, authMethod: status.authMethod, verification: status.verification })
    this.state.accounts[this.accountKey(cli, project)] = { checkedAt: Date.now(), value }; this.save()
  }
}
