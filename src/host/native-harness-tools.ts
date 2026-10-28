import { createServer, type IncomingMessage } from 'node:http'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, lstat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Host-private identity. Never accept an identity supplied by the CLI as authority. */
export interface NativeHarnessBinding {
  parentSessionId: string
  harnessSessionId: string
  workerId: string
  runId: string
  cli: string
}
export interface NativeHarnessConnection {
  url: string
  token: string
  binding: NativeHarnessBinding
  /** Native permissions have explicitly admitted this exact managed bridge. */
  executionReady?: boolean
}
export interface NativeHarnessTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execution: 'host' | 'model' | 'dispatch' | 'unknown'
}
export interface NativeHarnessSkill {
  name: string
  description: string
  content: string
  requiredTools?: readonly string[]
  resourceBase?: { kind: 'directory'; path: string } | { kind: 'url'; url: string } | { kind: 'opaque'; description: string }
}
export interface NativeHarnessToolsOptions {
  binding: NativeHarnessBinding
  /** Resolve the current child Agent's scoped tools.schemas(), not a global catalog. */
  tools: readonly NativeHarnessTool[] | ((signal: AbortSignal) => readonly NativeHarnessTool[] | Promise<readonly NativeHarnessTool[]>)
  authorize(binding: Readonly<NativeHarnessBinding>, operation: { method: string; name?: string }): void | Promise<void>
  /** Must use the scoped Host tools runtime; never call a tool definition directly. */
  execute(input: { binding: Readonly<NativeHarnessBinding>; callId: string; name: string; arguments: unknown; signal: AbortSignal }): Promise<unknown>
  skills?: {
    list(signal: AbortSignal): Promise<readonly { name: string; description: string }[]>
    get(name: string, signal: AbortSignal): Promise<NativeHarnessSkill | undefined>
  }
  signal?: AbortSignal
  maxBytes?: number
  maxCalls?: number
  executionReady?: boolean
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/u.test(value)
const reserved = new Set(['dsh_list_skills', 'dsh_read_skill', 'dsh_read_skill_resource'])
// These transports could dispatch models or tools outside this explicit grant list.
const forbidden = /^(?:run_code|cliworker|cli_worker|agent|subagents?|spawn|delegate|task|send_message|interrupt_agent|(?:send|resume|close|interrupt|wait|list)_subagents?)(?:[_.-]|$)/iu
/**
 * The scoped registry establishes availability; a familiar name or MCP prefix
 * establishes nothing. Effects and approvals still belong to tools.execute.
 * Auxiliary model calls are additionally rejected by withinCliTool's guard.
 */
export function classifyHarnessTool(name: string, visibleSchemas: readonly { name: string }[] = []): NativeHarnessTool['execution'] {
  if (forbidden.test(name)) return 'dispatch'
  return visibleSchemas.some(schema => schema.name === name) ? 'host' : 'unknown'
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function failure(message: string): Error { return Object.assign(new Error(message), { publicBridgeError: true }) }
async function body(request: IncomingMessage, maximum: number): Promise<unknown> {
  let length = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > maximum) throw failure('工具桥请求超过限制')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw failure('工具桥请求不是有效 JSON') }
}
const resultText = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }] })
function hostToolResult(value: unknown) {
  // tools.execute's public rc.2 result is already its model-visible projection.
  // Never JSON-wrap an execution failure into a successful MCP result, or leak
  // execution-local value/error/meta/additionalContexts as unreviewed content.
  if (record(value) && typeof value.isError === 'boolean') {
    if (!Array.isArray(value.content)) return { ...resultText('DSH 工具结果格式不受支持；未自动重试'), isError: true }
    let unsupported = false
    const content = value.content.map(part => {
      if (record(part) && part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text }
      unsupported = true
      return { type: 'text', text: 'DSH 工具返回非文本内容，当前 CLI 工具桥尚不支持；未自动重试' }
    })
    if (Array.isArray(value.additionalContexts) && value.additionalContexts.length)
      return { content: [...content, { type: 'text', text: 'DSH 工具返回额外上下文，当前 CLI 工具桥尚不支持；未自动重试' }], isError: true }
    return { content, isError: value.isError || unsupported }
  }
  // Small explicit Host adapters may return a canonical JSON value directly.
  return resultText(value)
}
const skillSchema = (name: string, description: string, resource = false) => ({ name, description, inputSchema: {
  type: 'object', properties: name === 'dsh_list_skills' ? {} : { name: { type: 'string' }, ...(resource ? { path: { type: 'string' } } : {}) },
  required: name === 'dsh_list_skills' ? [] : resource ? ['name', 'path'] : ['name'], additionalProperties: false,
} })

