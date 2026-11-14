import { executeCliOperation } from './executor.ts'
import { CliOperationError } from './planner.ts'
import { OfficialUnavailableError } from './official-watch.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { bounded } from './versions.ts'
import { HermesFetchWatchdog, HermesPacks, type SlowReason } from './hermes-observation.ts'
import type { HermesUpdateOptions } from './hermes-watch.ts'
import { resolveHermesGit } from './hermes-git.ts'

const shaPattern = /^[a-f0-9]{40}$/i
const version = (value?: string) => /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? '')?.slice(1).map(BigInt)
const compare = (a: bigint[], b: bigint[]) => { for (let i = 0; i < 3; i++) { if (a[i]! < b[i]!) return -1; if (a[i]! > b[i]!) return 1 } return 0 }
/** ls-remote supplies both the tag object and its peeled commit; annotated objects are not commits. */
export function hermesSegments(text: string, before?: string, target?: string) {
  const low = version(before), high = version(target)
  if (!low || !high || compare(low, high) >= 0) throw new CliOperationError('PREREQUISITE_MISSING', 'Hermes 分段预取缺少可核对的稳定版本范围')
  const tags = new Map<string, { object?: string; peeled?: string }>()
  for (const line of text.split(/[\r\n]+/)) {
    const match = /^([a-f0-9]{40})\s+refs\/tags\/(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(\^\{\})?$/i.exec(line.trim())
    if (!match) continue
    const tag = match[2]!, v = version(tag)!
    if (compare(v, low) <= 0 || compare(v, high) > 0) continue
    const record = tags.get(tag) ?? {}, key = match[3] ? 'peeled' : 'object', sha = match[1]!.toLowerCase()
    if (record[key] && record[key] !== sha) throw new CliOperationError('INTEGRITY_MISMATCH', 'Hermes 标签包含冲突的提交记录')
    record[key] = sha; tags.set(tag, record)
  }
  const result = [...tags].filter(([, r]) => r.object).map(([tag, r]) => ({ tag, sha: r.peeled ?? r.object! })).sort((a, b) => compare(version(a.tag)!, version(b.tag)!))
  if (!result.length || result.at(-1)!.tag !== `v${target!.replace(/^v/, '')}`) throw new CliOperationError('INTEGRITY_MISMATCH', 'origin 未提供计划目标的稳定标签')
  return result
}

/** Only the executor owns processes: every transition below follows its confirmed range exit. */
export async function prefetchHermes(o: HermesUpdateOptions, reason: SlowReason, expectedSha?: string) {
  const git = await bounded(resolveHermesGit(o), o.signal)
  o.signal.throwIfAborted()
  const prefix = [git, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...((o.platform ?? process.platform) === 'win32' ? ['-c', 'windows.appendAtomically=false'] : []),
    '-c', 'fetch.prune=false', '-c', 'fetch.pruneTags=false', '-c', 'remote.origin.prune=false', '-c', 'remote.origin.pruneTags=false']
  // Explicitly retain host environment (including every proxy spelling); never add NO_PROXY.
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  env.GIT_TERMINAL_PROMPT = '0'; env.GCM_INTERACTIVE = 'Never'
  const run = (args: string[], signal: AbortSignal, output = o.output, timeout?: number) => executeCliOperation(o.backend, o.config, [...prefix, ...args], signal, output, timeout, env, undefined, o.checkout)
  let refs = '', overflow = false
  await run(['ls-remote', '--tags', 'origin'], o.signal, text => {
    if (Buffer.byteLength(refs) + Buffer.byteLength(text) > 4 * 1024 * 1024) overflow = true
    else refs += text
  }, 60_000)
  if (overflow) throw new CliOperationError('INTEGRITY_MISMATCH', 'Hermes 标签清单超过读取上限')
  const segments = hermesSegments(refs, o.beforeVersion, o.targetVersion), target = segments.at(-1)!
  expectedSha ??= await o.releaseSha?.(o.targetVersion!, o.signal)
  o.signal.throwIfAborted()
  if (!expectedSha || !shaPattern.test(expectedSha) || expectedSha.toLowerCase() !== target.sha) throw new CliOperationError('INTEGRITY_MISMATCH', 'Hermes 目标标签提交与计划、回执或发布记录不一致')
  let previous = 'HEAD'
  const startedAt = Date.now()
  for (const [index, segment] of segments.entries()) {
    for (let retry = 0; ; retry++) {
      o.signal.throwIfAborted()
      const packs = new HermesPacks(); await packs.snapshot(o.checkout)
      const watchdog = new HermesFetchWatchdog(Date.now()), controller = new AbortController()
      let polling = Promise.resolve(), pending = false
      const poll = async () => {
        const now = Date.now(), pack = await packs.poll(o.checkout)
        const slow = pack.complete ? watchdog.check(now, pack.bytes) : undefined
        o.progress({ channel: 'takeover', reason, stage: `Hermes 拉取${reason === 'OFFICIAL_STALLED' ? '停滞' : '过慢'}，插件按版本分段拉取代码，完成后交回官方更新`, currentStep: index + 1, totalSteps: segments.length, stepName: `第 ${index + 1}/${segments.length} 段（${segment.tag}）`,
          readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: pack.bytes, elapsedSeconds: Math.max(0, (now - startedAt) / 1000), retryCount: retry, resumeCount: 0 })
        if (slow && !controller.signal.aborted) controller.abort(new OfficialUnavailableError(slow))
      }
      await poll()
      const timer = setInterval(() => {
        if (pending) return
        pending = true; polling = poll().catch(() => undefined).finally(() => { pending = false })
      }, 1000)
      let failure: unknown
      try {
        await run(['fetch', '--progress', '--no-tags', '--no-write-fetch-head', '--refmap=', '--no-prune', `--negotiation-tip=${previous}`, '--negotiation-tip=HEAD', 'origin', `refs/tags/${segment.tag}`], AbortSignal.any([o.signal, controller.signal]))
      } catch (error) { failure = error }
      finally { clearInterval(timer); await polling }
      if (failure instanceof ProcessCleanupUnconfirmedError) throw failure
      o.signal.throwIfAborted()
      if (!failure) break
      // Only an observed slow segment is retried; completed segments are never fetched again.
      if (!controller.signal.aborted || retry >= 3) throw failure
      o.output(`Hermes ${segment.tag} 拉取停滞或过慢，仅重取本段（${retry + 1}/3）。\n`)
    }
    previous = segment.sha
  }
  await run(['cat-file', '-e', `${target.sha}^{commit}`], o.signal, o.output, 30_000)
}
