import { join } from 'node:path'
import { safeObservation } from './artifacts/observations.ts'
import { redactOutput } from './executor.ts'
import { hermesHeadCommit } from './hermes-version.ts'

/**
 * Hermes commits the code first and treats later steps (dependencies, product builds) as owed work:
 * the receipt stays `outcome: success` while `stages`/`followups` name what did not finish, and the next
 * `hermes update` only redoes those steps (2026-11-17 Windows 实测：0.23.2 代码已切换，Node 依赖改名 EPERM，
 * 回执 success、build failed、followups 一项). Read-only: receipt, update.log tail and .git/HEAD.
 */
export interface HermesIncomplete {
  /** Step names from the receipt, e.g. `build`. */
  steps: string[]
  /** The log's rename-refused line, redacted and shortened; absent when the log has no such line. */
  detail?: string
  /** The cause is a refused rename of node_modules (EPERM/EBUSY): a transient hold worth one automatic retry. */
  renameBusy: boolean
  /** Receipt identity, to tell a rerun's new receipt from the one read before it. */
  updateId?: string
}
const STEP = /^[a-z][a-z0-9_-]{0,31}$/
const DETAIL_LIMIT = 240

function shorten(line: string, home: string, checkout: string): string {
  let text = redactOutput(line).replace(/^\s*(?:Error:\s*)?/, '').trim()
  // Installation paths carry the user name; the page only needs the part below the Hermes directory.
  for (const [root, label] of [[checkout, '<Hermes 代码目录>'], [home, '<Hermes 目录>']] as const) {
    for (const form of new Set([root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\'), root.replace(/\\/g, '\\\\')])) {
      if (form.length < 4) continue
      text = text.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), label)
    }
  }
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text
}

/** The terminal success receipt for exactly the checked-out commit, or undefined. */
async function successReceipt(home: string, checkout: string): Promise<Record<string, any> | undefined> {
  const text = (await safeObservation(join(home, 'logs/update_receipts/latest.json'), 256 * 1024))?.text
  let r: any
  try { r = JSON.parse(text ?? 'null') } catch { return }
  const post = r?.post_update
  if (!r || typeof r !== 'object' || r.outcome !== 'success' || !post || typeof post !== 'object' || typeof post.sha !== 'string') return
  // Only a receipt for exactly the checked-out commit describes this installation.
  const head = await hermesHeadCommit(checkout)
  if (!head || post.sha.toLowerCase() !== head) return
  return r
}
function owedSteps(r: Record<string, any>) {
  const stages: unknown[] = Array.isArray(r.stages) ? r.stages : [], followups: unknown[] = Array.isArray(r.followups) ? r.followups : []
  const failed = stages.filter((s: any) => ['build', 'deps'].includes(s?.name) && s?.outcome === 'failed').map((s: any) => s.name as string)
  return { failed, followups }
}
const UPDATE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Positive completion evidence for a resume: the id of a terminal success receipt for HEAD that owes nothing.
 * A missing, unreadable, still-running or other-commit receipt is not evidence (undefined).
 */
export async function hermesCompletedReceipt(home: string, checkout: string): Promise<string | undefined> {
  const r = await successReceipt(home, checkout)
  if (!r || typeof r.update_id !== 'string' || !UPDATE_ID.test(r.update_id)) return
  const { failed, followups } = owedSteps(r)
  return failed.length || followups.length ? undefined : r.update_id
}

export async function readHermesIncomplete(home: string, checkout: string): Promise<HermesIncomplete | undefined> {
  const r = await successReceipt(home, checkout)
  if (!r) return
  const { failed, followups } = owedSteps(r)
  if (!failed.length && !followups.length) return
  const steps = [...new Set([...failed, ...followups.map((f: any) => f?.step).filter((s): s is string => typeof s === 'string' && STEP.test(s))])].slice(0, 8)
  // followups[].reason is the truncated launcher command, not a cause. The cause is the log line of this run.
  const log = (await safeObservation(join(home, 'logs/update.log'), 256 * 1024, true))?.text ?? ''
  const run = log.slice(Math.max(0, log.lastIndexOf('=== hermes update started')))
  const line = run.split(/\r?\n/).filter(l => /\b(?:EPERM|EBUSY)\b[^\r\n]*\brename\b/.test(l)).at(-1)
  return {
    steps, renameBusy: !!line && /node_modules/.test(line),
    ...(line ? { detail: shorten(line, home, checkout) } : {}),
    ...(typeof r.update_id === 'string' && UPDATE_ID.test(r.update_id) ? { updateId: r.update_id } : {}),
  }
}
