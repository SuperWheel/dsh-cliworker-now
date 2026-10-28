import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { spawnNativeProcess } from './native-spawn.mjs'
import { nativeLaunchArgv } from './native-launch.mjs'

const failure = (message) => new Error(message)
const bounded = (value, max) => Buffer.byteLength(value) <= max
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const steerRejected = () => Object.assign(new Error('原生引导通路已关闭或尚未准备，请保留消息后重试'), { code: 'STEER_REJECTED' })

/** One owned native process; descendants remain inside the Host's enclosing process range. */
export function createNativeIO(config, emit, signal, onNativeStderr = () => {}) {
  const children = new Set()
  const controls = new Set()
  const steering = new Map()
  let steerHandler
  let sessionId,
    result,
    response = '',
    total = 0,
    outgoing = 0,
    closed = false
  const output = (value) => {
    if (closed) throw failure('Native bridge is closed')
    const line = JSON.stringify(value) + '\n'
    if (!bounded(line, config.maxLineBytes)) throw failure('Native bridge frame exceeds limit')
    outgoing += Buffer.byteLength(line)
    if (value.type !== 'result' && outgoing > config.maxRunBytes)
      throw failure('Native bridge output exceeds run limit')
    emit(line)
  }
  const io = {
    signal,
    session(id, model) {
      if (typeof id !== 'string' || !id.trim() || id.length > 8192 || (sessionId && id !== sessionId))
        throw failure('Native session identity changed')
      if (config.conversationId && id !== config.conversationId)
        throw failure('Native resume identity mismatch')
      if (!sessionId) {
        sessionId = id
        output({ type: 'session', id, ...(model ? { model } : {}) })
      }
    },
    event(event) {
      if (
        !event ||
        !['assistant', 'reasoning', 'tool', 'status', 'diagnostic'].includes(event.kind) ||
        typeof event.text !== 'string'
      )
        throw failure('Invalid native public event')
      if (event.kind === 'assistant') response += event.text
      output({ type: 'event', event })
    },
    native(record) {
      output({ type: 'native', record })
    },
    registerSteer(handler) {
      if (typeof handler !== 'function' || steerHandler || closed || result) throw failure('Invalid native guidance handler')
      steerHandler = handler
      return () => { if (steerHandler === handler) steerHandler = undefined }
    },
    steer(message, id, attempt) {
      if (typeof message !== 'string' || !message.trim() || message.length > 100_000 || typeof id !== 'string' || !id || id.length > 200)
        return Promise.reject(failure('Invalid native guidance request'))
      const previous = steering.get(id)
      if (previous && previous.message !== message) return Promise.reject(failure('引导请求标识已用于其他消息'))
      if (previous && !previous.retryable) return previous.promise
      if (!steerHandler || closed || result || signal?.aborted) return Promise.reject(steerRejected())
      if (!previous && steering.size >= 200) return Promise.reject(failure('本轮引导消息已达上限'))
      const handler = steerHandler, submission = { message, retryable: false, promise: undefined }
      steering.set(id, submission)
      const pending = Promise.resolve().then(() => {
        if (handler !== steerHandler || closed || result || signal?.aborted) throw steerRejected()
        return handler(message, id, attempt)
      }).catch((error) => {
        // An unknown receipt is cached permanently for this run; it must never trigger another write.
        submission.retryable = error?.code === 'STEER_REJECTED'
        throw error
      })
      submission.promise = pending
      return io.trackControl(pending)
    },
    result(status, text, error, resultScope, notice) {
      if (result || !['SUCCESS', 'ERROR', 'UNCERTAIN'].includes(status) || typeof text !== 'string')
        throw failure('Invalid native terminal result')
      result = {
        type: 'result',
        status,
        response: text,
        ...(['run', 'response'].includes(resultScope) ? { resultScope } : {}),
        ...(error ? { error: String(error).slice(0, 4096) } : {}),
        // A note for a successful turn; it never changes the status.
        ...(status === 'SUCCESS' && notice ? { notice: String(notice).slice(0, 2000) } : {}),
      }
    },
    spawn(argv, options = {}) {
      signal?.throwIfAborted()
      const requested =
        config.cli === 'codex' && config.nativeExecutable && argv[0] === config.argv?.[0]
          ? [config.nativeExecutable, ...argv.slice(1)]
          : argv
      const [program, ...args] = nativeLaunchArgv(requested)
      const child = spawnNativeProcess(program, args, {
        cwd: options.cwd ?? config.project,
        env: { ...process.env, ...config.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: false,
      })
      let stderr = '',
        exited = false,
        issue,
        outcome,
        stopRequested = false,
        expectedStopExitCode
      let rejectDone
      const done = new Promise((resolve, reject) => {
        rejectDone = reject
        child.once('error', (error) => {
          issue = error
          reject(error)
        })
        child.once('close', (exitCode, exitSignal) => {
          exited = true
          outcome = { exitCode, signal: exitSignal }
          if (issue) reject(issue)
          else resolve(outcome)
        })
      })
      void done.catch(() => undefined)
      const fail = (error) => {
        issue ??= error
        rejectDone(issue)
        child.kill('SIGTERM')
      }
      const read = (chunk, callback, isError) => {
        total += chunk.length
        if (total > config.maxRunBytes) return fail(failure('Native stream exceeds run limit'))
        if (isError) {
          stderr = (stderr + chunk.toString('utf8')).slice(-8192)
          onNativeStderr(chunk)
        }
        try {
          Promise.resolve(callback?.(chunk)).catch(fail)
        } catch (error) {
          fail(error)
        }
      }
      child.stdout.on('data', (chunk) => read(chunk, options.onStdout, false))
      child.stderr.on('data', (chunk) => read(chunk, options.onStderr, true))
      child.stdout.on('error', fail)
      child.stderr.on('error', fail)
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') fail(error)
      })
      const owned = {
        process: child,
        done,
        end: () => child.stdin.end(),
        stderr: () => stderr,
        ownsPlannedStop: (exit) => stopRequested && exit === outcome && !issue,
        assertHealthy: () => {
          if (issue) throw issue
          if (
            outcome &&
            ((outcome.exitCode !== null && outcome.exitCode !== 0 && outcome.exitCode !== expectedStopExitCode) ||
              (outcome.signal && !stopRequested))
          )
            throw failure(`Native process exited unsuccessfully (${outcome.exitCode ?? outcome.signal})`)
        },
        markUnhealthy: (error) => {
          issue ??= error
        },
        async stop() {
          if (!exited) {
            const signal = options.stopSignal === 'SIGINT' ? 'SIGINT' : 'SIGTERM'
            const running = child.exitCode === null && child.signalCode === null
            if (child.kill(signal) && running) {
              stopRequested = true
              // Some native CLIs trap our cleanup signal and exit(128 + signal)
              // rather than exposing a signal in the close event. Only the
              // actually requested signal owns this exception, never a natural exit.
              expectedStopExitCode = signal === 'SIGINT' ? 130 : 143
            }
            await Promise.race([done.catch(() => undefined), delay(1000)])
            if (!exited) child.kill('SIGKILL')
          }
          await Promise.race([
            new Promise((resolve, reject) => {
              if (exited) return resolve()
              const timer = setTimeout(() => reject(failure('Native process exit is unconfirmed')), 2000)
              child.once('close', () => {
                clearTimeout(timer)
                resolve()
              })
            }),
          ])
        },
      }
      children.add(owned)
      return owned
    },
    openStdio(argv, options = {}) {
      let peer
      const queued = []
      const owned = io.spawn(argv, {
        ...options,
        onStdout: (chunk) => (peer ? peer.feed(chunk) : queued.push(chunk)),
      })
      peer = createLinePeer(owned, { ...options, signal, maxLineBytes: config.maxLineBytes })
      for (const chunk of queued) peer.feed(chunk)
      return peer
    },
    async close(error) {
      steerHandler = undefined
      const outcomes = await Promise.allSettled([...children].map((child) => child.stop()))
      const cleanup = outcomes.find((value) => value.status === 'rejected')
      if (cleanup) throw cleanup.reason
      for (const child of children) {
        try {
          child.assertHealthy()
        } catch (issue) {
          error ??= issue
        }
      }
      if (error)
        result = {
          type: 'result',
          status: 'ERROR',
          response,
          resultScope: 'run',
          error: String(error.message ?? error).slice(0, 4096),
        }
      if (!result) result = { type: 'result', status: 'ERROR', response, resultScope: 'run', error: '原生协议结束但没有轮次终态' }
      if (!sessionId && !config.forkOperation && result.status !== 'ERROR') throw failure('Native result has no session')
      output(result)
      closed = true
    },
    async stopChildren() {
      await Promise.all([...children].map((child) => child.stop()))
    },
    trackControl(promise) {
      const control = Promise.resolve(promise)
      controls.add(control)
      void control.finally(() => controls.delete(control)).catch(() => undefined)
      return control
    },
    async flush() {
      await Promise.allSettled([...controls, ...[...children].map((child) => child.flush?.())])
    },
  }
  return io
}

