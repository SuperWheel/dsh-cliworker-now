import {
  constants,
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'

const recordSchema = z
  .object({
    workerId: z.uuid(),
    parentSessionId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
    initialRunId: z.uuid().optional(),
    initialPending: z.boolean().optional(),
    pendingRuns: z
      .array(z.object({ requestId: z.uuid(), runId: z.uuid() }).strict())
      .max(256)
      .optional(),
    retiredSessionIds: z.array(z.string().min(1).max(256)).max(64).optional(),
    turnRuns: z.array(z.object({ turn: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), runId: z.uuid() }).strict())
      .max(10000).superRefine((entries, ctx) => {
        const runs = new Map<string, number>()
        for (const entry of entries) {
          if (runs.has(entry.runId) && runs.get(entry.runId) !== entry.turn)
            ctx.addIssue({ code: 'custom', message: '同一 CLI run 不能绑定不同 Harness turn' })
          runs.set(entry.runId, entry.turn)
        }
      }).transform((entries) => [...new Map(entries.map((entry) => [entry.runId, entry])).values()]).optional(),
    nativeInputs: z
      .array(
        z
          .object({
            requestId: z.uuid(),
            promptHash: z.string().regex(/^[a-f0-9]{64}$/u),
            batchId: z.uuid(),
            accepted: z.boolean(),
            delivery: z.literal('steer').optional(),
            steeringState: z.enum(['pending', 'rejected', 'unknown']).optional(),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
  })
  .strict()

/** Non-secret associations only; never reuse a CLI session ID as a Harness ID. */
export class HarnessConversationStore {
  private records = new Map<string, HarnessConversationRecord>()
  private readonly path: string
  constructor(private readonly directory: string) {
    const root = lstatSync(directory)
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('原生会话存储目录不安全')
    this.path = join(directory, 'harness-conversations.json')
    const info = lstatSync(this.path, { throwIfNoEntry: false })
    if (!info) return
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('原生会话绑定文件不安全')
    const fd = openSync(
      this.path,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      const rows = z
        .array(recordSchema)
        .max(10000)
        .parse(JSON.parse(readFileSync(fd, 'utf8')))
      for (const row of rows) {
        if (
          this.records.has(row.sessionId) ||
          [...this.records.values()].some((r) => r.workerId === row.workerId)
        )
          throw new Error('原生会话绑定身份重复')
        this.records.set(row.sessionId, row)
      }
    } finally {
      closeSync(fd)
    }
  }
  list(): readonly HarnessConversationRecord[] {
    return structuredClone([...this.records.values()])
  }
  remove(record: HarnessConversationRecord): void {
    const existing = this.records.get(record.sessionId)
    if (!existing) return
    if (existing.workerId !== record.workerId || existing.parentSessionId !== record.parentSessionId)
      throw new Error('不能解除其他 Worker 的原生会话绑定')
    const next = new Map(this.records)
    next.delete(record.sessionId)
    this.commit(next)
  }
  save(record: HarnessConversationRecord): void {
    const row = recordSchema.parse(record)
    const existing = this.records.get(row.sessionId)
    if (existing && (existing.workerId !== row.workerId || existing.parentSessionId !== row.parentSessionId))
      throw new Error('原生会话绑定不可转移')
    for (const prior of existing?.turnRuns ?? []) {
      const incoming = row.turnRuns?.find((entry) => entry.runId === prior.runId)
      if (!incoming || incoming.turn !== prior.turn)
        throw new Error('已确认的 CLI run 与 Harness turn 绑定不可删除或改写')
    }
    if ([...this.records.values()].some((r) => r.workerId === row.workerId && r.sessionId !== row.sessionId))
      throw new Error('Worker 已绑定其他原生会话')
    const next = new Map(this.records)
    next.set(row.sessionId, row)
    this.commit(next)
  }
  /** `reparent` is set only by the caller that proved both parents are one rebound chain (Issue #10). */
  replace(previous: HarnessConversationRecord, replacement: HarnessConversationRecord, options: { reparent?: boolean } = {}): void {
    const row = recordSchema.parse(replacement)
    const current = this.records.get(previous.sessionId)
    if (
      !current ||
      current.workerId !== previous.workerId ||
      current.parentSessionId !== previous.parentSessionId ||
      row.workerId !== current.workerId ||
      (row.parentSessionId !== current.parentSessionId && !options.reparent) ||
      row.sessionId === current.sessionId ||
      this.records.has(row.sessionId) ||
      !row.retiredSessionIds?.includes(current.sessionId) ||
      current.retiredSessionIds?.some((id) => id !== row.sessionId && !row.retiredSessionIds?.includes(id)) ||
      row.retiredSessionIds.includes(row.sessionId) ||
      new Set(row.retiredSessionIds).size !== row.retiredSessionIds.length ||
      (row.turnRuns?.length && !current.retiredSessionIds?.includes(row.sessionId))
    )
      throw new Error('原生会话替换身份或历史引用不匹配')
    const next = new Map(this.records)
    next.delete(current.sessionId)
    next.set(row.sessionId, row)
    this.commit(next)
  }
  private commit(next: Map<string, HarnessConversationRecord>): void {
    const temporary = join(this.directory, `.harness-conversations-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, JSON.stringify([...next.values()]), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.path)
      this.records = next
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary)
      throw error
    }
  }
}
