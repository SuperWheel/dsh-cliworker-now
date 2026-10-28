import { fileURLToPath } from 'node:url'
import {
  mkdirSync,
  lstatSync,
  chmodSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  openSync,
  closeSync,
  fstatSync,
  fchmodSync,
  constants,
  type Stats,
} from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import type { CliId, Preference, TaskMode, ModelChoice } from '../shared/types.ts'
import type { RuntimeConfig } from './process.ts'
import { prepareZCode, discoverZCode, zcodeAuthDirectory } from './zcode-adapter.ts'
import { preparePiOmp, discoverPiOmp, type PiOmpMetadataCapture } from './pi-omp-adapter.ts'
import { prepareOpenCode, discoverOpenCode, openCodeAuthDirectory } from './opencode-adapter.ts'
import { prepareHermes, discoverHermes } from './hermes-adapter.ts'
import { effectiveHermesHome } from './hermes-account-context.ts'
import { prepareGrok, discoverGrok } from './grok-adapter.ts'
import type { HermesRenewalContext } from './hermes-renewal.ts'
import { prepareNativeWorker } from './native-worker.ts'
import { cleanupHermesHttpHome } from './native-hermes-home.mjs'

export const EXTENDED_CLIS = ['zcode', 'grok', 'omp', 'pi', 'hermes', 'opencode'] as const
export const isExtendedCli = (cli: string): cli is (typeof EXTENDED_CLIS)[number] =>
  (EXTENDED_CLIS as readonly string[]).includes(cli)
// ZCode app-server appends `znr-${uuid}.sock` to TMPDIR. macOS's default
// /var/folders directory plus our private child can exceed sockaddr_un.
const nativeTemporaryRoot = () => process.platform === 'darwin' ? '/tmp' : tmpdir()
const privateArgv = (argv: string[]) => [
  process.execPath,
  fileURLToPath(new URL('./private-launch.mjs', import.meta.url)),
  ...argv,
]
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (lstatSync(path).isSymbolicLink()) throw new Error('CLI state directory cannot be a symlink')
  chmodSync(path, 0o700)
  return realpathSync(path)
}
/**
 * Run only after the native process range has exited. Copies can preserve public
 * modes despite umask. Pin each inode before changing it, skip symlinks, and fail
 * closed on hard links rather than chmod a possibly external file.
 */