/** JSON-line RPC framing only. Protocol/version interpretation belongs to each CLI runner. */
export function createLinePeer(owned, options = {}) {
  const decoder = new StringDecoder('utf8'),
    listeners = new Set(),
    requests = new Map(),
    waiters = new Set(),
    recent = [],
    callbacks = new Set()
  if (options.onMessage) listeners.add(options.onMessage)
  let buffer = '',
    ended = false,
    issue
  const writes = new Set()
  owned.flush = async () => {
    await Promise.allSettled([...writes])
  }
  const rejectPending = (error) => {
    for (const pending of requests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    requests.clear()
    for (const pending of waiters) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    waiters.clear()
  }
  const fail = (error) => {
    issue ??= error
    owned.markUnhealthy?.(issue)
    rejectPending(issue)
  }
  const check = () => {
    if (issue) throw issue
    if (ended) throw failure('Native RPC connection ended')
  }
  const send = (value) => {
    const writing = new Promise((resolve, reject) => {
      try {
        check()
        const line = JSON.stringify(value) + '\n'
        if (!bounded(line, options.maxLineBytes ?? 1_048_576))
          throw failure('Native RPC request exceeds line limit')
        if (!owned.process.stdin.writable || owned.process.stdin.destroyed)
          throw failure('Native RPC input is closed')
        owned.process.stdin.write(line, (error) => (error ? reject(error) : resolve()))
      } catch (error) {
        reject(error)
      }
    })
    writes.add(writing)
    void writing.finally(() => writes.delete(writing)).catch(() => undefined)
    return writing
  }
  const deliver = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message))
      throw failure('Invalid native RPC record')
    if (message.id !== undefined && !message.method && requests.has(message.id)) {
      const pending = requests.get(message.id)
      requests.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        const error = failure(
          typeof message.error.message === 'string' ? message.error.message : 'Native RPC request rejected',
        )
        error.code = message.error.code
        pending.reject(error)
      } else pending.resolve(message.result)
    }
    recent.push(message)
    if (recent.length > 256) recent.shift()
    for (const pending of waiters) {
      if (pending.predicate(message)) {
        waiters.delete(pending)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
    }
    for (const listener of listeners) {
      let pending
      try {
        pending = Promise.resolve(listener(message))
      } catch (error) {
        fail(error)
        void owned.stop()
        continue
      }
      const callback = pending.catch((error) => {
        fail(error)
        void owned.stop()
      })
      callbacks.add(callback)
      void callback.finally(() => callbacks.delete(callback))
    }
  }
  owned.process.stdout.once('end', () => {
    try {
      buffer += decoder.end()
      if (buffer.trim()) throw failure('Truncated native RPC frame')
    } catch (error) {
      fail(error)
    }
  })
  void owned.done.then(
    () => {
      ended = true
      rejectPending(failure('Native RPC connection ended'))
    },
    (error) => {
      ended = true
      fail(error)
    },
  )
  const done = owned.done.then(async (outcome) => {
    await Promise.allSettled([...callbacks])
    if (issue) throw issue
    return outcome
  })
  void done.catch(() => undefined)
  return {
    process: owned.process,
    done,
    stderr: owned.stderr,
    feed(chunk) {
      try {
        buffer += decoder.write(chunk)
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 1)
          if (!bounded(line, options.maxLineBytes ?? 1_048_576))
            throw failure('Native RPC frame exceeds line limit')
          if (line) deliver(JSON.parse(line))
        }
        if (!bounded(buffer, options.maxLineBytes ?? 1_048_576))
          throw failure('Native RPC frame exceeds line limit')
      } catch (error) {
        fail(error)
        void owned.stop()
      }
    },
    send,
    request(method, params, settings = {}) {
      const id = settings.id ?? randomUUID()
      return new Promise((resolve, reject) => {
        try {
          check()
        } catch (error) {
          reject(error)
          return
        }
        if (requests.has(id)) {
          reject(failure('Duplicate native RPC request ID'))
          return
        }
        const timer = setTimeout(() => {
          requests.delete(id)
          reject(failure('Native RPC request timed out'))
        }, settings.timeoutMs ?? 15000)
        requests.set(id, { resolve, reject, timer })
        void send({ ...(settings.jsonrpc ? { jsonrpc: '2.0' } : {}), id, method, params }).catch((error) => {
          requests.delete(id)
          clearTimeout(timer)
          reject(error)
        })
      })
    },
    waitFor(predicate, settings = {}) {
      return new Promise((resolve, reject) => {
        try {
          check()
          const found = recent.find(predicate)
          if (found) {
            resolve(found)
            return
          }
          const pending = { predicate, resolve, reject, timer: undefined }
          pending.timer = setTimeout(() => {
            waiters.delete(pending)
            reject(failure('Native RPC event timed out'))
          }, settings.timeoutMs ?? 15000)
          waiters.add(pending)
        } catch (error) {
          reject(error)
        }
      })
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    end: owned.end,
    kill: (signal) => owned.process.kill(signal),
    async close() {
      owned.end()
      await Promise.race([owned.done.catch(() => undefined), delay(300)])
      await owned.stop()
      await Promise.allSettled([...callbacks])
      listeners.clear()
      rejectPending(failure('Native RPC connection closed'))
      if (issue) throw issue
    },
  }
}
