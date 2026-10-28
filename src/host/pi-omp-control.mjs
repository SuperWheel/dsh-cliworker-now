// Run-private, separately scoped steer/stop mailboxes; never exposes terminal input.
import { constants } from 'node:fs'
import { mkdir, lstat, realpath, open, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, win32 } from 'node:path'

const LIMIT = 450_000
const MAX_REQUESTS = 200
const MAX_ATTEMPTS = 3
const hash = (value) => createHash('sha256').update(value).digest('hex')
const valid = (id, message) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 200 &&
  typeof message === 'string' &&
  message.trim().length > 0 &&
  message.length <= 100_000
const unavailable = () => new Error('原生引导通路已关闭或尚未准备，请保留消息后重试')
const aborted = () => new Error('引导消息确认已取消，请核查当前对话后再重试')
const rejected = (message) => Object.assign(new Error(message), { code: 'STEER_REJECTED' })
export const nativeControlPathKey = (path, platform = process.platform) =>
  platform === 'win32' ? win32.toNamespacedPath(path).toLowerCase() : path
const pathKey = nativeControlPathKey

async function pinDirectory(directory) {
  const info = await lstat(directory)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    pathKey(await realpath(directory)) !== pathKey(directory)
  )
    throw new Error('Unsafe native control directory')
  return async () => {
    const current = await lstat(directory)
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      pathKey(await realpath(directory)) !== pathKey(directory)
    )
      throw new Error('Native control directory changed')
  }
}

async function readPrivate(path) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > LIMIT)
      throw new Error('Unsafe native control file')
    const text = await handle.readFile('utf8'),
      after = await handle.stat()
    if (
      Buffer.byteLength(text) > LIMIT ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.nlink !== 1
    )
      throw new Error('Native control file changed')
    return JSON.parse(text)
  } finally {
    await handle.close()
  }
}