export function sealPrivateTree(root: string): void {
  const sameInode = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino
  const ancestors: { path: string; info: Stats }[] = []
  const assertLocations = () => {
    for (const { path, info } of ancestors) {
      const current = lstatSync(path)
      if (current.isSymbolicLink() || !sameInode(current, info))
        throw new Error('CLI private state changed during permission cleanup')
    }
  }
  const visit = (path: string) => {
    assertLocations()
    const info = lstatSync(path)
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return
    if (info.isDirectory() && process.platform === 'win32') {
      // Windows does not support opening directories with POSIX O_DIRECTORY.
      // Keep the same location/inode checks without widening to linked targets.
      const canonical = realpathSync(path)
      ancestors.push({ path, info })
      try {
        assertLocations()
        if (realpathSync(path) !== canonical)
          throw new Error('CLI private state changed during permission cleanup')
        chmodSync(path, 0o700)
        for (const entry of readdirSync(path)) visit(join(path, entry))
        assertLocations()
        if (realpathSync(path) !== canonical)
          throw new Error('CLI private state changed during permission cleanup')
      } finally {
        ancestors.pop()
      }
      return
    }
    const fd = openSync(
      path,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (info.isDirectory() ? constants.O_DIRECTORY : 0),
    )
    try {
      const opened = fstatSync(fd)
      if (!sameInode(info, opened) || info.isDirectory() !== opened.isDirectory())
        throw new Error('CLI private state inode changed during permission cleanup')
      ancestors.push({ path, info: opened })
      try {
        assertLocations()
        if (opened.isFile() && fstatSync(fd).nlink !== 1)
          throw new Error('CLI private state contains a hard-linked file; permissions were not changed')
        fchmodSync(fd, opened.isDirectory() ? 0o700 : 0o600)
        if (opened.isDirectory()) for (const entry of readdirSync(path)) visit(join(path, entry))
      } finally {
        ancestors.pop()
      }
    } finally {
      closeSync(fd)
    }
  }
  visit(root)
}
/** Compatibility only: Host credential references never supply CLI accounts. */
export async function credentialEnvironment(
  _cli: CliId,
  _config: RuntimeConfig,
  _selectedModel?: string,
): Promise<Record<string, string>> {
  return {}
}
export async function extendedLaunch(
  cli: CliId,
  executable: string,
  project: string,
  preference: Preference,
  mode: TaskMode,
  prompt: string,
  stateDirectory: string,
  config: RuntimeConfig,
  conversationId?: string,
  metadataCapture?: PiOmpMetadataCapture,
  renewal?: HermesRenewalContext,
  nativeTransport = false,
) {
  const state = privateDirectory(stateDirectory)
  const input = {
    executable,
    project,
    preference,
    mode,
    prompt,
    ...(config.attachments?.length ? { attachments: config.attachments } : {}),
    conversationId,
    stateDirectory: state,
    nativeTransport,
  }
  const metadata: PiOmpMetadataCapture | undefined =
    metadataCapture &&
    ((argv, env, phase, scope) =>
      metadataCapture(privateArgv(argv), { ...env, ELECTRON_RUN_AS_NODE: '1' }, phase, scope))
  const prepared =
    cli === 'zcode'
      ? await prepareZCode({
          ...input,
          authDirectory: zcodeAuthDirectory(config.zcodeAuthDirectory, config.stateDirectory),
          builtinConfig: config.zcodeBuiltinConfig,
        })
      : cli === 'pi' || cli === 'omp'
        ? await preparePiOmp(
            {
              ...input,
              cli,
              ...(config.harnessTools ? { harnessTools: config.harnessTools } : {}),
              accountRoot:
                config.stateDirectory ??
                join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
            },
            metadata,
          )
        : cli === 'opencode'
          ? await prepareOpenCode({
              ...input,
              authDirectory: openCodeAuthDirectory(config.stateDirectory),
            })
          : cli === 'hermes'
            ? await prepareHermes({ ...input, hermesHome: effectiveHermesHome(config), renewal })
            : cli === 'grok'
              ? await prepareGrok({ ...input, ...(config.harnessTools ? { harnessTools: config.harnessTools } : {}) })
              : undefined
  if (!prepared) throw new Error('未知 CLI')
  let launch = prepared
  let temporary: string | undefined
  const cleanupLaunch = async () => {
    try {
      if ('cleanup' in launch && launch.cleanup) await launch.cleanup()
    } finally {
      // The Host runs this only after its full process range has exited. The
      // runner's finally may have been skipped by forced termination.
      if (nativeTransport && cli === 'hermes') await cleanupHermesHttpHome(state)
    }
  }
  try {
    if (nativeTransport && cli !== 'pi' && cli !== 'omp')
      launch = await prepareNativeWorker(
        prepared,
        { cli, project, preference, mode, prompt, conversationId, stateDirectory: state,
          ...(config.access ? { access: config.access } : {}),
          ...(config.attachments?.length ? { attachments: config.attachments } : {}),
          ...(config.harnessTools ? { harnessTools: config.harnessTools } : {}) },
        config,
      )
    temporary = cli === 'zcode' ? mkdtempSync(join(nativeTemporaryRoot(), 'cwn-')) : undefined
    if (temporary) chmodSync(temporary, 0o700)
    const env = {
      ...launch.env,
      ...(temporary ? { TMPDIR: temporary, TMP: temporary, TEMP: temporary } : {}),
      ELECTRON_RUN_AS_NODE: '1',
    }
    const argv = privateArgv(launch.argv)
    return {
      argv,
      env,
      ...('activate' in launch && launch.activate ? { activate: launch.activate } : {}),
      ...('steer' in launch && launch.steer ? { steer: launch.steer } : {}),
      ...('stop' in launch && launch.stop ? { stop: launch.stop } : {}),
      ...('answerApproval' in launch && launch.answerApproval ? { answerApproval: launch.answerApproval } : {}),
      cleanup: async () => {
        try {
          await cleanupLaunch()
          sealPrivateTree(state)
        } finally {
          if (temporary) rmSync(temporary, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    try {
      await cleanupLaunch()
    } finally {
      if (temporary) rmSync(temporary, { recursive: true, force: true })
    }
    throw error
  }
}
export async function extendedCatalog(
  cli: CliId,
  executable: string,
  capture: (argv: string[], env?: Record<string, string>) => Promise<string>,
  stateDirectory: string,
  config: RuntimeConfig,
  signal?: AbortSignal,
  renewal?: HermesRenewalContext,
): Promise<ModelChoice[]> {
  signal?.throwIfAborted()
  const catalogRoot = privateDirectory(join(stateDirectory, 'catalog', cli))
  const state = privateDirectory(mkdtempSync(join(catalogRoot, 'query-')))
  const run = async (argv: string[], env?: Record<string, string>) => {
    const temporary = cli === 'zcode' ? mkdtempSync(join(nativeTemporaryRoot(), 'cwn-')) : undefined
    if (temporary) chmodSync(temporary, 0o700)
    try {
      return await capture(privateArgv(argv), {
        ...env,
        ...(temporary ? { TMPDIR: temporary, TMP: temporary, TEMP: temporary } : {}),
        ELECTRON_RUN_AS_NODE: '1',
      })
    } finally {
      if (temporary) rmSync(temporary, { recursive: true, force: true })
    }
  }
  const models =
    cli === 'zcode'
      ? await discoverZCode(
          executable,
          run,
          state,
          zcodeAuthDirectory(config.zcodeAuthDirectory, config.stateDirectory ?? stateDirectory),
          config.zcodeBuiltinConfig,
          { signal },
        )
      : cli === 'pi' || cli === 'omp'
        ? await discoverPiOmp(cli, executable, run, state, {
            accountRoot: config.stateDirectory ?? stateDirectory,
            signal,
          })
        : cli === 'opencode'
          ? await discoverOpenCode(
              executable,
              run,
              state,
              openCodeAuthDirectory(config.stateDirectory ?? stateDirectory),
              false,
              { signal },
            )
          : cli === 'hermes'
            ? await discoverHermes(
                executable,
                run,
                state,
                effectiveHermesHome({ ...config, stateDirectory: config.stateDirectory ?? stateDirectory }),
                { signal, renewal },
              )
            : cli === 'grok'
              ? await discoverGrok(executable, run, state, { signal })
              : undefined
  if (!models) throw new Error('未知 CLI')
  signal?.throwIfAborted()
  // A successful capture has confirmed that its process range exited. Only
  // model values leave this operation; its private snapshots and native caches
  // are no longer needed. Rejected captures keep their potentially live files.
  sealPrivateTree(state)
  rmSync(state, { recursive: true, force: true })
  return models
}
