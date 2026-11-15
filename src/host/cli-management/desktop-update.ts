import { WORKBUDDY_COS_POLICY, readWorkBuddyCos, workbuddyWindowsUrl, verifyWorkBuddyWindowsSignature, type WorkBuddyCosIntegrity } from './workbuddy-windows.ts'
import { trackUpdateTemporary, retainUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { physicalFs } from './physical-fs.ts'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { isAlias, isPair, isScalar, parseDocument, visit } from 'yaml'
import { hostFetch } from '../host-fetch.mjs'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { CliOperationError } from './planner.ts'
import { bounded } from './versions.ts'
import { installDesktop, desktopSignatureRequirement } from './desktop.ts'
import { DESKTOP_INSTALL_SOURCES } from './sources.ts'

// App bundles contain app.asar; Electron's patched fs would treat it as a directory.
const { access, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } = physicalFs().promises

export type DesktopCli = 'zcode' | 'workbuddycn' | 'workbuddy'
export interface DesktopRelease { version: string; url: string; sha512?: string; sha256?: string; size?: number; teamId?: string; integrityPolicy?: typeof WORKBUDDY_COS_POLICY }
export class DesktopUnavailableError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'DesktopUnavailableError' }
}

const FEED_LIMIT = 512 * 1024, ARTIFACT_LIMIT = 1024 ** 3
const names: Record<DesktopCli, string> = { zcode: 'ZCode', workbuddycn: 'WorkBuddy CN', workbuddy: 'WorkBuddy' }
// Existing application signatures, confirmed by the coordinator on 2026-11-13.
const pinnedTeams: Partial<Record<DesktopCli, string>> = { zcode: '8A5X4JJ39T', workbuddycn: 'FN2V63AD2J' }
const unavailable = (reason: string): never => { throw new DesktopUnavailableError(reason) }
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable('官方更新源的元数据格式无效')
  return value as Record<string, unknown>
}
function version(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^\d+\.\d+\.\d+(?:\.\d+)?(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(value)) return unavailable('官方更新源的版本号无效')
  return value
}
function size(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > ARTIFACT_LIMIT) return unavailable('官方安装包大小必须为 1 B 至 1 GiB 的整数')
  return value
}
function artifactUrl(cli: DesktopCli, value: unknown, platform: string, expectedVersion: string, feedArch?: string): string {
  if (typeof value !== 'string') return unavailable('官方更新源没有提供下载地址')
  let url: URL, path: string
  try { url = new URL(value); path = decodeURIComponent(url.pathname) }
  catch { return unavailable('官方更新源的下载地址无效') }
  const host = cli === 'zcode' ? 'cdn-zcode.z.ai' : cli === 'workbuddycn' ? 'download.codebuddy.cn' : 'download.codebuddy.ai'
  if (cli === 'workbuddy' && platform === 'win32') {
    try { return workbuddyWindowsUrl(value, expectedVersion, feedArch) } catch { return unavailable('官方下载地址不在已核实的应用下载白名单内') }
  }
  const prefix = cli === 'zcode' ? '/zcode/electron/releases/' : '/workbuddy/saas/'
  // The international macOS feed hashes the same-name DMG, as does the website's
  // download mapping. Validate the raw ZIP URL before replacing only its suffix.
  // Execution revalidates the selected DMG; it never remaps arbitrary artifacts.
  if (cli === 'workbuddy' && platform === 'darwin') {
    const match = /^\/workbuddy\/saas\/darwin-(arm64|x64)\/WorkBuddy-darwin-\1-(\d+\.\d+\.\d+(?:\.\d+)?)-[a-f0-9]{8}\.(zip|dmg)$/.exec(url.pathname)
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port || url.search || url.hash ||
        value !== url.href || !value.endsWith(feedArch ? '.zip' : '.dmg') || path !== url.pathname || !match || match[2] !== expectedVersion ||
        match[3] !== (feedArch ? 'zip' : 'dmg') || feedArch && match[1] !== feedArch) {
      return unavailable('官方下载地址不在已核实的应用下载白名单内')
    }
    return feedArch ? value.slice(0, -4) + '.dmg' : value
  }
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port || url.hash ||
      !path.startsWith(prefix) || path.split('/').some(part => part === '..' || part === '.') || path.includes('\\') ||
      !path.endsWith(platform === 'darwin' ? '.zip' : '.exe') || cli !== 'zcode' && platform === 'win32' && !/^\/workbuddy\/saas\/win32-(x64|arm64)-user\//.test(path)) {
    return unavailable('官方下载地址不在已核实的应用下载白名单内')
  }
  return url.href
}
function checkedRelease(cli: DesktopCli, release: DesktopRelease, platform: string, feedArch?: string): DesktopRelease {
  const target = version(release.version)
  const result: DesktopRelease = { version: target, url: artifactUrl(cli, release.url, platform, target, feedArch) }
  if (cli === 'zcode') {
    const sha = release.sha512
    if (!sha) return unavailable('官方更新源没有提供校验值，暂不能自动更新')
    if (!/^[A-Za-z0-9+/]{86}==$/.test(sha) || Buffer.from(sha, 'base64').toString('base64') !== sha) return unavailable('官方 SHA-512 校验值格式无效')
    result.sha512 = sha; result.size = size(release.size)
  } else if (cli === 'workbuddy' && platform === 'win32' && (release.sha256 === '' || release.sha256 === undefined && release.integrityPolicy === WORKBUDDY_COS_POLICY)) {
    result.integrityPolicy = WORKBUDDY_COS_POLICY
    if (release.size !== undefined) result.size = size(release.size)
  } else {
    if (!release.sha256) return unavailable('官方更新源没有提供校验值，暂不能自动更新')
    if (!/^[a-f\d]{64}$/i.test(release.sha256)) return unavailable('官方 SHA-256 校验值格式无效')
    result.sha256 = release.sha256.toLowerCase()
    if (release.size !== undefined) result.size = size(release.size)
  }
  if (pinnedTeams[cli]) result.teamId = pinnedTeams[cli]
  if (cli === 'workbuddy' && platform === 'darwin') result.teamId = DESKTOP_INSTALL_SOURCES.workbuddy.teamId
  return result
}
function parseManifest(text: string): Record<string, unknown> {
  // Existing yaml dependency; no custom tags, aliases, merge keys or duplicate keys.
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, strict: true })
  if (doc.errors.length || doc.warnings.length) return unavailable('官方 YAML 更新清单格式无效')
  visit(doc, (_key, node, path) => {
    if (isPair(node) && isScalar(node.key) && node.key.value === '<<') unavailable('官方 YAML 更新清单包含不支持的合并键')
    if (path.length > 32 || isAlias(node) || node && typeof node === 'object' &&
        ('tag' in node && node.tag || 'anchor' in node && node.anchor)) unavailable('官方 YAML 更新清单包含不支持的标签、引用或嵌套')
  })
  return record(doc.toJS({ maxAliasCount: 0 }))
}

