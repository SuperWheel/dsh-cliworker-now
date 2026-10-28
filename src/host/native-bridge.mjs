import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createNativeIO } from './native-transport.mjs'
import { receiveNativeStopControl, receiveNativeGuidanceControl } from './pi-omp-control.mjs'
import { readTimeLimit, startRunTimers, TIME_LIMIT_ERRORS } from './native-time-limit.mjs'

process.umask(0o077)
const modules = {
  codex: ['native-codex', 'runNativeCodex'],
  claude: ['native-claude', 'runNativeClaude'],
  antigravity: ['native-agy', 'runNativeAgy'],
  kimi: ['native-kimi', 'runNativeKimi'],
  qoder: ['native-qoder', 'runNativeQoder'],
  qodercn: ['native-qoder', 'runNativeQoder'],
  grok: ['native-grok', 'runNativeGrok'],
  zcode: ['native-zcode', 'runNativeZcode'],
  opencode: ['native-opencode', 'runNativeOpenCode'],
  mimo: ['native-mimo', 'runNativeMimo'],
  hermes: ['native-hermes', 'runNativeHermes'],
}
const controller = new AbortController()
let io, emergency, timers, error, control, guidance
const stop = () => {
  if (controller.signal.aborted) return
  controller.abort(new Error('任务已停止'))
  emergency = setTimeout(() => {
    void io?.stopChildren().catch(() => {
      process.exitCode = 1
    })
  }, 1500)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
try {
  const path = resolve(process.argv[2] ?? '')
  const before = await lstat(path),
    parent = await lstat(dirname(path))
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > 2_097_152 ||
    parent.isSymbolicLink()
  )
    throw new Error('Unsafe native bridge request')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let config, limit
  try {
    const opened = await handle.stat()
    if (opened.ino !== before.ino || opened.dev !== before.dev)
      throw new Error('Native request changed while opening')
    config = JSON.parse(await handle.readFile('utf8'))
    const after = await lstat(path)
    if (
      after.ino !== opened.ino ||
      after.dev !== opened.dev ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    )
      throw new Error('Native request changed while reading')
  } finally {
    await handle.close()
  }
  if (
    !config ||
    !modules[config.cli] ||
    !Array.isArray(config.argv) ||
    !config.argv.length ||
    config.argv.some((value) => typeof value !== 'string' || value.includes('\0')) ||
    typeof config.project !== 'string' ||
    typeof config.prompt !== 'string' ||
    !config.prompt.trim() ||
    !config.preference ||
    typeof config.preference.model !== 'string' ||
    typeof config.preference.effort !== 'string' ||
    !['plan', 'accept-edits'].includes(config.mode) ||
    !Number.isSafeInteger(config.maxLineBytes) ||
    config.maxLineBytes < 1024 ||
    config.maxLineBytes > 16_777_216 ||
    !Number.isSafeInteger(config.maxRunBytes) ||
    config.maxRunBytes < config.maxLineBytes ||
    (config.maxNativeLineBytes !== undefined &&
      (!Number.isSafeInteger(config.maxNativeLineBytes) || config.maxNativeLineBytes < 1024 || config.maxNativeLineBytes > 67_108_864)) ||
    (config.maxToolPreviewBytes !== undefined &&
      (!Number.isSafeInteger(config.maxToolPreviewBytes) || config.maxToolPreviewBytes < 1024)) ||
    !(limit = readTimeLimit(config))
  )
    throw new Error('Invalid native bridge configuration')
  // Runner waits count down the time left to the Host's deadline, not a fresh total.
  config.deadlineAt = limit.deadlineAt
  config.timeoutMs = Math.max(1, limit.deadlineAt - Date.now())
  io = createNativeIO(
    config.forkOperation ? { ...config, conversationId: undefined } : config,
    (line) => {
      timers?.touch()
      process.stdout.write(line)
    },
    controller.signal,
    (chunk) => process.stderr.write(chunk),
    // Heartbeats such as Claude keep_alive are dropped by runners but still prove the CLI is alive.
    () => timers?.touch(),
  )
  control = await receiveNativeStopControl(config.stopDirectory, config.stopNonce, async () => {
    stop()
    await io.flush()
  })
  if (config.controlNonce) {
    if (!['codex', 'hermes'].includes(config.cli) || config.controlDirectory !== resolve(dirname(path), 'control'))
      throw new Error('Unsupported or unbound native guidance control')
    guidance = await receiveNativeGuidanceControl(config.controlDirectory, config.controlNonce,
      (message, id, attempt) => io.steer(message, id, attempt))
  }
  timers = startRunTimers(limit, (kind) => {
    if (controller.signal.aborted) return
    error = new Error(TIME_LIMIT_ERRORS[kind])
    stop()
  })
  const [module, entry] = modules[config.cli]
  const runner = (await import(`./${module}.mjs`))[config.forkOperation ? entry.replace('runNative', 'forkNative') : entry]
  await runner(config, io)
  if (controller.signal.aborted) error ??= new Error('任务已停止')
} catch (caught) {
  error = controller.signal.aborted ? (error ?? new Error('任务已停止')) : caught
} finally {
  timers?.close()
  clearTimeout(emergency)
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
  try {
    await guidance?.close()
    await control?.close()
    if (io) await io.close(error)
    else
      process.stdout.write(
        JSON.stringify({ type: 'result', status: 'ERROR', response: '', error: '原生协议桥无法初始化' }) +
          '\n',
      )
  } catch {
    process.stderr.write('原生协议桥未确认清理完成\n')
    process.exitCode = 1
  }
}
