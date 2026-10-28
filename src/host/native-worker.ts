import { mkdtempSync, writeFileSync, rmSync, existsSync, lstatSync, chmodSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CliId, Preference, TaskMode, Worker } from '../shared/types.ts'
import type { RuntimeConfig } from './process.ts'
import { windowsCodexBackgroundLaunch } from './windows-codex-launch.ts'
import { nativeLaunchArgv } from './native-launch.mjs'
import { createNativeStopControl, createNativeGuidanceControl } from './pi-omp-control.mjs'
import { buildNativeHarnessInjection } from './native-harness-injection.mjs'
import { prepareAgyHarnessWorkspace } from './native-agy-harness.mjs'
import type { NativeHarnessConnection } from './native-harness-tools.ts'
import type { NativeAttachment } from './native-attachments.mjs'

export const NATIVE_TRANSPORTS = {
  antigravity: 'agy-stream-v1',
  codex: 'codex-app-v1',
  claude: 'claude-stream-v1',
  kimi: 'kimi-acp-v1',
  mimo: 'mimo-http-v1',
  zcode: 'zcode-app-v1',
  grok: 'grok-acp-v1',
  omp: 'omp-rpc-v1',
  pi: 'pi-rpc-v1',
  hermes: 'hermes-http-v1',
  opencode: 'opencode-http-v1',
  qoder: 'qoder-acp-v1',
  qodercn: 'qodercn-acp-v1',
} as const
export function transportFor(cli: CliId): string {
  if (cli === 'harness') throw new Error('Harness CLI 已移除')
  return NATIVE_TRANSPORTS[cli]
}
export function usesNativeBridge(worker: Pick<Worker, 'transport' | 'preference'>): boolean {
  const cli = worker.preference.cli ?? 'antigravity'
  if (!worker.transport || worker.transport === 'legacy') return false
  if (worker.transport !== transportFor(cli)) throw new Error('此任务使用未知通信协议，请核对插件版本')
  return cli !== 'pi' && cli !== 'omp'
}
function bridgePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const path of [join(here, 'native-bridge.mjs'), resolve(here, '../../native-bridge.mjs')])
    if (existsSync(path)) return path
  throw new Error('原生通信桥未安装，请重新构建插件')
}
export async function prepareNativeWorker<
  T extends { argv: string[]; env?: Record<string, string>; cleanup?: () => Promise<void> },
>(
  launch: T,
  input: {
    cli: CliId
    project: string
    preference: Preference
    mode: TaskMode
    prompt: string
    attachments?: readonly NativeAttachment[]
    forkSource?: { conversationId: string; messageId: string }
    conversationId?: string
    stateDirectory: string
    /** Non-secret model IDs from the exact admitted Claude route. */
    claudeModelCandidates?: Array<{ value: string; resolvedModel: string }>
    harnessTools?: NativeHarnessConnection
  },
  config: RuntimeConfig,
) {
  const root = input.stateDirectory
  if (lstatSync(root).isSymbolicLink()) throw new Error('原生通信目录不是私有目录')
  const directory = mkdtempSync(join(root, 'native-request-'))
  chmodSync(directory, 0o700)
  const request = join(directory, 'request.json')
  let control: Awaited<ReturnType<typeof createNativeStopControl>> | undefined
  let guidance: Awaited<ReturnType<typeof createNativeGuidanceControl>> | undefined
  try {
    control = await createNativeStopControl(join(directory, 'stop'))
    if (['codex', 'hermes'].includes(input.cli)) guidance = await createNativeGuidanceControl(join(directory, 'control'))
    const activeControl = control
    const native =
      process.platform === 'win32' && input.cli === 'codex'
        ? // Only this launch's explicit variables: the Host backend applies its
          // parent-environment scrubbing, which a copy of process.env would bypass.
          windowsCodexBackgroundLaunch(nativeLaunchArgv(launch.argv), launch.env)
        : undefined
    const baseEnv = native ? native.env : launch.env
    // Secrets stay in the child environment, never argv or the request payload.
    const { harnessTools, ...publicInput } = input
    const injected = buildNativeHarnessInjection({ cli: input.cli, argv: launch.argv,
      env: baseEnv ? Object.fromEntries(Object.entries(baseEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined,
      connection: harnessTools, toolTimeoutMs: config.timeLimit?.totalMs ?? config.timeoutMs })
    let nativeArgv = injected.argv
    if (input.cli === 'antigravity' && harnessTools) {
      const prepared = prepareAgyHarnessWorkspace({ directory, argv: nativeArgv, connection: harnessTools })
      nativeArgv = prepared.argv
      Object.assign(injected.env, prepared.env)
    }
    if (input.cli === 'codex' && harnessTools) {
      // The verified exec parser requires the prompt to remain last.
      const promptIndex = nativeArgv.indexOf(`任务：\n${input.prompt}`)
      if (promptIndex >= 0) nativeArgv = [...nativeArgv.slice(0, promptIndex), ...nativeArgv.slice(promptIndex + 1), nativeArgv[promptIndex]]
    }
    writeFileSync(
      request,
      JSON.stringify({
        ...publicInput,
        argv: nativeArgv,
        stopDirectory: join(directory, 'stop'),
        stopNonce: activeControl.nonce,
        ...(guidance ? { controlDirectory: join(directory, 'control'), controlNonce: guidance.nonce } : {}),
        ...(native ? { nativeExecutable: native.argv[0] } : {}),
        timeoutMs: config.timeLimit?.totalMs ?? config.timeoutMs,
        ...(config.timeLimit ? { deadlineAt: config.timeLimit.deadlineAt, idleTimeoutMs: config.timeLimit.idleMs } : {}),
        maxLineBytes: config.maxLineBytes,
        maxRunBytes: config.maxRunBytes,
        maxNativeLineBytes: config.maxNativeLineBytes,
        maxToolPreviewBytes: config.maxToolPreviewBytes,
      }),
      { mode: 0o600, flag: 'wx' },
    )
    return {
      ...launch,
      argv: [process.execPath, bridgePath(), request],
      env: { ...injected.env, ELECTRON_RUN_AS_NODE: '1' },
      stop: activeControl.stop,
      ...(guidance ? { steer: guidance.steer } : {}),
      cleanup: async () => {
        try {
          await guidance?.close()
          await activeControl.close()
          await launch.cleanup?.()
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    try {
      await guidance?.close()
      await control?.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    throw error
  }
}