export async function readDesktopRelease(cli: DesktopCli, current: { appVersion?: string }, signal: AbortSignal,
  deps?: { fetcher?: typeof hostFetch; platform?: string; arch?: string }): Promise<DesktopRelease> {
  const platform = deps?.platform ?? process.platform, arch = deps?.arch ?? process.arch
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) return unavailable('此平台或处理器架构暂不支持桌面应用自动更新')
  signal.throwIfAborted()
  const url = cli === 'zcode'
    ? new URL(`https://zcode.z.ai/api/v1/releases/electron/manifest?platform=${platform === 'darwin' ? 'darwin' : 'windows'}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}&channel=1`)
    : new URL(`https://www.workbuddy.${cli === 'workbuddycn' ? 'cn' : 'ai'}/v2/update`)
  if (cli !== 'zcode') {
    url.searchParams.set('platform', `workbuddy-${platform}-${arch}${platform === 'win32' ? '-user' : ''}`)
    url.searchParams.set('version', current.appVersion ? version(current.appVersion) : '0.0.0')
  }
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 8000)
  const control = AbortSignal.any([signal, deadline.signal])
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await bounded((deps?.fetcher ?? hostFetch)(url.href, { signal: control, credentials: 'omit', redirect: 'error' }), control)
    reader = response.body?.getReader()
    if (response.status === 204) return unavailable('官方更新源未提供更新，当前应用可能已是最新版本')
    if (response.status !== 200 || response.redirected) return unavailable(`无法读取官方更新源（HTTP ${response.status}）`)
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > FEED_LIMIT)) return unavailable('官方更新源响应超过 512 KiB 上限')
    if (!reader) return unavailable('官方更新源返回了空响应')
    const chunks: Uint8Array[] = []; let bytes = 0
    for (;;) {
      const part = await bounded(reader.read(), control)
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > FEED_LIMIT) return unavailable('官方更新源响应超过 512 KiB 上限')
      chunks.push(part.value)
    }
    control.throwIfAborted()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    const data = cli === 'zcode' ? parseManifest(text) : record(JSON.parse(text))
    if (cli === 'zcode') {
      if (!Array.isArray(data.files)) return unavailable('官方更新清单没有文件列表')
      const suffix = platform === 'darwin' ? '.zip' : '.exe'
      const file = data.files.find((entry: unknown) => {
        const item = record(entry)
        try { return typeof item.url === 'string' && new URL(item.url).pathname.endsWith(suffix) } catch { return false }
      })
      if (!file) return unavailable('官方更新清单没有此平台的安装包')
      return checkedRelease(cli, { ...record(file), version: data.version } as unknown as DesktopRelease, platform)
    }
    return checkedRelease(cli, { version: data.version, url: data.url, sha256: data.sha256hash, size: data.size } as DesktopRelease, platform, arch)
  } catch (error) {
    signal.throwIfAborted()
    if (deadline.signal.aborted) return unavailable('读取官方更新源超过 8 秒，请稍后重试')
    if (error instanceof DesktopUnavailableError) throw error
    return unavailable('无法读取或解析官方更新源，请稍后重试')
  } finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined) }
}

