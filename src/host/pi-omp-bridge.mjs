// Subprocess protocol bridge. The Host owns the external sandbox, credentials,
// deadlines, directory/session locks, and descendant cleanup. No shell is used.
import { NativeBlockResponses, piOmpResponseUsage, piOmpReportedUsage } from './http-rpc-response.mjs'
import { OmpContextInspection } from './omp-context-inspection.mjs'
import { PI_CONTEXT_ENV, preparePiContextObserver, readPiContextObservation } from './pi-context-observer.mjs'
import { PI_GATE_ENV, preparePiPermissionGate, readPiGateConfirm } from './pi-permission-gate.mjs'
import { createEventBudget, summarizeNativeRecord } from './native-transport.mjs'
import { spawnNativeProcess } from './native-spawn.mjs'
import { createToolOutcomes, LAST_TOOL_FAILED, recoveredNotice } from './native-tool-outcomes.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename, realpath, unlink, rmdir, lstat, open, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { ompConfigurationEnvironment, ompPermissionSettings, probeOmpApprovalModes, OMP_APPROVAL_UNAVAILABLE } from './pi-omp-environment.mjs'
import { readFile } from 'node:fs/promises'
import { nativeLaunchArgv } from './native-launch.mjs'
import { ownsOwnAccountLease, OWN_ACCOUNT_BUSY } from './own-account-lease.mjs'
import { assertPiOmpRefreshSources, assertPiOmpRefreshCache } from './pi-omp-refresh.mjs'
import { receivePiOmpControl, receiveNativeStopControl, receiveNativeApprovalControl } from './pi-omp-control.mjs'
import { HARNESS_CONNECTION_ENV, readNativeHarnessConnection } from './native-harness-mcp.mjs'
import { prepareNativeHarnessExtension } from './native-harness-extension.mjs'
import { nativeFirstGuidance, piOmpNativeTools } from './cli-native-capabilities.mjs'
import {
  queryNativeCandidates,
  snapshotNativeCandidates,
  accountSupportedChoices,
} from './pi-native-catalog.mjs'

process.umask(0o077)
const output = (value) => process.stdout.write(JSON.stringify(value.type === 'native' ? { ...value, record: summarizeNativeRecord(value.record) } : value) + '\n')
let eventBudget
const event = (value) => {
  const shown = eventBudget ? eventBudget(value) : value
  if (shown) output({ type: 'event', event: shown })
}
const safeErrors = new Set([
  '任务已停止',
  '所选模型或强度不在原生可用目录中',
  '无法读取 Pi/OMP 原生模型目录，请检查本机配置',
  OWN_ACCOUNT_BUSY,
  '账号配置已变化，请重新刷新模型',
  OMP_APPROVAL_UNAVAILABLE,
])
const errorMessage = (error) =>
  error instanceof Error && safeErrors.has(error.message)
    ? error.message
    : 'Pi/OMP 原生配置、模型或协议校验失败'
