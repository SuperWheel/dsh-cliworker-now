import { observedPackages, safeObservation } from './observations.ts'
import { nativeLaunchArgv } from '../../native-launch.mjs'
import { createServer } from 'node:http'
import { createReadStream, constants } from 'node:fs'
import { open, lstat, readFile, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { ArtifactDescription } from './types.ts'
import { record, invalidArtifact, safeUrl } from './native.ts'
import { parseIntegrity } from '../download.ts'
import { privatePath } from './download.ts'
import { executeCliOperation } from '../executor.ts'
import { CliOperationError, boundOfficialEnv } from '../planner.ts'
/** No directory serving, redirects, proxying or metadata fallback; exact checked file map only. */
export async function startVerifiedRegistry(directory: string, paths: Record<string, string>, signal: AbortSignal) {
  signal.throwIfAborted()
  const token = randomBytes(32).toString('hex'), files = new Map<string, { path: string; ino: number; size: number; mtimeMs: number }>()
  for (const [urlPath, dest] of Object.entries(paths)) {
    const path = privatePath(directory, dest), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !urlPath.startsWith('/') || /[?#\\]/.test(urlPath)) invalidArtifact('环回 registry 文件不安全')
    files.set(`/${token}${urlPath}`, { path, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs })
  }
  const server = createServer((req, res) => { void (async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    const expected = files.get(req.url ?? '')
    if (!expected) { res.writeHead(404).end(); return }
    const handle = await open(expected.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let streaming = false
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 || info.ino !== expected.ino || info.size !== expected.size || info.mtimeMs !== expected.mtimeMs) { res.writeHead(409).end(); return }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store' })
      if (req.method === 'HEAD') { res.end(); return }
      const stream = handle.createReadStream({ autoClose: true }); streaming = true
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
    } finally { if (!streaming) await handle.close() }
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end() }) })
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxConnections = 32
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  let closing: Promise<void> | undefined
  const close = () => closing ??= new Promise<void>(resolve => { signal.removeEventListener('abort', abort); server.closeAllConnections(); server.close(() => resolve()) })
  const abort = () => { void close() }; signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) { await close(); signal.throwIfAborted() }
  return { url: `http://127.0.0.1:${address.port}/${token}/`, close }
}
export async function describePi(o: LocalArtifactOptions): Promise<ArtifactDescription> {
  const home = o.home ?? homedir(), platform = o.platform ?? process.platform, root = o.identity?.updateRoot ? join(o.identity.updateRoot, 'install') : join(home, '.pi/agent/install')
  const markerText = await safeObservation(join(root, 'managed-install.json')); if (!markerText) throw new CliOperationError('PREREQUISITE_MISSING', 'Pi 托管安装标记不可验证')
  const marker = JSON.parse(markerText.text)
  if (marker.kind !== 'pi-managed-install' || marker.layout !== 'releases-v1') throw new CliOperationError('PREREQUISITE_MISSING', 'Pi 不是已核实的托管安装')
  const base = `https://pi.dev/api/installer/releases/${o.version}`, lock = record(await o.releases.json(`${base}/package-lock.json`, o.signal)), release = record(await o.releases.json(base, o.signal))
  if (release.version !== o.version || lock.version !== o.version || lock.lockfileVersion !== 3 || !Array.isArray(release.packages)) invalidArtifact('Pi 发布清单或锁文件版本无效')
  const packages = record(lock.packages), paths: Record<string, string> = {}, pathIntegrity = new Map<string, string>(), files: ArtifactDescription['files'] = []
  for (const [key, value] of Object.entries(packages)) {
    if (!key) continue
    if (!key.startsWith('node_modules/')) invalidArtifact('Pi lock 出现非包条目')
    const item = record(value), url = safeUrl(item.resolved, 'https://registry.npmjs.org/')
    let integrity = item.integrity
    if (!integrity) {
      const match = release.packages.filter((p: any) => p.tarball === url && p.version === item.version && p.name === key.slice(key.lastIndexOf('node_modules/') + 13))
      if (match.length !== 1) invalidArtifact('Pi 缺失摘要无法由锁定发布清单补齐')
      integrity = match[0].integrity
    }
    if (typeof integrity !== 'string' || parseIntegrity(integrity).algorithm !== 'sha512') invalidArtifact('Pi 包没有 SHA-512')
    const pathname = new URL(url).pathname
    if (pathIntegrity.has(pathname) && pathIntegrity.get(pathname) !== integrity) invalidArtifact('Pi 重复包地址的摘要不一致')
    const dest = `packages/${files.length}.tgz`; paths[pathname] ??= dest; pathIntegrity.set(pathname, integrity)
    files.push({ sources: [url], bytes: 'RANGE', integrity, dest })
  }
  if (files.length !== 122) invalidArtifact('Pi 发布包数量已变化，需要复核清单')
  return { manifest: { urls: [base, `${base}/package-lock.json`], version: o.version, versionField: 'version', platformKey: 'managed' }, files, extras: [], allowedTargets: [], platform,
    placement: { kind: 'registry', argv: [o.identity!.executable, 'update', '--self'], paths }, officialProbe: { kind: 'stage', packageDirectory: join(root, 'staging'), packageCount: files.length } }
}
export async function placePi(description: ArtifactDescription, directory: string, signal: AbortSignal, o: LocalArtifactOptions) {
  const p = description.placement; if (p.kind !== 'registry') return
  const registry = await startVerifiedRegistry(directory, p.paths, signal)
  const startedAt = Date.now(), staging = description.officialProbe?.packageDirectory
  const baseline = new Set(staging ? await readdir(staging).catch(() => []) : [])
  let polling = Promise.resolve()
  const timer = setInterval(() => { if (staging) polling = polling.then(async () => {
    const count = await observedPackages(staging, startedAt, baseline), total = description.files.length
    o.progress({ channel: 'takeover', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0, stage: '官方安装已校验的包', currentStep: Math.min(count, total), totalSteps: total, stepName: `第 ${count}/${total} 个包`, elapsedSeconds: (Date.now() - startedAt) / 1000 })
  }).catch(() => undefined) }, 1000)
  try {
    await executeCliOperation(o.backend, o.config, nativeLaunchArgv(p.argv), signal, o.output, 10 * 60_000, { ...boundOfficialEnv('pi', o.identity!), npm_config_registry: registry.url, npm_config_cache: join(directory, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' })
  } finally { clearInterval(timer); await polling; await registry.close() }
}
