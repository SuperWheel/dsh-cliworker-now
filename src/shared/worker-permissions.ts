import { cliOf, type CliId, type Worker, type WorkerLevel } from './types.ts'

/** The parent conversation's DSH sandbox tier, which a Worker without its own level follows. */
export type ParentAccess = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface WorkerLevelOption {
  value: WorkerLevel
  name: string
  description: string
}
export interface WorkerPermissionState {
  /** The level this Worker runs with now: its own choice, else the parent's. */
  currentValue: WorkerLevel
  /** Every level this CLI offers. */
  options: WorkerLevelOption[]
  /** The plan switch is separate from the level. */
  plan: { supported: boolean; active: boolean }
  writable: boolean
  reason?: string
}

const PARENT_LEVEL: Record<ParentAccess, WorkerLevel> = { 'read-only': 'ask', 'workspace-write': 'auto', 'danger-full-access': 'full' }
const ACCESS: Record<WorkerLevel, ParentAccess> = { ask: 'read-only', auto: 'workspace-write', full: 'danger-full-access' }

/** The level a parent tier stands for. */
export const parentLevel = (access: ParentAccess): WorkerLevel => PARENT_LEVEL[access]
/**
 * The level a run uses. A level the user chose in the Worker menu applies to
 * every turn, the main Agent's included (2026-10-29 decision); a Worker
 * without one follows the parent.
 */
export function effectiveLevel(level: WorkerLevel | undefined, access: ParentAccess): WorkerLevel {
  return level ?? PARENT_LEVEL[access]
}
/** The launch tier adapters receive for a level. */
export const levelAccess = (level: WorkerLevel): ParentAccess => ACCESS[level]

const ASK = { name: '询问', description: '读取和只读命令直接执行；改文件和有副作用的命令先问你，拒绝就不改。' }
const AUTO = {
  name: '自动审批',
  description: '使用此 CLI 原生的自动审批，由 CLI 自行判断放行，可能放行工作区外的操作；它仍要确认的请求会问你。',
}
const FULL = { name: '完全权限', description: '使用此 CLI 原生的完全权限，不再询问。' }
// OpenCode/MiMo rules cannot tell read-only commands apart, so every command asks.
const HTTP_ASK = { name: '询问', description: '读取直接执行；改文件、执行命令和工作区外的操作先问你，拒绝就不改。' }
// Pi's tool_call gate asks per tool, so every command asks as well.
const PI_ASK = { name: '询问', description: '读取直接执行；改文件和执行命令先问你，拒绝就不改。' }
/**
 * Names follow what each CLI can really do (2026-10-29 decision): a first item
 * that cannot ask is named for its actual behavior or absent, and a CLI with
 * no native auto-approval names its middle level for its native edit mode.
 */
const LEVELS: Partial<Record<CliId, { ask?: typeof ASK; auto: typeof AUTO }>> = {
  codex: { ask: ASK, auto: AUTO },
  claude: { ask: ASK, auto: AUTO },
  kimi: {
    ask: {
      name: '仅工作区编辑',
      description: '使用 Kimi 原生默认模式：工作目录是 Git 仓库时，仓库内的文件编辑自动批准；命令和其他改动先问你。不是 Git 仓库时，编辑也先问你。',
    },
    auto: AUTO,
  },
  qoder: { ask: ASK, auto: AUTO },
  qodercn: { ask: ASK, auto: AUTO },
  grok: { ask: ASK, auto: AUTO },
  mimo: { ask: HTTP_ASK, auto: AUTO },
  antigravity: {
    ask: { name: '仅规划', description: 'Antigravity 无法把授权请求转给你，此档以原生规划模式运行，只出方案、不改文件。' },
    auto: AUTO,
  },
  zcode: { ask: ASK, auto: { name: '仅工作区编辑', description: '使用 ZCode 原生编辑模式：文件编辑自动批准，命令等其他操作先问你。' } },
  opencode: { ask: HTTP_ASK, auto: { name: '仅工作区编辑', description: '工作区内的文件编辑自动批准；命令和工作区外的操作先问你。' } },
  hermes: { auto: AUTO },
  pi: {
    ask: PI_ASK,
    auto: { name: '自动批准编辑', description: '文件编辑自动批准（Pi 不限制编辑目录）；命令先问你。' },
  },
  omp: {
    ask: ASK,
    auto: { name: '自动批准编辑', description: '使用 OMP 原生 write 模式：文件编辑自动批准，命令先问你；不限制编辑目录。' },
  },
}

/** Every level this CLI offers, regardless of the parent. */
export function cliLevelOptions(cli: CliId): WorkerLevelOption[] {
  const levels = LEVELS[cli]
  if (!levels) return []
  return [
    ...(levels.ask ? [{ value: 'ask' as const, ...levels.ask }] : []),
    { value: 'auto' as const, ...levels.auto },
    { value: 'full' as const, ...FULL },
  ]
}
/** This CLI's name for a level, as the timeline and menu show it. */
export function levelName(cli: CliId, level: WorkerLevel): string {
  return cliLevelOptions(cli).find((option) => option.value === level)?.name ?? FULL.name
}
/** Antigravity's 仅规划 runs its first item as a native plan launch. */
export const askRunsAsPlan = (cli: CliId): boolean => cli === 'antigravity'
/**
 * Whether a Worker without its own level may run while the parent is 仅可查看.
 * Hermes has no first item, Kimi's auto-approves Git workspace edits, and
 * Antigravity cannot relay a request; those are refused until the user picks a level.
 */
export const runsUnderViewOnly = (cli: CliId): boolean =>
  !!LEVELS[cli]?.ask && cli !== 'kimi' && cli !== 'antigravity'

/** The menu always lists every level this CLI offers, whatever the parent's tier. */
export function workerLevelOptions(worker: Pick<Worker, 'preference'>): WorkerLevelOption[] {
  return cliLevelOptions(cliOf(worker.preference))
}

/** Whether the CLI has a native plan mode this plugin can launch. */
export function workerPlanSupported(worker: Pick<Worker, 'preference' | 'transport'>): boolean {
  const cli = cliOf(worker.preference)
  return cli !== 'hermes' && cli !== 'harness' && cli !== 'qoder' && cli !== 'qodercn' &&
    (cli !== 'kimi' || worker.transport === 'kimi-acp-v1')
}