async function writePrivate(directory, filename, value, check) {
  await check()
  const temporary = join(directory, `.control-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    await check()
    await rename(temporary, join(directory, filename))
  } finally {
    await rm(temporary, { force: true })
  }
}

/** The returned closure is scoped to one prepared launch, never another run. */
async function createControl(directory, options = {}, commandType = 'steer') {
  await mkdir(directory, { mode: 0o700 })
  const check = await pinDirectory(directory),
    nonce = randomUUID()
  const submissions = new Map(),
    controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const steer = (message, requestId, signal) => {
    if (!valid(requestId, message)) return Promise.reject(new Error('Invalid native guidance request'))
    const digest = hash(message),
      previous = submissions.get(requestId)
    if (previous && previous.digest !== digest) return Promise.reject(new Error('引导请求标识已用于其他消息'))
    if (previous && !previous.retryable) return previous.promise
    if (controller.signal.aborted) return Promise.reject(unavailable())
    if (!previous && submissions.size >= MAX_REQUESTS)
      return Promise.reject(new Error('本轮引导消息已达上限'))
    if (previous?.attempts >= MAX_ATTEMPTS)
      return Promise.reject(new Error('本条引导重试次数已达上限，请检查 CLI 状态'))
    const submission = previous ?? { digest, attempts: 0 }
    submission.attempts++
    submission.retryable = false
    submissions.set(requestId, submission)
    const promise = (async () => {
      const signalForRun = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
      if (signalForRun.aborted) throw aborted()
      await check()
      const attempt = randomUUID(),
        filename = hash(`${requestId}:${attempt}`)
      await writePrivate(
        directory,
        `${filename}.request.json`,
        { nonce, id: requestId, attempt, type: commandType, message },
        check,
      )
      const deadline = Date.now() + timeoutMs
      while (true) {
        await check()
        const receipt = await readPrivate(join(directory, `${filename}.receipt.json`))
        if (receipt) {
          if (
            receipt.nonce !== nonce ||
            receipt.id !== requestId ||
            receipt.attempt !== attempt ||
            receipt.digest !== digest ||
            typeof receipt.success !== 'boolean'
          )
            throw new Error('Invalid native guidance receipt')
          if (!receipt.success) {
            if (receipt.error === 'closed' || receipt.error === 'rejected')
              throw rejected(
                receipt.error === 'closed'
                  ? unavailable().message
                  : 'CLI 未接受这条引导消息，请保留消息后重试',
              )
            throw new Error('引导消息接收结果未确认，请核查当前对话后再重试')
          }
          return
        }
        // Process cleanup can abort the waiter immediately after the native
        // receipt was published. Preserve that known outcome before cancellation.
        if (signalForRun.aborted) throw aborted()
        const status = await readPrivate(join(directory, 'status.json'))
        if (status && status.nonce === nonce && status.closed === true) throw unavailable()
        if (Date.now() >= deadline) throw new Error('引导消息确认超时，请核查当前对话后再重试')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })().catch((error) => {
      // Only an explicit not-accepted receipt authorizes a fresh attempt.
      submission.retryable = error?.code === 'STEER_REJECTED'
      throw error
    })
    submission.promise = promise
    return promise
  }
  return {
    nonce,
    steer,
    close: async () => {
      controller.abort()
      await Promise.allSettled([...submissions.values()].map((submission) => submission.promise))
    },
  }
}

/** Bridge-side receiver; handle resolves only after the matching native receipt. */
async function receiveControl(directory, nonce, handle, commandType = 'steer') {
  if (typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce))
    throw new Error('Invalid native control identity')
  const check = await pinDirectory(directory),
    seen = new Set(),
    active = new Set()
  let closed = false,
    scanning = false
  const scan = async () => {
    if (closed || scanning) return
    scanning = true
    try {
      await check()
      for (const filename of await readdir(directory)) {
        if (closed || seen.size >= MAX_REQUESTS * MAX_ATTEMPTS) break
        if (!/^[a-f0-9]{64}\.request\.json$/.test(filename) || seen.has(filename)) continue
        seen.add(filename)
        const task = (async () => {
          const command = await readPrivate(join(directory, filename))
          if (
            !command ||
            command.nonce !== nonce ||
            command.type !== commandType ||
            !valid(command.id, command.message) ||
            typeof command.attempt !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(command.attempt) ||
            `${hash(`${command.id}:${command.attempt}`)}.request.json` !== filename
          )
            return
          let success = false,
            error
          try {
            if (closed) throw rejected(unavailable().message)
            await handle(command.message, command.id, command.attempt)
            success = true
          } catch (reason) {
            error =
              reason?.code === 'STEER_REJECTED'
                ? reason.message === unavailable().message
                  ? 'closed'
                  : 'rejected'
                : 'uncertain'
          }
          await writePrivate(
            directory,
            filename.replace('.request.', '.receipt.'),
            {
              nonce,
              id: command.id,
              attempt: command.attempt,
              digest: hash(command.message),
              success,
              ...(error ? { error } : {}),
            },
            check,
          )
        })().catch(() => undefined)
        active.add(task)
        void task.finally(() => active.delete(task))
      }
    } finally {
      scanning = false
    }
  }
  const timer = setInterval(() => {
    void scan().catch(() => undefined)
  }, 25)
  return {
    close: async () => {
      closed = true
      clearInterval(timer)
      await Promise.allSettled([...active])
      await writePrivate(directory, 'status.json', { nonce, closed: true }, check)
    },
  }
}

export const createPiOmpControl = (directory, options = {}) => createControl(directory, options, 'steer')
export const receivePiOmpControl = (directory, nonce, handle) =>
  receiveControl(directory, nonce, handle, 'steer')
export const createNativeGuidanceControl = (directory, options = {}) => createControl(directory, options, 'steer')
export const receiveNativeGuidanceControl = (directory, nonce, handle) =>
  receiveControl(directory, nonce, handle, 'steer')
export async function createNativeStopControl(directory, options = {}) {
  const control = await createControl(directory, { timeoutMs: 750, ...options }, 'stop')
  return { nonce: control.nonce, stop: () => control.steer('stop', 'stop'), close: control.close }
}
export const receiveNativeStopControl = (directory, nonce, handle) =>
  receiveControl(directory, nonce, handle, 'stop')
/** Host -> runner authorization decisions; one mailbox per prepared launch. */
export const createNativeApprovalControl = (directory, options = {}) => createControl(directory, options, 'approval')
export const receiveNativeApprovalControl = (directory, nonce, handle) =>
  receiveControl(directory, nonce, handle, 'approval')
