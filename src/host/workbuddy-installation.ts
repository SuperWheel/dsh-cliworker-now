import { readFile, stat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { workbuddyVariant, type WorkBuddyCliId } from './workbuddy-variant.ts'

export class WorkBuddyUnavailableError extends Error {
  readonly code = 'WORKBUDDY_UNAVAILABLE'
  constructor(readonly reason: string) {
    super(`WorkBuddy 暂不可用：${reason}`)
    this.name = 'WorkBuddyUnavailableError'
  }
}

export interface WorkBuddyInstallation {
  cli: WorkBuddyCliId
  appRoot: string
  runtime: string
  entry: string
  cliVersion: string
  productName: string
  endpoint: string
  configDir: string
  dataFolderName: string
}
export interface WorkBuddyInstallationOptions {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  /** App directory, its runtime, or its built-in entry. Explicit paths never fall back. */
  path?: string
  manualPath?: string
  candidates?: readonly string[]
}

export async function resolveWorkBuddyInstallation(cli: WorkBuddyCliId, options: WorkBuddyInstallationOptions = {}): Promise<WorkBuddyInstallation> {
  const variant = workbuddyVariant(cli), platform = options.platform ?? process.platform
  const home = options.home ?? homedir(), env = options.env ?? process.env
  if (platform !== 'darwin' && platform !== 'win32') throw new WorkBuddyUnavailableError('platform-unsupported')
  const manual = options.manualPath ?? options.path
  const candidates = manual ? [manual] : options.candidates ?? (platform === 'darwin'
    ? ['/Applications', join(home, 'Applications')].flatMap(root => variant.macAppNames.map(name => join(root, name)))
    : [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter((root): root is string => !!root).flatMap(root => variant.windowsDirectoryNames.map(name => join(root, name))))
  let reason = 'not-installed'
  for (const candidate of candidates) {
    try {
      let appRoot = resolve(candidate), runtime: string | undefined
      if (basename(appRoot) === 'codebuddy-lite-wb.mjs')
        appRoot = platform === 'darwin' ? resolve(appRoot, '../../../../../..') : resolve(appRoot, '../../../../..')
      else if (platform === 'darwin' && basename(appRoot) === 'Electron') appRoot = resolve(appRoot, '../../..')
      else if (platform === 'win32' && /\.exe$/i.test(appRoot)) { runtime = appRoot; appRoot = dirname(appRoot) }
      const cliRoot = join(appRoot, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']), 'app.asar.unpacked', 'cli')
      const entry = join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs')
      if (!(await stat(appRoot)).isDirectory()) throw new WorkBuddyUnavailableError('installation-invalid')
      const readJson = async (name: string) => {
        const file = join(cliRoot, name), info = await stat(file)
        if (!info.isFile() || info.size > 1024 * 1024) throw new WorkBuddyUnavailableError('metadata-invalid')
        return JSON.parse(await readFile(file, 'utf8'))
      }
      const [pkg, product] = await Promise.all([readJson('package.json'), readJson('product.json')])
      if (pkg?.name !== '@genie/agent-cli') throw new WorkBuddyUnavailableError('package-mismatch')
      let endpoint: URL
      try { endpoint = new URL(product.endpoint) } catch { throw new WorkBuddyUnavailableError('endpoint-invalid') }
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !variant.endpointHosts.includes(endpoint.hostname))
        throw new WorkBuddyUnavailableError('variant-mismatch')
      if (typeof product.dataFolderName !== 'string' || !/^\.[A-Za-z0-9._-]+$/.test(product.dataFolderName) || product.dataFolderName === '..')
        throw new WorkBuddyUnavailableError('data-folder-invalid')
      if (!runtime) {
        if (platform === 'darwin') runtime = join(appRoot, 'Contents', 'MacOS', 'Electron')
        else {
          const names = (await readdir(appRoot)).filter(name => /\.exe$/i.test(name) && !/unins|uninstall|crash|update/i.test(name))
          const preferred = ['WorkBuddy.exe', 'WorkBuddy AI.exe'].find(name => names.includes(name))
          if (!preferred && names.length !== 1) throw new WorkBuddyUnavailableError('runtime-ambiguous')
          runtime = join(appRoot, preferred ?? names[0]!)
        }
      }
      if (!(await stat(runtime)).isFile() || !(await stat(entry)).isFile()) throw new WorkBuddyUnavailableError('entry-missing')
      if (typeof pkg.version !== 'string' || !pkg.version || typeof product.productName !== 'string' || !product.productName)
        throw new WorkBuddyUnavailableError('metadata-invalid')
      return { cli, appRoot, runtime, entry, cliVersion: pkg.version, productName: product.productName,
        endpoint: product.endpoint, configDir: join(home, product.dataFolderName), dataFolderName: product.dataFolderName }
    } catch (error) {
      reason = error instanceof WorkBuddyUnavailableError ? error.reason
        : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-installed' : 'installation-invalid'
    }
  }
  throw new WorkBuddyUnavailableError(reason)
}