export async function createNativeHarnessTools(options: NativeHarnessToolsOptions) {
  const binding = Object.freeze({ ...options.binding })
  if (Object.values(binding).some(value => !text(value))) throw new Error('工具桥身份不完整')
  const maximum = options.maxBytes ?? 1024 * 1024, maxCalls = options.maxCalls ?? 1024
  const lifetime = new AbortController(), active = new Set<Promise<unknown>>()
  const ledger = new Map<string, { hash: string; promise: Promise<unknown>; controller: AbortController }>()
  const cancelled = new Set<string>()
  async function visibleTools(signal = lifetime.signal) {
    signal.throwIfAborted()
    const grants = typeof options.tools === 'function' ? await options.tools(signal) : options.tools
    signal.throwIfAborted()
    const tools = new Map<string, NativeHarnessTool>()
    for (const grant of grants) {
      if (grant.execution !== 'host' || forbidden.test(grant.name)) continue
      if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(grant.name) || reserved.has(grant.name) || tools.has(grant.name) || !record(grant.inputSchema))
        throw failure('工具桥授权目录无效或重名')
      tools.set(grant.name, structuredClone(grant))
    }
    return tools
  }
  const initialTools = await visibleTools()
  const secret = randomBytes(32).toString('base64url')
  let closing = false, closePromise: Promise<void> | undefined
  async function check(method: string, name?: string) {
    if (closing || lifetime.signal.aborted) throw failure('当前运行已结束，工具桥已关闭')
    await options.authorize(binding, { method, ...(name ? { name } : {}) })
    if (closing || lifetime.signal.aborted) throw failure('当前运行已结束，工具桥已关闭')
    // Also revalidate replayed requests: an old receipt is not a renewed grant.
    if (method === 'tools/call' && name && !reserved.has(name) && !(await visibleTools()).has(name))
      throw failure('工具不在当前授权目录中')
  }
  async function skill(name: unknown, signal = lifetime.signal) {
    if (!text(name) || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(name) || !options.skills) throw failure('技能不可用')
    const visible = await options.skills.list(signal)
    if (!visible.some(row => row.name === name)) throw failure('技能不在当前授权目录中')
    const value = await options.skills.get(name, signal)
    if (!value || value.name !== name || typeof value.content !== 'string') throw failure('技能不可用')
    const tools = await visibleTools(signal)
    if (value.requiredTools?.some(required => !tools.has(required))) throw failure('技能所需工具未获准或尚未接通')
    return value
  }
  async function resource(name: unknown, path: unknown, signal = lifetime.signal) {
    if (!text(path) || isAbsolute(path) || /[\\:%]/u.test(path) || path.split('/').some(part => part === '..' || part === '.' || part === ''))
      throw failure('技能资源路径越界')
    const definition = await skill(name, signal)
    if (definition.resourceBase?.kind !== 'directory') throw failure('技能没有可读取的本地资源目录')
    const root = await realpath(definition.resourceBase.path), target = await realpath(resolve(root, path))
    const subpath = relative(root, target)
    if (!subpath || subpath === '..' || subpath.startsWith(`..${sep}`) || isAbsolute(subpath)) throw failure('技能资源路径越界')
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const before = await file.stat()
      if (!before.isFile() || before.nlink !== 1 || before.size > maximum) throw failure('技能资源无效或超过限制')
      const data = Buffer.alloc(before.size + 1)
      let length = 0
      while (length < data.length) {
        signal.throwIfAborted()
        const read = await file.read(data, length, data.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      const after = await file.stat(), current = await realpath(resolve(root, path)), pathStat = await lstat(target)
      if (length !== before.size || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current !== target || pathStat.isSymbolicLink() || pathStat.ino !== before.ino || pathStat.dev !== before.dev || await realpath(definition.resourceBase.path) !== root)
        throw failure('技能资源在读取期间发生变化')
      return { name: definition.name, path, encoding: 'base64', data: data.subarray(0, length).toString('base64') }
    } finally { await file.close() }
  }
  async function dispatch(method: string, params: Record<string, unknown>, key: string, signal: AbortSignal) {
    signal.throwIfAborted()
    await check(method, typeof params.name === 'string' ? params.name : undefined)
    signal.throwIfAborted()
    if (method === 'tools/list') return { tools: [...(await visibleTools(signal)).values()].map(({ execution: _execution, ...schema }) => schema).concat(options.skills ? [
      skillSchema('dsh_list_skills', '列出当前会话获准技能的摘要；正文与资源按需加载。'),
      skillSchema('dsh_read_skill', '读取获准技能说明；未声明依赖不代表全部外部能力已验证。'),
      skillSchema('dsh_read_skill_resource', '读取已授权技能内的相对资源；返回base64文件内容。', true),
    ] : []) }
    if (method === 'tools/call') {
      if (options.executionReady !== true) throw failure('当前原生工具授权尚未核验')
      if (!text(params.name) || !record(params.arguments ?? {})) throw failure('工具调用参数无效')
      const args = (params.arguments ?? {}) as Record<string, unknown>
      if (params.name === 'dsh_list_skills' && options.skills) return resultText(await options.skills.list(signal))
      if (params.name === 'dsh_read_skill') {
        const value = await skill(args.name, signal)
        return resultText({ name: value.name, description: value.description, content: value.content, requiredTools: value.requiredTools ?? [], dependencies: value.requiredTools ? 'declared' : 'unverified', resources: value.resourceBase?.kind === 'directory' })
      }
      if (params.name === 'dsh_read_skill_resource') return resultText(await resource(args.name, args.path, signal))
      if (!(await visibleTools(signal)).has(params.name)) throw failure('工具不在当前授权目录中')
      const result = await options.execute({ binding, callId: `cwn-harness-${createHash('sha256').update(key).digest('hex')}`, name: params.name, arguments: args, signal })
      if (signal.aborted) throw failure('工具调用已取消；未自动重试')
      return hostToolResult(result)
    }
    if (method === 'resources/list' || method === 'resources/templates/list') return method === 'resources/list' ? { resources: [] } : { resourceTemplates: options.skills ? [{ uriTemplate: 'dsh-skill://{name}/{path}', name: '当前获准技能资源' }] : [] }
    if (method === 'resources/read') {
      if (options.executionReady !== true) throw failure('当前原生工具授权尚未核验')
      if (!text(params.uri)) throw failure('技能资源 URI 无效')
      const match = /^dsh-skill:\/\/([a-z0-9-]+)\/(.+)$/u.exec(params.uri)
      if (!match) throw failure('技能资源 URI 无效')
      const value = await resource(match[1], match[2], signal)
      return { contents: [{ uri: params.uri, mimeType: 'application/octet-stream', blob: value.data }] }
    }
    throw failure('工具桥方法不可用')
  }
  const server = createServer(async (request, response) => {
    const finish = (status: number, value: unknown) => {
      const serialized = JSON.stringify(value)
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(Buffer.byteLength(serialized) <= maximum - 4096 ? serialized : JSON.stringify({ error: '工具桥响应超过限制；不会自动重试' }))
    }
    try {
      const auth = request.headers.authorization ?? '', expected = `Bearer ${secret}`
      if (request.method !== 'POST' || request.url !== '/rpc' || request.headers.origin || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
        finish(403, { error: '工具桥认证失败' }); return
      }
      const value = await body(request, maximum)
      if (!record(value) || canonical(value.binding) !== canonical(binding) || !text(value.clientId) || !/^[a-f0-9-]{36}$/u.test(value.clientId) || !['string', 'number'].includes(typeof value.id) || !text(value.method) || !record(value.params ?? {}))
        throw failure('工具桥调用身份无效')
      const name = record(value.params) && typeof value.params.name === 'string' ? value.params.name : undefined
      await check(value.method, name)
      if (value.method === 'rpc/cancel') {
        const params = record(value.params) ? value.params : {}
        if (!['string', 'number'].includes(typeof params.requestId)) throw failure('取消操作身份无效')
        const target = `${value.clientId}:${JSON.stringify(params.requestId)}`
        if (!cancelled.has(target) && cancelled.size >= maxCalls) throw failure('工具桥取消数量超过限制')
        cancelled.add(target)
        ledger.get(target)?.controller.abort(new Error('MCP 请求已取消'))
        finish(200, { result: {} }); return
      }
      const key = `${value.clientId}:${JSON.stringify(value.id)}`, hash = createHash('sha256').update(canonical({ method: value.method, params: value.params ?? {} })).digest('hex')
      const previous = ledger.get(key)
      if (previous && previous.hash !== hash) throw failure('同一操作身份不能使用不同参数')
      if (!previous && ledger.size >= maxCalls) throw failure('工具桥操作数量超过限制')
      const controller = previous?.controller ?? new AbortController()
      if (cancelled.has(key)) controller.abort(new Error('MCP 请求已取消'))
      const operation = previous?.promise ?? dispatch(value.method, (value.params ?? {}) as Record<string, unknown>, key, AbortSignal.any([lifetime.signal, controller.signal]))
      if (!previous) { ledger.set(key, { hash, promise: operation, controller }); active.add(operation); void operation.finally(() => active.delete(operation)).catch(() => {}) }
      const result = await operation
      await check(value.method, name)
      if (value.method === 'tools/call' && (name === 'dsh_read_skill' || name === 'dsh_read_skill_resource')) {
        const args = record(value.params) && record(value.params.arguments) ? value.params.arguments : {}
        await skill(args.name)
      } else if (value.method === 'resources/read' && record(value.params) && typeof value.params.uri === 'string') {
        const match = /^dsh-skill:\/\/([a-z0-9-]+)\/(.+)$/u.exec(value.params.uri)
        await skill(match?.[1])
      }
      finish(200, { result })
    } catch (error) {
      finish(400, { error: error instanceof Error && 'publicBridgeError' in error ? error.message : '工具桥调用失败；未自动重试' })
    }
  })
  server.requestTimeout = 30_000
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => { server.off('error', no); yes() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('工具桥地址无效')
  const connection: NativeHarnessConnection = { url: `http://127.0.0.1:${address.port}/rpc`, token: secret, binding: { ...binding }, executionReady: options.executionReady === true }
  const abort = () => { void close() }
  async function close(): Promise<void> {
    if (closePromise) return closePromise
    closing = true
    lifetime.abort(new Error('当前运行正在清理'))
    options.signal?.removeEventListener('abort', abort)
    closePromise = (async () => {
      const closed = new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()))
      server.closeIdleConnections()
      await Promise.allSettled([...active])
      await closed
      ledger.clear()
      cancelled.clear()
    })()
    return closePromise
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) await close()
  return { connection, capabilities: { transport: true, ready: options.executionReady === true, toolCount: initialTools.size, skills: !!options.skills, ...(options.executionReady === true ? {} : { reason: '已具备临时工具桥入口，原生工具授权尚未核验' }) }, close }
}

/**
 * A lease is owned from the moment it is created. Until the caller receives the
 * returned handle, any publication failure closes the listening bridge and
 * restores the child presentation before the original error is reported.
 */
export async function adoptNativeHarnessLease<T extends { connection: unknown; close(): Promise<void> }>(
  lease: T,
  resetPresentation: () => void,
  publish: () => void,
): Promise<{ connection: T['connection']; close(): Promise<void> }> {
  const release = async () => {
    try {
      await lease.close()
    } finally {
      resetPresentation()
    }
  }
  try {
    publish()
  } catch (error) {
    try {
      await release()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '工具桥发布失败，且清理未确认')
    }
    throw error
  }
  return { connection: lease.connection, close: release }
}
