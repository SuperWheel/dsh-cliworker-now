import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { withNativeFilePrivacy } from './native-file-privacy.mjs'

/**
 * CodeBuddy Code and WorkBuddy's built-in CLI (a CodeBuddy derivative) bill in
 * credits. Their ACP prompt result carries no token or credit receipt; each
 * model request is recorded in the native durable session transcript instead,
 * keyed by the same conversationRequestId the ACP result returns.
 */
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:-]{0,199}$/.test(value)
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const maxBytes = 32 * 1024 * 1024
const families = new Set(['codebuddy', 'workbuddycn', 'workbuddy'])
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink

function djb2Base36(value) {
  const bytes = Buffer.from(value, 'utf8')
  let hash = 5381
  for (let index = 0; index < bytes.length; index++) hash = 33 * hash ^ bytes[index]
  return (hash >>> 0).toString(36)
}

/** CodeBuddy 2.181 / WorkBuddy CLI 2.165 compressWorkspacePathName(realpath(cwd)). */
export function codebuddyProjectKey(project) {
  const base = project.replace(/[/\\:]/g, '-').replace(/^-+/, '').replace(/-+$/, '').replace(/-+/g, '-')
  if (Buffer.byteLength(base, 'utf8') <= 255) return base
  let used = 0, kept = ''
  for (const char of base) {
    const size = Buffer.byteLength(char, 'utf8')
    if (used + size > 180) break
    used += size; kept += char
  }
  return `${kept}-${djb2Base36(base)}`
}

/**
 * CodeBuddy on Windows records cwd with a lowercase drive letter (`c:\\Users\\…`, 2026-11-09)
 * while Node's realpath returns `C:\\Users\\…`; Windows paths compare case-insensitively.
 */
export function sameCodebuddyCwd(recorded, expected, platform = process.platform) {
  if (typeof recorded !== 'string' || typeof expected !== 'string') return false
  return platform === 'win32' ? win32.normalize(recorded).toLowerCase() === win32.normalize(expected).toLowerCase() : recorded === expected
}

export function codebuddyUsagePaths(config) {
  if (!families.has(config.cli) || !isAbsolute(config.home ?? '') || !isAbsolute(config.project ?? '') || !id(config.sessionId)) return []
  let project
  try { project = realpathSync(config.project) } catch { project = resolve(config.project) }
  const root = resolve(config.home), projects = join(root, 'projects'), bucket = join(projects, codebuddyProjectKey(project))
  return [root, projects, bucket, join(bucket, `${config.sessionId}.jsonl`)]
}

/**
 * Accept only rows of the exact returned user request. Requests are
 * deduplicated by native messageId (parallel tool calls repeat one request's
 * usage); a turn whose last request is not a completed assistant message, or
 * any request without a credit figure, leaves credits unknown.
 */
export function inspectCodebuddyDurableUsage(records, config) {
  if (!Array.isArray(records) || !families.has(config.cli) || !id(config.sessionId) || !id(config.userMessageId) ||
    !id(config.conversationRequestId) || typeof config.model !== 'string' || !config.model || config.model.length > 512) return
  if (records.some(row => !object(row) || (row.sessionId !== undefined && row.sessionId !== config.sessionId))) return
  const users = records.filter(row => row.type === 'message' && row.role === 'user' && row.id === config.userMessageId)
  if (users.length !== 1) return
  const user = users[0]
  if (user.providerData?.conversationRequestId !== config.conversationRequestId || user.providerData?.startsNewUserRequest !== true ||
    (user.cwd !== undefined && !sameCodebuddyCwd(user.cwd, config.cwd, config.platform))) return
  const requests = new Map()
  let last
  for (const row of records.slice(records.indexOf(user) + 1)) {
    if (row.type === 'message' && row.role === 'user' && row.providerData?.startsNewUserRequest === true) break
    const data = row.providerData
    if (!object(data) || data.conversationRequestId !== config.conversationRequestId || !object(data.usage)) continue
    if (!id(data.messageId) || data.requestModelId !== config.model) return
    const usage = data.usage
    const cached = Array.isArray(usage.inputTokensDetails) ? usage.inputTokensDetails.reduce((sum, item) => sum + (count(item?.cached_tokens) ? item.cached_tokens : NaN), 0) : 0
    const reasoning = Array.isArray(usage.outputTokensDetails) ? usage.outputTokensDetails.reduce((sum, item) => sum + (count(item?.reasoning_tokens) ? item.reasoning_tokens : NaN), 0) : 0
    if (!count(usage.inputTokens) || !count(usage.outputTokens) || usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
      !count(cached) || cached > usage.inputTokens || !count(reasoning) || reasoning > usage.outputTokens) return
    const credit = data.rawUsage?.credit
    const entry = { input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens, cached, reasoning,
      credit: amount(credit) ? credit : undefined }
    const previous = requests.get(data.messageId)
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) return
    requests.set(data.messageId, entry)
    last = row
  }
  // A trailing function_call means another request follows; the transcript is not settled yet.
  if (!last || last.type !== 'message' || last.role !== 'assistant' || last.status !== 'completed') return
  const values = [...requests.values()]
  const sum = key => values.reduce((total, value) => total + value[key], 0)
  const usage = { inputTokens: sum('input'), outputTokens: sum('output'), totalTokens: sum('total'),
    cachedReadTokens: sum('cached'), reasoningTokens: sum('reasoning') }
  if (!Object.values(usage).every(count) || usage.totalTokens === 0) return
  const credits = values.every(value => value.credit !== undefined) ? values.reduce((total, value) => total + value.credit, 0) : undefined
  return { type: 'cliworker.codebuddy_usage', cli: config.cli, source: `${config.cli}.native-transcript`,
    sessionId: config.sessionId, model: config.model, userMessageId: config.userMessageId,
    conversationRequestId: config.conversationRequestId, requests: values.length, usage,
    ...(amount(credits) && !config.subagentsActive ? { providerCredits: credits } : {}),
    ...(config.subagentsActive ? { creditsIncomplete: 'subagents' } : {}) }
}

