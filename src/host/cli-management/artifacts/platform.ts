import { execFile } from 'node:child_process'
import { release } from 'node:os'
import { readFile } from 'node:fs/promises'
export function isMusl(platform: NodeJS.Platform = process.platform) {
  return platform === 'linux' && !(process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime
}
/** Match official macOS selectors under Rosetta without executing any managed CLI. */
export async function nativeMacArch(platform: NodeJS.Platform, arch: string, readTranslated?: () => Promise<string>): Promise<string> {
  if (platform !== 'darwin' || arch !== 'x64') return arch
  if (!readTranslated && (process.platform !== platform || process.arch !== arch)) return arch
  const read = readTranslated ?? (() => new Promise<string>((resolve, reject) => execFile('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { timeout: 2000, maxBuffer: 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))))
  return (await read().catch(() => '')).trim() === '1' ? 'arm64' : arch
}
export interface QoderPlatform { platform: NodeJS.Platform; arch: string; musl?: boolean; windowsBuild?: number; cpuFlags?: string[] }
export async function qoderPlatform(platform: NodeJS.Platform, arch: string): Promise<QoderPlatform> {
  const flags = platform === 'linux' ? (await readFile('/proc/cpuinfo', 'utf8').catch(() => '')).match(/^flags\s*:\s*(.*)$/m)?.[1]?.split(/\s+/) ?? [] : []
  return { platform, arch: await nativeMacArch(platform, arch), musl: isMusl(platform), windowsBuild: Number(release().split('.')[2]), cpuFlags: flags }
}
/** Share the official selector between the update-page release check and takeover. */
export function selectQoderFile(files: unknown, host: QoderPlatform): Record<string, unknown> | undefined {
  if (!Array.isArray(files) || host.musl || host.platform === 'win32' && host.arch !== 'x64') return
  const os = host.platform === 'win32' ? 'windows' : host.platform
  let arch = host.arch === 'x64' ? 'amd64' : host.arch
  if (os === 'linux' && arch === 'amd64' && !['sse4_2', 'popcnt', 'avx', 'avx2', 'bmi1', 'bmi2', 'fma'].every(f => host.cpuFlags?.includes(f))) arch += '-baseline'
  const matching = files.filter(f => f && f.os === os && f.arch === arch && (os !== 'windows' || Number.isInteger(host.windowsBuild) && (host.windowsBuild! < 17763 ? f.variant === 'legacy' : f.variant !== 'legacy' && (f.min_windows_build === undefined || Number.isInteger(f.min_windows_build) && f.min_windows_build <= host.windowsBuild!))))
  return matching.length === 1 ? matching[0] : undefined
}
