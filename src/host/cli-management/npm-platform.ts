import { createHash } from 'node:crypto'
import { mkdir, chmod, lstat } from 'node:fs/promises'
import { atomicJSON } from '../storage.ts'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { maxSatisfying, satisfies, valid, validRange } from 'semver'
import { z } from 'zod'
import { OFFICIAL_NPM_REGISTRY, NPMMIRROR_REGISTRY, customRegistryProblem } from '../../shared/cli-management.ts'
import { readManifest, type InstallationIdentity } from './identity.ts'
import { CliOperationError } from './planner.ts'
import { ReleaseClient, RELEASE_VERSIONS_LIMIT } from './versions.ts'
import type { ArtifactFile } from './artifacts/types.ts'

const packageName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_][a-z0-9_.-]*$/i
const manifestSchema = z.object({ name: z.string().regex(packageName), version: z.string().refine(v => !!valid(v)),
  os: z.array(z.string()).optional(), cpu: z.array(z.string()).optional(), libc: z.array(z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  dist: z.object({ tarball: z.string(), integrity: z.string().max(1024).optional(), shasum: z.string().optional() }).optional(),
})
export type NpmManifest = z.infer<typeof manifestSchema>
export interface NpmHost { platform: NodeJS.Platform; arch: string; libc?: string }
export function npmDependency(alias: string, value: string): { alias: string; name: string; range: string } {
  const match = value.startsWith('npm:') ? /^(?:npm:)((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(value) : undefined
  const name = match ? match[1]! : alias, range = match ? match[2]! : value
  if (!packageName.test(alias) || !packageName.test(name) || value.startsWith('npm:') && !match || !validRange(range))
    throw new CliOperationError('PREREQUISITE_MISSING', `无法核实 npm 平台依赖 ${alias} 的版本范围`)
  return { alias, name, range }
}
function matches(values: string[] | undefined, actual: string | undefined) {
  if (!values?.length) return true
  if (!actual || values.includes(`!${actual}`)) return false
  return values.includes('any') || values.includes(actual) || values.every(v => v.startsWith('!'))
}
export const npmPlatformMatches = (m: NpmManifest, host: NpmHost) => matches(m.os, host.platform) && matches(m.cpu, host.arch) && (host.platform !== 'linux' || matches(m.libc, host.libc))
const platformRestricted = (m: NpmManifest) => !!(m.os?.length || m.cpu?.length || m.libc?.length)
const cache = new WeakMap<ReleaseClient, Map<string, { at: number; manifest: NpmManifest }>>()
/** Only public manifests, never npmrc, auth or account files. Failed requests are not cached. */
export async function npmManifest(releases: ReleaseClient, name: string, range: string, registry: string, signal: AbortSignal): Promise<NpmManifest> {
  npmDependency(name, range)
  const key = JSON.stringify([registry, name, range]), entries = cache.get(releases) ?? new Map()
  cache.set(releases, entries)
  const cached = entries.get(key)
  signal.throwIfAborted()
  if (cached && Date.now() - cached.at < 6 * 60 * 60_000) return cached.manifest
  const base = registry.endsWith('/') ? registry : registry + '/'
  let data: unknown
  if (valid(range)) data = await releases.json(new URL(`${encodeURIComponent(name)}/${encodeURIComponent(range)}`, base).href, signal)
  else {
    const packument = JSON.parse(await releases.text(new URL(encodeURIComponent(name), base).href, signal, RELEASE_VERSIONS_LIMIT)) as { versions?: Record<string, unknown> }
    const version = maxSatisfying(Object.keys(packument.versions ?? {}), range)
    if (!version) throw new CliOperationError('PREREQUISITE_MISSING', `没有满足 ${name}@${range} 的平台组件版本`)
    data = packument.versions![version]
  }
  const manifest = manifestSchema.parse(data)
  if (manifest.name !== name || !satisfies(manifest.version, range)) throw new CliOperationError('INTEGRITY_MISMATCH', `npm 清单身份不符：${name}`)
  if (entries.size >= 512) entries.delete(entries.keys().next().value!)
  entries.set(key, { at: Date.now(), manifest }); return manifest
}
export interface NpmComponent { alias: string; manifest: NpmManifest }
export async function npmPlatformComponents(main: NpmManifest, releases: ReleaseClient, registry: string, signal: AbortSignal, host: NpmHost): Promise<NpmComponent[]> {
  const dependencies = Object.entries(main.optionalDependencies ?? {})
  if (dependencies.length > 128) throw new CliOperationError('PREREQUISITE_MISSING', 'npm 平台组件清单超过上限')
  // ReleaseClient bounds concurrent HTTP requests; await all callers before returning on failure.
  const outcomes = await Promise.allSettled(dependencies.map(async ([alias, value]) => {
    const dep = npmDependency(alias, value), manifest = await npmManifest(releases, dep.name, dep.range, registry, signal)
    return platformRestricted(manifest) && npmPlatformMatches(manifest, host) ? { alias, manifest } : undefined
  }))
  const failed = outcomes.find(r => r.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return outcomes.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
}
export function npmDigest(m: NpmManifest): string {
  if (m.dist?.integrity) return m.dist.integrity
  if (/^[a-f0-9]{40}$/i.test(m.dist?.shasum ?? '')) return `sha1-${Buffer.from(m.dist!.shasum!, 'hex').toString('base64')}`
  throw new CliOperationError('INTEGRITY_MISMATCH', `npm 包 ${m.name} 缺少官方摘要`)
}
export async function npmArtifact(manifest: NpmManifest, releases: ReleaseClient, registry: string, signal: AbortSignal, automaticSources: boolean, dest: string): Promise<ArtifactFile> {
  const official = new URL(registry).href === OFFICIAL_NPM_REGISTRY ? manifest : await npmManifest(releases, manifest.name, manifest.version, OFFICIAL_NPM_REGISTRY, signal)
  const integrity = npmDigest(official)
  if (npmDigest(manifest) !== integrity) throw new CliOperationError('INTEGRITY_MISMATCH', `npm 包 ${manifest.name} 下载源摘要与官方不符`)
  // Platform selection and alias edges must agree with the trust root too.
  const canonical = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v && typeof v === 'object' ? Object.entries(v).sort(([a], [b]) => a.localeCompare(b)) : v)
  for (const key of ['os', 'cpu', 'libc', 'optionalDependencies'] as const)
    if (canonical(manifest[key]) !== canonical(official[key])) throw new CliOperationError('INTEGRITY_MISMATCH', `npm 包 ${manifest.name} 平台清单与官方不符`)
  const url = manifest.dist?.tarball, officialUrl = official.dist?.tarball
  if (!url || !officialUrl || customRegistryProblem(url) || customRegistryProblem(officialUrl)) throw new CliOperationError('NETWORK', 'npm 工件地址必须为不含凭据的 HTTPS 地址')
  if (!automaticSources) return { dest, sources: [url], integrity }
  const name = manifest.name, filename = `${name.split('/').at(-1)}-${manifest.version}.tgz`
  const mirror = new URL(`${name}/-/${filename}`, NPMMIRROR_REGISTRY).href
  const officialPath = new URL(`${name}/-/${filename}`, OFFICIAL_NPM_REGISTRY).href
  const selectedPath = new URL(`${name}/-/${filename}`, registry.endsWith('/') ? registry : registry + '/').href
  return { dest, sources: [...new Set([officialPath, selectedPath, mirror])], integrity,
    sourceRedirects: { [mirror]: `https://cdn.npmmirror.com/packages/${name.split('/').map(encodeURIComponent).join('/')}/${manifest.version}/${filename}` } }
}
export class NpmInstallationError extends CliOperationError {
  constructor(message: string) { super('VERSION_MISMATCH', message) }
}
/** Resolve in the installed tree (including npm-hoisted siblings), under its own prefix only. */
async function installedDependency(root: string, alias: string, prefix: string): Promise<NpmManifest | undefined> {
  let directory = resolve(root)
  const boundary = resolve(prefix), within = relative(boundary, directory)
  if (within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(within)) throw new NpmInstallationError('npm 安装组件目录不在已核实的前缀内')
  for (;;) {
    const raw = await readManifest(join(directory, 'node_modules', alias, 'package.json'))
    if (raw) { const parsed = manifestSchema.safeParse(raw); return parsed.success ? parsed.data : undefined }
    if (!relative(boundary, directory) || dirname(directory) === directory) return
    directory = dirname(directory)
  }
}
/** Metadata is keyed by the complete main manifest dependency graph and selected Node
 * platform. Missing/corrupt cache means unavailable evidence, never damaged installation. */
const metadataKey = (main: NpmManifest, host: NpmHost) => createHash('sha256').update(JSON.stringify([main.name, main.version, Object.entries(main.optionalDependencies ?? {}).sort(), host.platform, host.arch, host.libc])).digest('hex')
const metadataSchema = z.object({ components: z.array(z.object({ alias: z.string().regex(packageName), manifest: manifestSchema })).max(128) })
export async function rememberNpmPlatforms(root: string, main: NpmManifest, host: NpmHost, components: NpmComponent[]): Promise<void> {
  const directory = join(root, 'cli-management', 'npm-platforms')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid npm metadata directory')
  await chmod(directory, 0o700)
  atomicJSON(join(directory, `${metadataKey(main, host)}.json`), metadataSchema.parse({ components }))
}
async function rememberedPlatforms(root: string | undefined, main: NpmManifest, host: NpmHost) {
  if (!root) return undefined
  const data = metadataSchema.safeParse(await readManifest(join(root, 'cli-management', 'npm-platforms', `${metadataKey(main, host)}.json`)))
  return data.success ? data.data.components : undefined
}
/** CLI requirements differ from npm optionality. These are installation keys, not
 * registry guesses: all candidates must also occur in the installed main manifest.
 * Older bundled Codex releases without platform dependencies remain probe-only. */
export function npmRequiredGroups(main: NpmManifest, host: NpmHost, known: NpmComponent[] = []): string[][] {
  const aliases = Object.keys(main.optionalDependencies ?? {})
  const matching = known.filter(c => npmPlatformMatches(c.manifest, host)).map(c => c.alias)
  if (main.name === '@openai/codex') {
    if (!aliases.some(a => a.startsWith('@openai/codex-'))) return []
    return [[`@openai/codex-${host.platform}-${host.arch}`]]
  }
  if (main.name === 'opencode-ai') {
    const base = `opencode-${host.platform === 'win32' ? 'windows' : host.platform}-${host.arch}`
    const suffix = host.platform === 'linux' && host.libc === 'musl' ? '-musl' : ''
    const candidates = [base + suffix, base + '-baseline' + suffix]
    return [candidates.filter(a => aliases.includes(a))].filter(g => g.length)
  }
  // CodeBuddy explicitly falls back to child_process without node-pty.
  const required = matching.filter(a => main.name !== '@tencent-ai/codebuddy-code' || !a.startsWith('@lydell/node-pty-'))
  if (main.name === '@tencent-ai/codebuddy-code') {
    const sandbox = `@tencent-ai/sandbox-cli-${host.platform}-${host.arch}`
    if (aliases.includes(sandbox) && !required.includes(sandbox)) required.push(sandbox)
  }
  return required.map(a => [a])
}
export async function verifyNpmPlatforms(identity: InstallationIdentity, _releases: ReleaseClient, _registry: string, signal: AbortSignal, host: NpmHost, expected?: NpmComponent[], root?: string): Promise<void> {
  if (identity.source !== 'npm') return
  const raw = identity.packageRoot && await readManifest(join(identity.packageRoot, 'package.json'))
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) throw new NpmInstallationError('npm 安装需要修复：无法读取已安装主包清单')
  const main = parsed.data, dependencies = Object.entries(main.optionalDependencies ?? {})
  if (dependencies.length > 128) throw new NpmInstallationError('npm 平台组件清单超过核验上限')
  const known = expected ?? await rememberedPlatforms(root, main, host)
  const installed = new Map<string, NpmManifest>()
  for (const [alias] of dependencies) {
    signal.throwIfAborted()
    npmDependency(alias, main.optionalDependencies![alias]!)
    const manifest = await installedDependency(identity.packageRoot!, alias, identity.prefix ?? identity.packageRoot!)
    if (manifest) installed.set(alias, manifest)
  }
  // With no persisted metadata, installed manifests plus known CLI requirements
  // suffice. Never contact a registry to classify a missing optional package.
  const evidence = known ?? [...installed].map(([alias, manifest]) => ({ alias, manifest })).filter(c => platformRestricted(c.manifest))
  for (const group of npmRequiredGroups(main, host, evidence)) {
    const declared = group.filter(a => main.optionalDependencies?.[a])
    if (!declared.length) throw new NpmInstallationError(`npm 安装需要修复：平台组件 ${group.join(' / ')} 的声明缺失`)
    if (declared.some(alias => {
      const dep = npmDependency(alias, main.optionalDependencies![alias]!), item = installed.get(alias), target = known?.find(c => c.alias === alias)?.manifest
      return item && item.name === dep.name && satisfies(item.version, dep.range) && npmPlatformMatches(item, host) && (!target || item.version === target.version)
    })) continue
    throw new NpmInstallationError(`npm 安装需要修复：平台组件 ${group.join(' / ')} 未安装或版本不符；npm 可能下载超时或失败，请重新安装`)
  }
}