/** Sub-agent transcripts are separate files; their requests are not in the main file. */
function subagentsActive(bucket, sessionId, since) {
  const directory = join(bucket, sessionId, 'subagents')
  try {
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) return true
    const names = readdirSync(directory)
    if (names.length > 512) return true
    return names.some(name => {
      try { const entry = lstatSync(join(directory, name)); return entry.isSymbolicLink() || entry.mtimeMs >= since } catch { return true }
    })
  } catch (error) { return error?.code !== 'ENOENT' }
}

/** Bounded, stable, no-follow read of one native transcript. Nothing is cached and no prompt text is retained. */
function readOnce(config, options) {
  const paths = codebuddyUsagePaths(config)
  if (!paths.length) return
  // CodeBuddy creates its projects tree 0755 / files 0644; reject only foreign-owned or writable-by-others paths.
  return withNativeFilePrivacy(paths.map(path => ({ path, mask: 0o022 })), privacy => {
    let fd
    try {
      const expected = process.platform === 'darwin' ? paths[0].replace(/^\/(tmp|var)(?=\/|$)/, '/private/$1') : paths[0]
      const canonical = realpathSync(paths[0])
      if (process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected) return
      const directories = paths.slice(0, -1).map(path => {
        const info = lstatSync(path)
        if (!info.isDirectory() || info.isSymbolicLink() || !privacy.allows(path, info)) throw new Error('Unsafe CodeBuddy directory')
        return { path, info }
      })
      const file = paths.at(-1), entry = lstatSync(file)
      const safe = info => info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && privacy.allows(file, info) &&
        Number.isSafeInteger(info.size) && info.size >= 0 && info.size <= maxBytes
      if (!safe(entry)) return
      fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      const before = fstatSync(fd)
      if (!safe(before) || !same(entry, before)) return
      const bytes = Buffer.alloc(before.size)
      let offset = 0
      while (offset < bytes.length) {
        const n = readSync(fd, bytes, offset, bytes.length - offset, offset)
        if (!n) return
        offset += n
      }
      if (!same(before, fstatSync(fd)) || !same(before, lstatSync(file))) return
      if (directories.some(({ path, info }) => { const now = lstatSync(path); return now.isSymbolicLink() || now.dev !== info.dev || now.ino !== info.ino })) return
      const text = new TextDecoder('utf8', { fatal: true }).decode(bytes)
      // A partially appended last line is ignored rather than rejecting the file.
      const lines = text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean)
      if (lines.length > 50000 || lines.some(line => Buffer.byteLength(line) > 4 * 1024 * 1024)) return
      const records = lines.map(line => JSON.parse(line))
      return inspectCodebuddyDurableUsage(records, { ...config, cwd: realpathSync(config.project),
        subagentsActive: subagentsActive(paths[2], config.sessionId, config.turnStartedAt ?? 0) })
    } catch { return } finally { if (fd !== undefined) closeSync(fd) }
    // Windows: CodeBuddy started from an elevated process leaves ~/.codebuddy owned by the
    // Administrators group (observed 2026-11-09); accept it only with the current user's direct full-control ACE.
  }, { ...options, reader: 'codebuddy', allowAdministratorsOwner: true, budgetMs: Math.min(options.budgetMs ?? 2000, 2000) })
}

/** The native writer may still be flushing the final assistant row when ACP settles. */
export async function readCodebuddyDurableUsage(config, options = {}) {
  const attempts = options.attempts ?? 6, delayMs = options.delayMs ?? 250
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.signal?.aborted) return
    const observed = await readOnce(config, options)
    if (observed) return options.signal?.aborted ? undefined : observed
    if (attempt + 1 < attempts) await new Promise(done => setTimeout(done, delayMs))
  }
}