/** The fixed public run callback returns no output. These read-only probes need a
 * separate seam; tests replace capture and never launch native processes. */
export const desktopUpdateIo = {
  access, rename, rm,
  capture(argv: string[], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      // Wait for close, including on cancellation, before returning to cleanup.
      let failure: Error | null = null, output = ''
      const child = execFile(argv[0]!, argv.slice(1), { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30_000, killSignal: 'SIGKILL', signal, shell: false }, (error, stdout, stderr) => {
        failure = error; output = stdout + '\n' + stderr
      })
      const abort = () => { child.kill('SIGKILL') }
      signal.addEventListener('abort', abort, { once: true })
      child.once('close', () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) reject(signal.reason)
        else if (failure) reject(failure)
        else resolve(output)
      })
      if (signal.aborted) abort()
    })
  },
}

export async function runDesktopUpdate(options: {
  cli: DesktopCli; appPath: string; release: DesktopRelease; root: string; signal: AbortSignal
  download(url: string, expected: { sha512?: string; sha256?: string; size?: number; cos?: WorkBuddyCosIntegrity }, signal: AbortSignal): Promise<string>
  run(argv: string[], signal: AbortSignal): Promise<void>; awaiting(): void; platform?: string; fetcher?: typeof hostFetch
}): Promise<{ appPath: string }> {
  const { cli, appPath, signal, run } = options, platform = options.platform ?? process.platform
  if (!['darwin', 'win32'].includes(platform)) return unavailable('此平台暂不支持桌面应用自动更新')
  signal.throwIfAborted()
  const release = checkedRelease(cli, options.release, platform)
  const download = () => options.download(release.url, { sha512: release.sha512, sha256: release.sha256, size: release.size }, signal)
  if (platform === 'win32') {
    const cos = release.integrityPolicy === WORKBUDDY_COS_POLICY ? await readWorkBuddyCos(release.url, release.version, release.size, signal, options.fetcher) : undefined
    const file = cos ? await options.download(release.url, { size: cos.size, cos }, signal) : await download(); signal.throwIfAborted()
    let temporaryExe: string | undefined, operationError: unknown
    try {
      if (cli === 'workbuddy' || !file.toLowerCase().endsWith('.exe')) {
        const parent = dirname(file), info = await lstat(parent), artifact = await lstat(file)
        if (!info.isDirectory() || info.isSymbolicLink() || !artifact.isFile() || artifact.isSymbolicLink()) throw new CliOperationError('LOCATION_INVALID', '安装包必须位于实际的私有下载目录中')
        await chmod(parent, 0o700)
        // The verified download remains in its cache; only this execution copy is removed.
        const executionCopy = trackUpdateTemporary(join(parent, `${randomUUID()}.exe`))
        await copyFile(file, executionCopy, constants.COPYFILE_EXCL)
        temporaryExe = executionCopy
        await chmod(temporaryExe, 0o600)
      }
      signal.throwIfAborted()
      if (cli === 'workbuddy') await verifyWorkBuddyWindowsSignature(temporaryExe ?? file, signal, desktopUpdateIo.capture)
      options.awaiting(); signal.throwIfAborted()
      await run([temporaryExe ?? file], signal); signal.throwIfAborted()
      return { appPath }
    } catch (error) { operationError = error; throw error }
    finally {
      if (temporaryExe) {
        if (operationError instanceof ProcessCleanupUnconfirmedError) retainUpdateTemporary(temporaryExe)
        else await removeUpdateTemporary(temporaryExe)
      }
    }
  }
  let stage: string | undefined, sibling: string | undefined, backup: string | undefined
  let movedOld = false, movedNew = false, committed = false, operationError: unknown
  const ensureStopped = async (canonical: string) => {
    try {
      const commands = await desktopUpdateIo.capture(['/bin/ps', '-axo', 'command='], signal)
      signal.throwIfAborted()
      if (commands.includes(`${appPath}/Contents/MacOS/`) || commands.includes(`${canonical}/Contents/MacOS/`)) throw new Error('running')
    } catch {
      signal.throwIfAborted()
      throw new CliOperationError('CLI_BUSY', `请先退出 ${names[cli]} 再更新`)
    }
  }
  try {
    if (!isAbsolute(appPath) || !appPath.endsWith('.app')) throw new CliOperationError('LOCATION_INVALID', '更新目标必须是现有应用的绝对 .app 路径')
    const original = await lstat(appPath)
    if (!original.isDirectory() || original.isSymbolicLink()) throw new CliOperationError('LOCATION_INVALID', '更新目标不是实际应用目录')
    const canonical = await realpath(appPath), parent = dirname(appPath)
    await desktopUpdateIo.access(parent, constants.W_OK | constants.X_OK)
    await ensureStopped(canonical)
    const teamId = cli === 'workbuddy' ? DESKTOP_INSTALL_SOURCES.workbuddy.teamId : pinnedTeams[cli]!
    const file = await download(); signal.throwIfAborted()
    const cache = join(options.root, 'cli-management')
    await mkdir(cache, { recursive: true, mode: 0o700 })
    const cacheInfo = await lstat(cache)
    if (!cacheInfo.isDirectory() || cacheInfo.isSymbolicLink()) throw new CliOperationError('LOCATION_INVALID', '更新缓存不是实际目录')
    await chmod(cache, 0o700)
    stage = trackUpdateTemporary(await mkdtemp(join(cache, 'desktop-update-'))); await chmod(stage, 0o700)
    if (cli === 'workbuddy') {
      // Reuse the installation DMG lifecycle, including detach on failure and
      // cleanup isolation. The old app is untouched until staging has completed.
      await installDesktop({ source: { ...DESKTOP_INSTALL_SOURCES.workbuddy, url: release.url, version: release.version, archive: 'dmg' },
        root: options.root, file, directory: stage, platform, signal, run, awaiting: options.awaiting })
    } else await run(['/usr/bin/ditto', '-x', '-k', file, stage], signal)
    signal.throwIfAborted()
    const apps = (await readdir(stage)).filter(name => name.endsWith('.app'))
    if (apps.length !== 1) throw new CliOperationError('IDENTITY_CHANGED', '更新包必须包含唯一的应用目录')
    const extracted = join(stage, apps[0]!)
    const info = await lstat(extracted)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CliOperationError('IDENTITY_CHANGED', '更新包中的应用目录无效')
    const verify = async (app: string) => {
      await run(['/usr/bin/codesign', '--verify', '--deep', '--strict', desktopSignatureRequirement({ teamId, ...(cli === 'workbuddy' ? { bundleId: DESKTOP_INSTALL_SOURCES.workbuddy.bundleId } : {}) }), app], signal)
      await run(['/usr/sbin/spctl', '--assess', '--type', 'execute', app], signal)
      signal.throwIfAborted()
    }
    await verify(extracted)
    // Copy before renaming: the private cache may be on another volume.
    sibling = trackUpdateTemporary(await mkdtemp(join(parent, '.cliworker-update-'))); await chmod(sibling, 0o700)
    const incoming = join(sibling, basename(appPath)); backup = join(sibling, 'previous.app')
    await run(['/usr/bin/ditto', extracted, incoming], signal)
    await verify(incoming)
    await ensureStopped(canonical)
    const beforeSwap = await lstat(appPath)
    if (beforeSwap.dev !== original.dev || beforeSwap.ino !== original.ino || beforeSwap.isSymbolicLink()) throw new CliOperationError('IDENTITY_CHANGED', '应用目录在更新期间发生变化，请重新检查')
    signal.throwIfAborted()
    await desktopUpdateIo.rename(appPath, backup); movedOld = true
    signal.throwIfAborted()
    await desktopUpdateIo.rename(incoming, appPath); movedNew = true
    signal.throwIfAborted()
    // Finish fallible staging cleanup while a complete old app is still available.
    await removeUpdateTemporary(stage); stage = undefined
    signal.throwIfAborted()
    committed = true
    // After commit, a failed backup cleanup must never restore a partly deleted app.
    await removeUpdateTemporary(backup); movedOld = false
    return { appPath }
  } catch (error) {
    operationError = error
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      operationError = new CliOperationError('PERMISSION_DENIED', '当前用户没有应用目录的写入权限，请为该目录授予写入权限后重试')
    }
    throw operationError
  } finally {
    const cleanupErrors: unknown[] = []
    if (movedOld && !committed && backup) {
      try {
        if (movedNew) await desktopUpdateIo.rename(appPath, join(sibling!, 'failed.app'))
        await desktopUpdateIo.rename(backup, appPath); movedOld = false
      } catch (error) { cleanupErrors.push(error) }
    }
    if (operationError instanceof ProcessCleanupUnconfirmedError) {
      if (stage) retainUpdateTemporary(stage)
      if (sibling) retainUpdateTemporary(sibling)
    } else if (stage) await removeUpdateTemporary(stage)
    // Never delete the last old copy when rollback or backup cleanup failed.
    if (sibling && movedOld) retainUpdateTemporary(sibling)
    if (sibling && !movedOld && !(operationError instanceof ProcessCleanupUnconfirmedError)) await removeUpdateTemporary(sibling)
    if (cleanupErrors.length) {
      if (operationError instanceof ProcessCleanupUnconfirmedError) {
        operationError.cause = new AggregateError([operationError.cause, ...cleanupErrors], '更新进程与临时目录清理未完成')
        throw operationError
      }
      // Surface the real cause: the first failure plus the cleanup errno and path, never a generic message.
      const detail = cleanupErrors.map((error) => {
        const e = error as NodeJS.ErrnoException
        return [e?.code, e?.path ?? (error instanceof Error ? error.message : String(error))].filter(Boolean).join(' ')
      }).join('；')
      const cleanup = movedOld ? `更新恢复未完成，旧应用保留在 ${backup}（${detail}）` : `临时目录清理失败（${detail}）`
      if (operationError instanceof CliOperationError) {
        const first = operationError.message.replace(/^[A-Z_]+：/, '')
        throw new CliOperationError(operationError.code, `${first}；${cleanup}`)
      }
      throw new CliOperationError(movedOld ? 'IDENTITY_CHANGED' : 'UNKNOWN', operationError instanceof Error ? `${operationError.message}；${cleanup}` : cleanup)
    }
  }
}