const inside = (root, path) => path.startsWith(root + sep)
let selectedProvider, selectedModel
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe Pi/OMP state directory symlink')
  if (process.platform === 'win32') {
    // Windows cannot open directory descriptors with Node's POSIX O_DIRECTORY.
    const canonical = await realpath(path),
      current = await lstat(path)
    if (current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino)
      throw new Error('Pi/OMP state directory changed while opening')
    return canonical
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (info.dev !== opened.dev || info.ino !== opened.ino)
      throw new Error('Pi/OMP state directory changed while opening')
    await handle.chmod(0o700)
  } finally {
    await handle.close()
  }
  return realpath(path)
}
async function privateFile(path, read = false, limit = 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe Pi/OMP state file or hard link')
    if (read) {
      if (info.size > limit) throw new Error('Pi/OMP state JSON exceeds limit')
      const contents = await handle.readFile('utf8')
      const after = await handle.stat()
      if (Buffer.byteLength(contents) > limit || info.size !== after.size || info.mtimeMs !== after.mtimeMs)
        throw new Error('Pi/OMP state JSON changed while reading')
      return contents
    }
  } finally {
    await handle.close()
  }
}
async function writePrivateFile(path, contents) {
  await privateDirectory(dirname(path))
  const temporary = join(dirname(path), `.cliworker-${randomBytes(16).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    // Replaces a planted file link itself; never truncates its external inode.
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
let child,
  stopped = false,
  failure,
  closeTimer,
  forceTimer,
  startupTimer,
  config,
  session,
  finalized = false,
  controlReceiver,
  stopReceiver,
  approvalReceiver,
  approvalSequence = 0,
  permissionDenied = false,
  /** Pi's tool_call gate for this run: prepared, `false` when the install cannot ask, or unused. */
  permissionGate,
  nativeStop,
  closeGuidance = () => {}
const toolOutcomes = createToolOutcomes()
// Pending OMP and Pi gate approvals relayed to the Host, by bridge id; each settles exactly once.
const approvals = new Map()
/**
 * OMP 16.4.4 asks for write/edit/bash approval as an RPC `select` titled "Allow tool: <name>"
 * with exactly Approve/Deny. Anything else stays an unanswerable interactive request.
 */
function ompApprovalRequest(value) {
  if (config?.cli !== 'omp' || value.method !== 'select' || typeof value.title !== 'string') return
  const options = Array.isArray(value.options) ? value.options : []
  if (options.length !== 2 || !options.includes('Approve') || !options.includes('Deny')) return
  const [first, ...rest] = value.title.split('\n')
  const tool = /^Allow tool: (.+)$/.exec(first)?.[1]?.trim()
  if (!tool) return
  return {
    kind: tool === 'bash' ? 'command' : ['write', 'edit'].includes(tool) ? 'file' : 'tool',
    summary: first.slice(0, 500),
    ...(rest.join('\n').trim() ? { detail: rest.join('\n').trim().slice(0, 4000) } : {}),
    allowSession: false,
  }
}
const metadataController = new AbortController()
const stop = (reason) => {
  failure ??= reason
  closeGuidance()
  for (const settle of [...approvals.values()]) settle('deny')
  const terminate = () => {
    child?.stdin?.end()
    child?.kill('SIGTERM')
    forceTimer ??= setTimeout(() => child?.kill('SIGKILL'), 5000)
  }
  if (stopped && child?.stdin?.writable && !child.stdin.destroyed) {
    nativeStop ??= new Promise((resolve) => {
      child.stdin.write(JSON.stringify({ id: 'cliworker-stop', type: 'abort' }) + '\n', () => {
        setTimeout(() => {
          terminate()
          resolve()
        }, 200)
      })
    })
    return nativeStop
  }
  terminate()
  return Promise.resolve()
}
process.on('SIGTERM', () => {
  stopped = true
  metadataController.abort()
  stop('任务已停止')
})
process.on('SIGINT', () => {
  stopped = true
  metadataController.abort()
  stop('任务已停止')
})
const persist = async () => {
  if (!session || config.discover) return
  const path = await realpath(session.path)
  const nativeRoot = await privateDirectory(config.nativeRoot ?? join(config.stateDirectory, 'agent'))
  if (!inside(nativeRoot, path) || path !== resolve(session.path))
    throw new Error('CLI session path escaped its private directory or used a symlink')
  await privateFile(path)
  const mapDirectory = join(config.stateDirectory, 'sessions')
  await privateDirectory(mapDirectory)
  const filename = join(mapDirectory, createHash('sha256').update(session.id).digest('hex') + '.json')
  await writePrivateFile(
    filename,
    JSON.stringify({
      cli: config.cli,
      project: config.project,
      id: session.id,
      path,
      model: config.preference.model,
    }),
  )
}
try {
  const harnessTools = readNativeHarnessConnection()
  const requestPath = process.argv[2]
  config = JSON.parse(await privateFile(requestPath, true))
  config.maxLineBytes ??= 1_048_576
  config.maxRunBytes ??= 16_777_216
  config.maxNativeLineBytes ??= config.maxLineBytes
  eventBudget = createEventBudget(config, value => output({ type: 'event', event: value }))
  const inboundError = `原生 CLI 单个入站协议帧超过上限（${config.maxNativeLineBytes} 字节），已停止运行`
  safeErrors.add(inboundError)
  await unlink(requestPath)
  if (!config.controlNonce) await rmdir(dirname(requestPath))
  if (
    !['pi', 'omp'].includes(config.cli) ||
    (config.access !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(config.access)) ||
    typeof config.executable !== 'string' ||
    !isAbsolute(config.stateDirectory)
  )
    throw new Error('Invalid bridge request')
  if (harnessTools && harnessTools.binding.cli !== config.cli) throw new Error('DSH tool bridge CLI identity mismatch')
  config.stateDirectory = await privateDirectory(config.stateDirectory)
  if (config.stopNonce)
    stopReceiver = await receiveNativeStopControl(config.stopDirectory, config.stopNonce, async () => {
      stopped = true
      metadataController.abort()
      await stop('任务已停止')
    })
  if (config.approvalNonce) {
    if (config.approvalDirectory !== join(dirname(requestPath), 'approval'))
      throw new Error('Unbound native approval control')
    approvalReceiver = await receiveNativeApprovalControl(config.approvalDirectory, config.approvalNonce, async (message, id) => {
      const settle = approvals.get(id)
      if (!settle) throw new Error('Unknown native approval')
      let value
      try { value = JSON.parse(message) } catch {}
      settle(['allow-once', 'allow-session', 'deny'].includes(value?.decision) ? value.decision : 'deny')
    })
  }
  if (config.leaseDirectory) {
    if (typeof config.nativeRoot !== 'string' || dirname(config.nativeRoot) !== config.leaseDirectory)
      throw new Error('Invalid shared account directory')
    if (!(await ownsOwnAccountLease(config.leaseDirectory, config.leaseNonce)))
      throw new Error(OWN_ACCOUNT_BUSY)
    await assertPiOmpRefreshSources(config.leaseDirectory, config.refreshReceipt)
    await assertPiOmpRefreshCache(config.leaseDirectory, config.refreshReceipt)
  }
  const nativeRoot = await privateDirectory(config.nativeRoot ?? join(config.stateDirectory, 'agent'))
  const temporaryDirectory = await privateDirectory(join(config.stateDirectory, 't'))
  await privateDirectory(join(nativeRoot, 'sessions'))
  if (!config.discover) await privateDirectory(join(config.stateDirectory, 'sessions'))
  const env = Object.fromEntries(
    [
      'PATH',
      'BUN_INSTALL',
      'HOME',
      'USERPROFILE',
      'SystemRoot',
      'SYSTEMROOT',
      'WINDIR',
      'COMSPEC',
      'ComSpec',
      'PATHEXT',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'LANG',
      'LC_ALL',
      'USER',
      'LOGNAME',
      'SHELL',
      'TMPDIR',
      'NODE_EXTRA_CA_CERTS',
      'SSL_CERT_FILE',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  )
  Object.assign(env, {
    PI_CODING_AGENT_DIR: nativeRoot,
    TMPDIR: temporaryDirectory,
    ...(process.platform === 'win32' ? { TMP: temporaryDirectory, TEMP: temporaryDirectory } : {}),
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    ELECTRON_RUN_AS_NODE: '1',
    NO_COLOR: '1',
  })
  const nativeEnvironment = JSON.parse(await privateFile(join(nativeRoot, 'native-env.json'), true))
  if (
    !nativeEnvironment ||
    typeof nativeEnvironment !== 'object' ||
    Array.isArray(nativeEnvironment) ||
    Object.entries(nativeEnvironment).some(
      ([key, value]) =>
        !/^[A-Z][A-Z0-9_]*$/.test(key) ||
        /^(?:PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|SHELL|TMPDIR|TMP|TEMP|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|OMP_AUTH_BROKER_.*|OMP_PROFILE|PI_PROFILE|PI_CONFIG_DIR|PI_CODING_AGENT_DIR|LD_.*|DYLD_.*)$/i.test(
          key,
        ) ||
        typeof value !== 'string',
    )
  )
    throw new Error('Invalid native environment snapshot')
  Object.assign(env, nativeEnvironment)
  // Account .env/provider snapshots are not authority for another Worker's
  // bridge. Only the Host-injected run capability can reach this extension.
  if (harnessTools) env[HARNESS_CONNECTION_ENV] = JSON.stringify(harnessTools)
  else delete env[HARNESS_CONNECTION_ENV]
  // Pi's SDK is loaded in this process and consults process.env itself. Apply
  // the same own-source environment before importing it, not only at spawn.
  process.env = env
  const ompPermissions = config.cli === 'omp'
    ? ompPermissionSettings(config.access, config.discover || config.metadataPhase
      ? ['always-ask', 'write', 'yolo']
      : await probeOmpApprovalModes(config.executable, metadataController.signal))
    : undefined
  if (stopped) throw new Error('任务已停止')
  if (ompPermissions?.notice) event({ kind: 'status', text: ompPermissions.notice })
  const isolated =
    config.cli === 'pi'
      ? [
          '--no-extensions',
          '--no-skills',
          '--no-prompt-templates',
          '--no-themes',
          '--no-context-files',
          '--no-approve',
        ]
      : [
          '--no-extensions',
          '--no-skills',
          '--no-rules',
          '--no-title',
          '--no-lsp',
          '--no-pty',
          '--approval-mode',
          ompPermissions.mode,
          '--config',
          join(nativeRoot, 'config.yml'),
        ]
  if (config.cli === 'omp') {
    Object.assign(env, ompConfigurationEnvironment(dirname(nativeRoot)))
    Object.assign(process.env, ompConfigurationEnvironment(dirname(nativeRoot)))
    const nativeAuth = JSON.parse(await readFile(join(nativeRoot, 'native-auth.json'), 'utf8'))
    await writePrivateFile(
      join(nativeRoot, 'config.yml'),
      JSON.stringify({
        ...Object.fromEntries(Object.entries(nativeAuth).filter(([key]) => key !== 'tools' && !key.startsWith('tools.'))),
        startup: { setupWizard: false, checkUpdate: false, showSplash: false },
        disabledProviders: [
          'native',
          'claude',
          'claude-plugins',
          'codex',
          'cursor',
          'gemini',
          'opencode',
          'mcp-json',
          'vscode',
          'windsurf',
          'omp-plugins',
        ],
        mcp: { enableProjectConfig: false },
        retry: { modelFallback: false },
        // OMP rebuilds its memory files from this private agent.db (which holds
        // the account): a shared directory would be overwritten by each store.
        memory: { backend: 'off' },
        tools: ompPermissions.tools,
      }),
    )
  }
  let resume
  let catalog
  if (config.metadataPhase === 'native-candidates') {
    const candidates = await queryNativeCandidates(
      config.cli,
      config.executable,
      nativeRoot,
      env,
      (process) => {
        child = process
        if (stopped) stop('任务已停止')
      },
      { signal: metadataController.signal },
    )
    if (stopped || failure) throw new Error('任务已停止')
    const snapshot = snapshotNativeCandidates(candidates, env)
    await writePrivateFile(join(nativeRoot, 'catalog-candidates.json'), JSON.stringify(snapshot))
    output({ phase: 'native-candidates', count: snapshot.length })
    finalized = true
  } else if (config.metadataPhase === 'account-scope') {
    let candidates = JSON.parse(
      await privateFile(join(nativeRoot, 'catalog-candidates.json'), true, 16 * 1024 * 1024),
    )
    if (!Array.isArray(candidates)) throw new Error('Invalid native candidate snapshot')
    if (config.cli === 'omp') {
      // This online phase owns the same managed registry used by the eventual
      // RPC process. Let OMP refresh/convert new account models before applying
      // our stricter current-account intersection; never union remote names into
      // stale candidates or write the user's native model cache.
      candidates = snapshotNativeCandidates(await queryNativeCandidates(
        config.cli, config.executable, nativeRoot, env,
        (process) => {
          child = process
          if (stopped) stop('任务已停止')
        },
        { signal: metadataController.signal, refresh: true },
      ), env)
      if (stopped || failure) throw new Error('任务已停止')
      await writePrivateFile(join(nativeRoot, 'catalog-candidates.json'), JSON.stringify(candidates))
    }
    catalog = await accountSupportedChoices(config.cli, nativeRoot, candidates, env, {
      signal: metadataController.signal,
    })
  } else {
    catalog = config.confirmedCatalog
    if (!Array.isArray(catalog)) throw new Error('Missing confirmed account model catalog')
  }
  if (stopped || failure) throw new Error('任务已停止')
  if (finalized) {
    // Candidate phase has no account networking or model execution.
  } else if (config.discover || config.metadataPhase === 'account-scope') {
    output(catalog)
    finalized = true
  } else {
    if (
      typeof config.preference?.model !== 'string' ||
      !/^[A-Za-z0-9_.:-]+\/[^\s\x00-\x1f]+$/.test(config.preference.model)
    )
      throw new Error('Invalid selected native provider/model')
    const slash = config.preference.model.indexOf('/')
    selectedProvider = config.preference.model.slice(0, slash)
    selectedModel = config.preference.model.slice(slash + 1)
    const selected = catalog.find((model) => model.id === config.preference.model)
    if (
      !selected ||
      (config.preference.effort !== 'default' && !selected.efforts.includes(config.preference.effort))
    )
      throw new Error('所选模型或强度不在原生可用目录中')
    if (
      !['plan', 'accept-edits'].includes(config.mode) ||
      typeof config.prompt !== 'string' ||
      !config.prompt.trim()
    )
      throw new Error('Invalid task mode or prompt')
    config.project = await realpath(config.project)
    if (config.conversationId) {
      await privateDirectory(join(config.stateDirectory, 'sessions'))
      const mapping = join(
        config.stateDirectory,
        'sessions',
        createHash('sha256').update(config.conversationId).digest('hex') + '.json',
      )
      const mapped = JSON.parse(await privateFile(mapping, true))
      if (
        mapped.cli !== config.cli ||
        mapped.project !== config.project ||
        mapped.id !== config.conversationId
      )
        throw new Error('Saved session identity does not match this request')
      resume = await realpath(mapped.path)
      if (!inside(nativeRoot, resume) || resume !== resolve(mapped.path))
        throw new Error('Saved session path escaped its private directory or used a symlink')
      await privateFile(resume)
    }
    const contextObserver = config.cli === 'pi' ? await preparePiContextObserver(config.executable) : { argv: [], env: {} }
    delete env[PI_CONTEXT_ENV]
    Object.assign(env, contextObserver.env)
    const attachmentInput = config.cli === 'pi'
      ? await nativeAttachmentInput('pi', config.prompt, config.attachments, metadataController.signal)
      : { message: await nativeAttachmentInput('text', config.prompt, config.attachments, metadataController.signal) }
    const harnessExtension = await prepareNativeHarnessExtension(harnessTools, { signal: metadataController.signal })
    // Pi asks through the plugin's tool_call gate. An install without that hook
    // runs stricter: 询问 reads only, 自动批准编辑 edits without commands.
    delete env[PI_GATE_ENV]
    permissionGate = config.cli === 'pi' && config.mode === 'accept-edits' && config.access !== 'danger-full-access'
      ? (await preparePiPermissionGate(config.executable, config.access, harnessExtension.tools)) ?? false
      : undefined
    if (permissionGate) Object.assign(env, permissionGate.env)
    else if (permissionGate === false) {
      if (config.access === 'read-only') config.mode = 'plan'
      event({ kind: 'status', text: config.access === 'read-only'
        ? 'Pi 当前安装版不支持工具确认，本轮按只读运行'
        : 'Pi 当前安装版不支持工具确认，本轮只自动批准编辑，不执行命令' })
    }
    const tools = [...piOmpNativeTools(config.cli, config.mode, config.access, permissionGate !== false), ...harnessExtension.tools]
    // Pi's addendum keeps its native preamble; the note names the extension tools Pi sees.
    const guidance = nativeFirstGuidance(harnessExtension.tools)
    const nativeArgs = [
      '--mode',
      'rpc',
      ...isolated,
      ...harnessExtension.argv,
      ...contextObserver.argv,
      ...(permissionGate ? permissionGate.argv : []),
      '--provider',
      selectedProvider,
      '--model',
      selectedModel,
      ...(config.preference.effort === 'default'
        ? []
        : ['--thinking', config.preference.effort === 'none' ? 'off' : config.preference.effort]),
      '--tools',
      tools.join(','),
      ...(guidance ? ['--append-system-prompt', guidance] : []),
      ...(resume ? [config.cli === 'pi' ? '--session' : '--resume', resume] : []),
    ]
    const launch = nativeLaunchArgv([config.executable, ...nativeArgs])
    if (stopped) throw new Error('任务已停止')
    child = spawnNativeProcess(launch[0], launch.slice(1), {
      cwd: config.project,
      env,
      detached: false,
      stdio: config.cli === 'pi' ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    })
    let pending = '',
      settled = false,
      finalState = false,
      sent = false,
      response = '',
      currentText = '',
      assistantStep = 0
    const eventOutput = event
    const responses = new NativeBlockResponses(config.cli, event)
    const responseId = () => `${session.id}:${assistantStep}`
    const textBlocks = new Map()
    const toolResponses = new Map()
    const publicText = (index, text, snapshot = false) => {
      if (typeof text !== 'string') throw new Error('Invalid native text content')
      const key = Number.isSafeInteger(index) && index >= 0 ? `text:${index}` : 'text:stream'
      const mapKey = `${responseId()}:${key}`, previous = textBlocks.get(mapKey) ?? ''
      if (snapshot && !text.startsWith(previous)) throw new Error('Native final text conflicts with streamed content')
      const delta = snapshot ? text.slice(previous.length) : text
      textBlocks.set(mapKey, snapshot ? text : previous + text)
      currentText += delta
      response += delta
      if (delta) responses.event(responseId(), key, { kind: 'assistant', step: assistantStep, text: delta }, index)
    }
    const thinkingBlocks = new Map()
    const thinkingKey = () => responseId()
    const publicThinking = (messageKey, index, text, state, force = false) => {
      if (!Number.isSafeInteger(index) || index < 0 || typeof text !== 'string') return
      const key = `${messageKey}:${index}`
      let block = thinkingBlocks.get(key)
      if (!block) {
        if (!text) return
        block = { messageKey, index, step: thinkingBlocks.size, text: '', emitted: '', emittedAt: 0 }
        thinkingBlocks.set(key, block)
      }
      block.text = text
      block.state = state
      // Native token deltas can be tiny. Coalesce live increments while
      // always delivering the authoritative completed block immediately.
      const now = Date.now()
      if (!force && state === 'RUNNING' && now - block.emittedAt < 200) return
      block.emittedAt = now
      if (responses.completed(String(messageKey))) return
      responses.event(String(messageKey), `thinking:${index}`, {
        kind: 'reasoning',
        step: block.step,
        text: `${config.cli === 'pi' ? 'Pi' : 'OMP'} 公开思考`,
        ...(state === 'RUNNING' && text && text.startsWith(block.emitted) ? { delta: text.slice(block.emitted.length) } : { detail: text }),
        state,
      }, index)
      block.emitted = text
    }
    const toolSteps = new Map()
    const send = (value) => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n')
    }
    const nativeSteers = new Map(),
      steerRequestIds = new Set()
    let finalRequested = false, statsTimer, liveStatsTimer, liveStatsId, liveStatsSequence = 0
    const emitStats = (value) => {
      let contextUsage
      const count = (value) => Number.isSafeInteger(value) && value >= 0
      const tokens = value.data?.tokens, context = value.data?.contextUsage
      const usage = tokens && Object.fromEntries(
        ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'reasoning']
          .filter((key) => count(tokens[key])).map((key) => [key, tokens[key]]),
      )
      contextUsage = context && count(context.contextWindow) && context.contextWindow > 0 &&
        (context.tokens === null || count(context.tokens))
        ? { tokens: context.tokens, contextWindow: context.contextWindow,
            ...(typeof context.percent === 'number' && Number.isFinite(context.percent) ? { percent: context.percent } : {}) }
        : undefined
      if ((usage && Object.keys(usage).length) || contextUsage)
        output({ type: 'native', record: { type: 'cliworker.rpc_usage', cli: config.cli,
          sessionId: session.id, source: `${config.cli}.get_session_stats`,
          ...(config.cli === 'omp' ? { basis: 'native-active-context' } : {}),
          ...(usage && Object.keys(usage).length ? { usage } : {}),
          ...(contextUsage ? { contextUsage } : {}) } })
      return contextUsage
    }
    // These native read-only RPC snapshots do not invoke the model or alter
    // messages. At most one optional live query is outstanding.
    const requestLiveStats = () => {
      if (liveStatsId || settled || stopped || failure) return
      liveStatsId = `cliworker-live-stats-${++liveStatsSequence}`
      liveStatsTimer = setTimeout(() => { liveStatsId = undefined }, 750)
      send({ id: liveStatsId, type: 'get_session_stats' })
    }
    const contextInspection = config.cli === 'omp' ? new OmpContextInspection({ send,
      emit: record => output({ type: 'native', record }), done: () => requestFinalState() }) : undefined
    const requestFinalState = () => {
      clearTimeout(statsTimer)
      statsTimer = undefined
      if (!stopped) send({ id: 'final', type: 'get_state' })
    }
    const finishIfReady = () => {
      if (!settled || nativeSteers.size || finalRequested || stopped) return
      finalRequested = true
      // Optional metadata cannot change the generation outcome or keep the CLI alive.
      statsTimer = setTimeout(requestFinalState, 750)
      send({ id: 'usage', type: 'get_session_stats' })
    }
    closeGuidance = () => {
      for (const request of nativeSteers.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('原生引导通路已关闭或尚未准备，请保留消息后重试'))
      }
      nativeSteers.clear()
    }
    if (config.controlNonce) {
      controlReceiver = await receivePiOmpControl(
        join(dirname(requestPath), 'control'),
        config.controlNonce,
        (message, _requestId, attempt) => {
          if (!sent || settled || stopped || failure || child.stdin.destroyed || child.exitCode !== null)
            return Promise.reject(
              Object.assign(new Error('原生引导通路已关闭或尚未准备，请保留消息后重试'), {
                code: 'STEER_REJECTED',
              }),
            )
          const id = `cwn-steer-${attempt}`
          steerRequestIds.add(id)
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              nativeSteers.delete(id)
              reject(new Error('Native guidance acknowledgement timed out'))
              finishIfReady()
            }, 12_000)
            nativeSteers.set(id, { resolve, reject, timer })
            send({ id, type: 'steer', message })
          })
        },
      )
    }
    const validateState = (state, validateModel = true) => {
      if (
        !state ||
        typeof state.sessionId !== 'string' ||
        !state.sessionId ||
        typeof state.sessionFile !== 'string' ||
        !inside(nativeRoot, resolve(state.sessionFile))
      )
        throw new Error('CLI did not return a private session identity')
      if (
        validateModel &&
        (state.model?.provider !== selectedProvider ||
          state.model?.id !== selectedModel ||
          (config.preference.effort !== 'default' &&
            state.thinkingLevel !== (config.preference.effort === 'none' ? 'off' : config.preference.effort)))
      )
        throw new Error('CLI model or effort differs from the selected preference')
      if (
        (session && session.id !== state.sessionId) ||
        (config.conversationId && config.conversationId !== state.sessionId)
      )
        throw new Error('CLI changed the conversation identity')
      if (
        (resume && resume !== resolve(state.sessionFile)) ||
        (session && session.path !== resolve(state.sessionFile))
      )
        throw new Error('CLI changed the saved session file')
      session = { id: state.sessionId, path: resolve(state.sessionFile) }
    }
    let contextSequence = 0
    // A gated Pi turn starts only after the gate reports its hook registered;
    // without that record nothing would ask before a write or command.
    let stateReady = false, gateReady = false, gateTimer
    const sendPrompt = () => {
      if (!stateReady || sent || stopped || failure) return
      if (permissionGate && !gateReady) {
        gateTimer ??= setTimeout(() => stop('Pi 权限确认扩展未加载，本轮未开始'), 5000)
        return
      }
      clearTimeout(gateTimer)
      sent = true
      requestLiveStats()
      send({ id: 'prompt', type: 'prompt', ...attachmentInput })
    }
    const consume = (value) => {
      if (!value || typeof value !== 'object' || typeof value.type !== 'string')
        throw new Error('Invalid native RPC record')
      if (value.type === 'available_commands_update') {
        contextInspection?.observeCommands(value.commands)
        return
      }
      if (contextInspection?.consume(value)) return
      if (value.type === 'response' && config.forkOperation) {
        if (!value.success) throw new Error('Pi 原生分支 RPC 被拒绝')
        if (value.id === 'initial') {
          validateState(value.data, false)
          if (value.data.isStreaming || value.data.isCompacting || (value.data.pendingMessageCount ?? 0) > 0)
            throw new Error('Pi 原生会话仍在运行')
          if (config.forkOperation === 'delete') {
            // Only the exact branch mapping passed by the Host owns this deletion.
            child.stdin.end()
            settled = finalState = sent = true
            return
          }
          send({ id: 'fork-clone', type: 'clone' })
        } else if (value.id === 'fork-clone') {
          if (value.data?.cancelled) throw new Error('Pi 已取消分支')
          send({ id: 'fork-state', type: 'get_state' })
        } else if (value.id === 'fork-state') {
          if (!value.data?.sessionId || value.data.sessionId === config.conversationId)
            throw new Error('Pi 分支回执没有新的原生会话 ID')
          // clone switched only this metadata process; the source mapping is immutable.
          session = undefined
          resume = undefined
          const source = config.conversationId
          config.conversationId = undefined
          validateState(value.data, false)
          config.conversationId = source
          output({ type: 'native', record: { type: 'cliworker.fork_created', id: session.id } })
          settled = finalState = sent = true
          child.stdin.end()
        }
        closeTimer ??= setTimeout(() => stop('Pi 分支元数据进程未退出'), 5000)
        return
      }
      if (value.type === 'response') {
        if (typeof value.id === 'string' && value.id.startsWith('cliworker-live-stats-')) {
          if (value.id !== liveStatsId) return
          clearTimeout(liveStatsTimer)
          liveStatsId = undefined
          if (!settled && value.success === true && value.command === 'get_session_stats' && session)
            emitStats(value)
          return
        }
        if (value.id === 'usage') {
          const contextUsage = statsTimer && value.success === true && value.command === 'get_session_stats' && session
            ? emitStats(value) : undefined
          if (statsTimer) {
            clearTimeout(statsTimer); statsTimer = undefined
            if (contextInspection) contextInspection.start(session.id, contextUsage)
            else requestFinalState()
          }
          return
        }
        if (steerRequestIds.has(value.id)) {
          const request = nativeSteers.get(value.id)
          if (request) {
            clearTimeout(request.timer)
            nativeSteers.delete(value.id)
            // Native acceptance is not completion. A terminal event observed
            // before this receipt closes admission rather than claiming delivery.
            if (value.command === 'steer' && value.success === true && !settled && !stopped && !failure)
              request.resolve()
            else if (value.command === 'steer' && value.success === false)
              request.reject(
                Object.assign(new Error('Native CLI rejected guidance'), { code: 'STEER_REJECTED' }),
              )
            else request.reject(new Error('Native CLI ended before its guidance receipt'))
            finishIfReady()
          }
          return
        }
        if (!value.success) throw new Error('Native CLI rejected an RPC request')
        if (value.id === 'cliworker-stop') return
        if (value.id === 'select-model') {
          if (config.preference.effort !== 'default')
            send({
              id: 'select-effort',
              type: 'set_thinking_level',
              level: config.preference.effort === 'none' ? 'off' : config.preference.effort,
            })
          else send({ id: 'selected', type: 'get_state' })
        } else if (value.id === 'select-effort') send({ id: 'selected', type: 'get_state' })
        else if (value.id === 'initial' || value.id === 'selected') {
          validateState(value.data, value.id === 'selected')
          if (value.data.isStreaming) throw new Error('Native session is already streaming')
          if (
            value.id === 'initial' &&
            (value.data.model?.provider !== selectedProvider || value.data.model?.id !== selectedModel)
          ) {
            send({
              id: 'select-model',
              type: 'set_model',
              provider: selectedProvider,
              modelId: selectedModel,
            })
            return
          }
          if (
            value.id === 'initial' &&
            config.preference.effort !== 'default' &&
            value.data.thinkingLevel !==
              (config.preference.effort === 'none' ? 'off' : config.preference.effort)
          ) {
            send({
              id: 'select-effort',
              type: 'set_thinking_level',
              level: config.preference.effort === 'none' ? 'off' : config.preference.effort,
            })
            return
          }
          validateState(value.data)
          clearTimeout(startupTimer)
          if (Number.isSafeInteger(value.data.model?.contextWindow) && value.data.model.contextWindow > 0)
            output({ type: 'native', record: { type: 'cliworker.model_context', scope: 'model',
              source: `${config.cli}.get_state.model.contextWindow`, providerID: selectedProvider,
              modelID: selectedModel, contextCapacity: value.data.model.contextWindow } })
          output({
            type: 'session',
            id: session.id,
            model: `${value.data.model.provider}/${value.data.model.id}`,
          })
          event({
            kind: 'status',
            text: `${config.cli === 'pi' ? 'Pi' : 'OMP'} 原生模型已确认`,
            observedModel: `${value.data.model.provider}/${value.data.model.id}`,
          })
          stateReady = true
          sendPrompt()
        } else if (value.id === 'final') {
          validateState(value.data)
          if (value.data.isStreaming || value.data.isCompacting || (value.data.pendingMessageCount ?? 0) > 0)
            throw new Error('Native agent is still active after its terminal event')
          finalState = true
          child.stdin.end()
          closeTimer ??= setTimeout(() => stop('CLI did not exit after completion'), 5000)
        }
        return
      }
      if (config.discover) return
      if (value.type === 'extension_ui_request') {
        // Notifications carry no obligation. A tool approval goes to the Host; other interactive requests are denied.
        if (['confirm', 'select', 'input', 'editor'].includes(value.method)) {
          const gate = config.cli === 'pi' && !!permissionGate
          const request = config.approvalNonce && !stopped
            ? (gate ? readPiGateConfirm(value, permissionGate.nonce) : ompApprovalRequest(value))
            : undefined
          // OMP answers a select with Approve/Deny; the Pi gate's confirm takes a boolean.
          const answer = (decision) => send(gate
            ? { type: 'extension_ui_response', id: value.id, confirmed: decision !== 'deny' }
            : { type: 'extension_ui_response', id: value.id, value: decision === 'deny' ? 'Deny' : 'Approve' })
          if (request && approvals.size < 50 && approvalSequence < 200) {
            const id = `approval-${++approvalSequence}`
            void new Promise((resolve) => approvals.set(id, (decision) => {
              approvals.delete(id)
              resolve(decision)
            })).then((decision) => {
              if (decision === 'deny') permissionDenied = true
              answer(decision)
            })
            output({ type: 'approval', id, request })
            return
          }
          if (request) {
            permissionDenied = true
            answer('deny')
            return
          }
          failure ??= 'CLI 需要额外原生交互授权'
          send({ type: 'extension_ui_response', id: value.id, cancelled: true, confirmed: false })
        }
        return
      }
      if (value.type === 'message_start' && value.message?.role === 'assistant') {
        if (assistantStep) responses.finish(responseId())
        currentText = ''
        assistantStep++
        return
      }
      if (value.type === 'message_update' && value.assistantMessageEvent?.type === 'text_delta') {
        if (typeof value.assistantMessageEvent.delta === 'string' && value.assistantMessageEvent.delta.trim()) toolOutcomes.succeeded()
        publicText(value.assistantMessageEvent.contentIndex, value.assistantMessageEvent.delta)
        return
      }
      if (
        value.type === 'message_update' &&
        ['thinking_delta', 'thinking_end'].includes(value.assistantMessageEvent?.type)
      ) {
        const update = value.assistantMessageEvent
        const messageKey = thinkingKey(value),
          index = update.contentIndex
        const previous = thinkingBlocks.get(`${messageKey}:${index}`)?.text ?? ''
        // RPC explicitly publishes these visible text fields. Partial messages,
        // signatures and provider replay payloads are never copied.
        const redacted = update.partial?.content?.[index]?.redacted === true
        const text = redacted
          ? ''
          : update.type === 'thinking_end'
            ? update.content
            : typeof update.delta === 'string'
              ? previous + update.delta
              : undefined
        publicThinking(messageKey, index, text, update.type === 'thinking_end' ? 'COMPLETED' : 'RUNNING')
        return
      }
      if (value.type === 'message_end' && value.message?.role === 'assistant') {
        if (['error', 'aborted'].includes(value.message.stopReason)) failure ??= '模型请求失败或被中止'
        if (value.message.model && value.message.model !== selectedModel)
          failure ??= '模型响应与所选型号不一致'
        if (value.message.provider && value.message.provider !== selectedProvider)
          failure ??= '模型响应与所选提供商不一致'
        const messageKey = thinkingKey(value)
        const content = Array.isArray(value.message.content) ? value.message.content : []
        for (const block of thinkingBlocks.values()) {
          if (block.messageKey !== messageKey) continue
          const final = content[block.index]
          if (final?.type !== 'thinking' || final.redacted === true || typeof final.thinking !== 'string')
            publicThinking(messageKey, block.index, '', 'COMPLETED')
        }
        for (const [index, block] of content.entries()) {
          if (block.type === 'thinking' && block.redacted !== true && typeof block.thinking === 'string')
            publicThinking(messageKey, index, block.thinking, 'COMPLETED')
        }
        // Without contentIndex, historical streams establish no individual text
        // blocks; do not apply an uncorrelated final snapshot to an invented block.
        if (!textBlocks.has(`${responseId()}:text:stream`)) {
          for (const [index, block] of content.entries())
            if (block.type === 'text') {
              if (typeof block.text === 'string' && block.text.trim()) toolOutcomes.succeeded()
              publicText(index, block.text, true)
            }
        }
        for (const [index, block] of content.entries()) {
          if (block.type !== 'toolCall' || typeof block.id !== 'string') continue
          const step = 100000 + toolSteps.size
          toolSteps.set(block.id, step)
          const owner = responseId()
          toolResponses.set(block.id, { owner, blockId: `tool:${block.id}` })
          responses.event(owner, `tool:${block.id}`, { kind: 'tool', step, text: block.name ?? '工具', state: 'RUNNING',
            toolCall: { callId: block.id, name: block.name, input: block.arguments } }, index)
        }
        const identityMatches = (!value.message.model || value.message.model === selectedModel) &&
          (!value.message.provider || value.message.provider === selectedProvider)
        const usage = identityMatches ? piOmpResponseUsage(value.message.usage, config.cli) : undefined
        const reportedUsage = identityMatches ? piOmpReportedUsage(value.message.usage, config.cli) : undefined
        if (reportedUsage) output({ type: 'native', record: { type: 'cliworker.rpc_response', cli: config.cli,
          sessionId: session.id, source: `${config.cli}.message_end`, responseId: responseId(),
          usage: reportedUsage } })
        responses.finish(responseId(), usage)
        requestLiveStats()
        return
      }
      if (value.type === 'tool_execution_start') {
        const step = toolSteps.get(value.toolCallId) ?? 100000 + toolSteps.size
        toolSteps.set(value.toolCallId, step)
        const owner = toolResponses.get(value.toolCallId)
        const emitTool = (event) => owner ? responses.event(owner.owner, owner.blockId, event) : eventOutput(event)
        emitTool({ kind: 'tool', step, text: String(value.toolName ?? '工具'), state: 'RUNNING',
          toolCall: { callId: value.toolCallId, name: String(value.toolName ?? '工具'), input: value.args,
            ...(typeof value.args?.command === 'string' ? { command: value.args.command } : {}) } })
        return
      }
      if (value.type === 'tool_execution_end') {
        if (value.isError) toolOutcomes.failed(value.toolCallId)
        else toolOutcomes.succeeded()
        const owner = toolResponses.get(value.toolCallId)
        const emitTool = (event) => owner ? responses.event(owner.owner, owner.blockId, event) : eventOutput(event)
        emitTool({
          kind: 'tool',
          step: toolSteps.get(value.toolCallId),
          text: String(value.toolName ?? '工具'),
          state: value.isError ? 'FAILED' : 'COMPLETED',
          toolCall: { callId: value.toolCallId, output: value.result },
        })
        return
      }
      if (
        (config.cli === 'pi' && value.type === 'agent_settled') ||
        (config.cli === 'omp' && value.type === 'agent_end' && value.isTerminal !== false)
      ) {
        if (!sent) throw new Error('Unexpected native terminal event')
        settled = true
        finishIfReady()
      }
    }
    // An independent numeric-only pipe avoids Pi's RPC stdout guard and
    // never parses user diagnostics, prompt text or arbitrary CLI stderr.
    let contextPending = '', contextBytes = 0
    const contextPipe = child.stdio[3]
    contextPipe?.setEncoding('utf8')
    contextPipe?.on('error', () => {})
    contextPipe?.on('data', chunk => {
      contextBytes += Buffer.byteLength(chunk)
      if (contextBytes > 1024 * 1024) { contextPending = ''; return }
      contextPending += chunk
      if (Buffer.byteLength(contextPending) > 65536) { contextPending = ''; return }
      while (contextPending.includes('\n')) {
        const index = contextPending.indexOf('\n'), line = contextPending.slice(0, index)
        contextPending = contextPending.slice(index + 1)
        try {
          const value = JSON.parse(line)
          if (value.type === 'cliworker.pi_permission_gate') {
            if (permissionGate && value.nonce === permissionGate.nonce && value.ready === true && !gateReady) {
              gateReady = true
              sendPrompt()
            }
            continue
          }
          if (value.type === 'cliworker.pi_context_observation') {
            if (!sent || settled || stopped || !session) continue
            const context = readPiContextObservation(value, { nonce: contextObserver.nonce,
              sessionId: session.id, provider: selectedProvider, model: selectedModel, sequence: contextSequence, active: sent && !settled && !stopped })
            if (context) { contextSequence++; output({ type: 'native', record: context }) }
          }
        } catch { /* Optional malformed metadata never changes generation. */ }
      }
    })
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      try {
        pending += chunk
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          if (Buffer.byteLength(line) > config.maxNativeLineBytes) throw new Error(inboundError)
          if (line.trim()) consume(JSON.parse(line))
        }
        if (Buffer.byteLength(pending) > config.maxNativeLineBytes) throw new Error(inboundError)
      } catch (error) {
        stop(errorMessage(error))
      }
    })
    child.stderr.resume()
    startupTimer = setTimeout(() => stop('Native RPC startup timed out'), 20000)
    send({ id: 'initial', type: 'get_state' })
    const outcome = await new Promise((resolve) => {
      child.once('error', () => {
        failure ??= '无法启动原生 CLI'
      })
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    closeGuidance()
    contextInspection?.dispose()
    await controlReceiver?.close()
    controlReceiver = undefined
    for (const block of thinkingBlocks.values())
      publicThinking(block.messageKey, block.index, block.text, block.state, true)
    clearTimeout(startupTimer)
    clearTimeout(gateTimer)
    clearTimeout(statsTimer)
    clearTimeout(liveStatsTimer)
    clearTimeout(closeTimer)
    clearTimeout(forceTimer)
    if (pending.trim()) failure ??= 'Truncated native RPC frame'
    if (outcome.code !== 0) failure ??= '原生 CLI 异常退出'
    if (!settled || !finalState || !sent) failure ??= '原生 CLI 未确认任务完成'
    try {
      if (config.forkOperation === 'delete') {
        await unlink(resume)
        await unlink(join(config.stateDirectory, 'sessions', createHash('sha256').update(config.conversationId).digest('hex') + '.json'))
      } else await persist()
    } catch (error) {
      failure ??= errorMessage(error)
    }
    if (failure || stopped) output({ type: 'result', status: 'ERROR', response, error: failure, resultScope: 'run' })
    // A denied authorization is the user's decision, not a failure: the turn completes without a notice.
    else if (permissionDenied) output({ type: 'result', status: 'SUCCESS', response, resultScope: 'run' })
    else if (toolOutcomes.lastFailed) output({ type: 'result', status: 'UNCERTAIN', response, error: LAST_TOOL_FAILED, resultScope: 'run' })
    else output({ type: 'result', status: 'SUCCESS', response, resultScope: 'run',
      ...(toolOutcomes.count ? { notice: recoveredNotice(toolOutcomes.count) } : {}) })
    finalized = true
    if (failure || stopped) process.exitCode = 1
  }
} catch (error) {
  closeGuidance()
  clearTimeout(startupTimer)
  clearTimeout(closeTimer)
  clearTimeout(forceTimer)
  if (!finalized) output({ type: 'result', status: 'ERROR', response: '', error: errorMessage(error) })
  process.exitCode = 1
}
for (const settle of [...approvals.values()]) settle('deny')
await controlReceiver?.close().catch(() => undefined)
await stopReceiver?.close().catch(() => undefined)
await approvalReceiver?.close().catch(() => undefined)
import { nativeAttachmentInput } from './native-attachments.mjs'
