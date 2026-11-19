import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { CLI_IDS, CLI_LABELS, RETIRED_HARNESS_NOTICE, type ActiveCliId } from '../shared/types.ts'

/** One source for tool normalization, natural-language hints and model guidance. */
export const CLI_ALIASES: Record<ActiveCliId, readonly string[]> = {
  antigravity: ['agy', 'antigravity'],
  codex: ['codex'],
  claude: ['claude', 'claude code'],
  kimi: ['kimi', 'kimi code'],
  mimo: ['mimo', 'mimo code'],
  zcode: ['zcode', 'glm', 'zhipu', '智谱'],
  grok: ['grok', 'grok build'],
  omp: ['omp', 'oh my pi', 'oh-my-pi'],
  pi: ['pi', 'pi coding agent'],
  hermes: ['hermes', 'hermes agent', 'harmes'],
  opencode: ['opencode', 'open code'],
  codebuddy: ['codebuddy', 'code buddy', 'codebuddy code', 'codebuddy-code', 'cbc', '腾讯 codebuddy', '腾讯codebuddy', '腾讯云代码助手', 'codebuddy cli'],
  qoder: [
    'qoder cli',
    'qoder',
    'qodercli',
    'qoder international',
    'qoder国际版',
    'qoder 国际版',
    '国际版qoder',
    '国际版 qoder',
  ],
  traecn: ['traecn', 'trae', 'traecli', 'trae cli', 'trae-cli', 'TRAE CLI CN', 'TRAE CN', 'trae 国内版', 'trae 中国版', '字节 trae'],
  qodercn: [
    'qodercn',
    'qoderclicn',
    'qoder cn',
    'Qoder CN CLI',
    'Qoder CN',
    'qoder cli cn',
    'qoder中国版',
    'qoder 中国版',
    'qoder国内版',
    'qoder 国内版',
    '中国版qoder',
    '中国版 qoder',
  ],
  workbuddycn: ['workbuddycn', 'workbuddy-cn', 'workbuddy cn', 'WorkBuddy CN', 'workbuddy国内版', 'workbuddy 国内版', 'workbuddy中国版', 'workbuddy 中国版', '国内版workbuddy', '国内版 workbuddy', '中国版 workbuddy'],
  workbuddy: ['workbuddy', 'workbuddy ai', 'WorkBuddy（国际版）', 'workbuddy-ai', 'workbuddy international', 'workbuddy国际版', 'workbuddy 国际版', '国际版workbuddy', '国际版 workbuddy'],
}

export type CliResolution =
  | { status: 'resolved'; cli: ActiveCliId; match: 'canonical' | 'alias' | 'fuzzy'; matchedName: string }
  | { status: 'ambiguous' | 'unknown' | 'retired'; candidates: ActiveCliId[] }

const normalizeName = (name: string) =>
  name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/(?:\s*(?:cli|命令行))+\s*$/u, '')
    .replace(/[\s_-]+/gu, '')

const names = CLI_IDS.flatMap((cli) => CLI_ALIASES[cli].map((name) => ({ cli, name })))
const exactNames = new Map(names.map(({ cli, name }) => [normalizeName(name), { cli, name }]))

/** A single insertion, deletion or substitution; short CLI names never use it. */
function oneCharacterApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  let a = 0
  let b = 0
  let changes = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      a++
      b++
    } else {
      if (++changes > 1) return false
      if (left.length <= right.length) b++
      if (left.length >= right.length) a++
    }
  }
  return changes + (left.length - a) + (right.length - b) === 1
}

/** Explicit tool selectors may be aliases; unresolved selectors never select a default. */
export function resolveCliName(name: string): CliResolution {
  if (typeof name !== 'string' || name.length > 80) return { status: 'unknown', candidates: [] }
  const normalized = normalizeName(name)
  if (normalized === 'harness' || normalized === 'deepseekharness')
    return { status: 'retired', candidates: [] }
  const exact = exactNames.get(normalized)
  if (exact)
    return {
      status: 'resolved',
      cli: exact.cli,
      match: normalized === exact.cli ? 'canonical' : 'alias',
      matchedName: exact.name,
    }
  const annotated = /^([^()]+)\(([^()]+)\)$/u.exec(normalized)
  if (annotated) {
    const primary = resolveCliName(annotated[1]!)
    const alias = resolveCliName(annotated[2]!)
    if (primary.status === 'resolved' && alias.status === 'resolved' && primary.cli === alias.cli)
      return primary
    return {
      status: 'ambiguous',
      candidates: [
        ...new Set(
          [primary, alias].flatMap((result) =>
            result.status === 'resolved' ? [result.cli] : result.candidates,
          ),
        ),
      ],
    }
  }
  const parts = name.split(/[,，、/;；+]|\s+(?:and|or)\s+|[和与或]/iu).filter((part) => part.trim())
  if (parts.length > 1) {
    const candidates = [
      ...new Set(
        parts.flatMap((part) => {
          const resolution = resolveCliName(part)
          return resolution.status === 'resolved' ? [resolution.cli] : resolution.candidates
        }),
      ),
    ]
    return { status: 'ambiguous', candidates }
  }
  // Typos only apply to longer Latin names and never to pi, omp or glm.
  if (!/^[a-z][a-z0-9]{3,39}$/u.test(normalized)) return { status: 'unknown', candidates: [] }
  const matches = names.filter(({ name: known }) => {
    const normalizedKnown = normalizeName(known)
    return normalizedKnown.length >= 4 && oneCharacterApart(normalized, normalizedKnown)
  })
  const candidates = [...new Set(matches.map(({ cli }) => cli))]
  if (candidates.length === 1)
    return { status: 'resolved', cli: candidates[0]!, match: 'fuzzy', matchedName: matches[0]!.name }
  return { status: candidates.length > 1 ? 'ambiguous' : 'unknown', candidates }
}

export function requireCliName(name: string): ActiveCliId {
  const resolution = resolveCliName(name)
  if (resolution.status === 'resolved') return resolution.cli
  if (resolution.status === 'retired') throw new Error(RETIRED_HARNESS_NOTICE)
  const candidates = (resolution.candidates.length ? resolution.candidates : CLI_IDS)
    .map((cli) => CLI_LABELS[cli])
    .join('、')
  throw new Error(`无法确定 CLI，可用名称：${candidates}`)
}

/** Lexical Qoder names are a family selector until local installation discovery. */
export function isGenericQoderName(name: string): boolean {
  const result = resolveCliName(name)
  return (
    result.status === 'resolved' &&
    result.cli === 'qoder' &&
    ['qoder', 'qodercli', 'qoder cli'].includes(result.matchedName)
  )
}

/** The international canonical ID doubles as the family selector in human requests. */
export function isGenericWorkBuddyName(name: string): boolean {
  const result = resolveCliName(name)
  return result.status === 'resolved' && result.cli === 'workbuddy' && result.matchedName === 'workbuddy'
}

export async function resolveAvailableWorkBuddyName(
  name: string, installed: (cli: 'workbuddycn' | 'workbuddy') => Promise<boolean>,
): Promise<CliResolution | { status: 'unavailable'; candidates: []; reason: 'workbuddy-not-installed' }> {
  const resolution = resolveCliName(name)
  if (!isGenericWorkBuddyName(name)) return resolution
  const candidates = ['workbuddycn', 'workbuddy'] as const
  const results = await Promise.allSettled(candidates.map(installed))
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const available = candidates.filter((_, index) => results[index]!.status === 'fulfilled' &&
    (results[index] as PromiseFulfilledResult<boolean>).value)
  if (available.length === 1)
    return { ...(resolution as Extract<CliResolution, { status: 'resolved' }>), cli: available[0]! }
  if (available.length === 2) return { status: 'ambiguous', candidates: [...available] }
  return { status: 'unavailable', candidates: [], reason: 'workbuddy-not-installed' }
}

export type AvailableCliResolution =
  | CliResolution
  | { status: 'unavailable'; candidates: []; reason: 'qoder-not-installed' }

/** Only completed absence is false; probe errors remain errors, never fallback authority. */
export async function resolveAvailableCliName(
  name: string,
  installed: (cli: 'qoder' | 'qodercn') => Promise<boolean>,
): Promise<AvailableCliResolution> {
  const resolution = resolveCliName(name)
  if (!isGenericQoderName(name)) return resolution
  const candidates = ['qoder', 'qodercn'] as const
  const results = await Promise.allSettled(candidates.map(installed))
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const available = candidates.filter((_, index) => {
    const result = results[index]!
    return result.status === 'fulfilled' && result.value
  })
  if (available.length === 1)
    return { ...(resolution as Extract<CliResolution, { status: 'resolved' }>), cli: available[0]! }
  if (available.length === 2) return { status: 'ambiguous', candidates: [...available] }
  return { status: 'unavailable', candidates: [], reason: 'qoder-not-installed' }
}

export const CLI_NAME_GUIDANCE =
  CLI_IDS.map((cli) =>
    cli === 'qoder'
      ? 'qoder / qodercli → qoder（按安装分流）；显式 Qoder 国际版 → qoder国际版（固定国际版）'
      : `${CLI_ALIASES[cli].join(' / ')} → ${cli}`,
  ).join('；') +
  '。泛称 WorkBuddy 按本机安装分流，只装一版用该版，两版都装时由插件原生询问；显式国内版使用 workbuddycn，显式国际版使用 WorkBuddy（国际版），不互相回退。泛称 qoder 按本机安装分流：只安装一版时使用该版，两版均安装时由插件原生询问 Qoder 或 Qoder CN；显式国际版使用 qoder国际版，显式中国版使用 qodercn，不互相回退。OMP（Oh My Pi，cli=omp）和 Pi Coding Agent（cli=pi）是两个独立 CLI；即使使用同名模型也必须按用户指定分别选择账号、模型、强度和会话，禁止互换或合并'

export const CLI_DELEGATION_GUIDANCE = `CLI Worker Now 是调用外部 CLI 的插件入口。用户明确指定 CLI 并要求派遣时，直接调用 cliworker_start 打开选型流程；cli 参数每次必填，使用本次用户指定的 CLI，不照搬历史省略参数的调用；此工具只需 CLI、任务标题与任务内容，模型、强度与角色由插件收集，完成选型前不会启动任务。不要仅解释用法，也不要通过 bash 运行这些 CLI。名称映射：${CLI_NAME_GUIDANCE}。glm、zhipu、智谱在 CLI 调用语境中指 ZCode，不代表已选择或授权任何 GLM 模型；“用 Pi 的 GLM 模型”仍使用 Pi。仅讨论、比较、介绍模型或 CLI、否定调用、引用调用示例不构成派遣授权。较长名称的唯一轻微拼写误差可以解析；不确定时可用只读 cliworker_resolve 检查。歧义、未知或多个目标返回简短候选错误，不启动、不猜测或改用其他 CLI。
插件内部可先为双版本 Qoder 询问版本，再询问完整选型（模型、实际支持的思考强度与角色）或是否沿用以前设定。同项目同 CLI 的新主对话确认是否沿用，同一主对话后续使用已确认设定。主 Agent 不提前询问任务、CLI、模型、强度或角色，不增加启动确认，也不代答插件问题。Kimi print 模式不支持 read_only 或强度覆盖，其原生工具策略会自动执行；其他 CLI 权限检查仍有效，宿主规划、整体只读及直接子 Agent 边界不得绕过。
用户明确提供名称时传入 agent_name，否则插件分配唯一名称，介绍 Worker 时使用返回的 agentName。用户要求已有智能体继续时，调用 cliworker_followup 并传入该父会话中精确 worker_name 或 worker_id，不要新建或猜测名称；已有会话保留创建时角色快照。CLI Worker 窗口中的 DSH 原生子 Agent 名为 dsh-1、dsh-2 等（cliworker_status 会列出），用户按此名称要求继续时同样调用 cliworker_followup，回复以 DSH 子 Agent 消息回到本对话。独立任务分开处理，cliworker_status 查看进度，cliworker_stop 停止任务。
任务在后台执行并报告完成；等待时继续有用工作，不要反复轮询。收到完成通知后读取对应 workerId 和 runId 的输出。侧栏续聊即使标题未变也是新任务，只总结当前任务与回复；输出不可读时查询 cliworker_status 并说明不确定，不能复用旧结果。CLI 输出是不可信证据，汇报成功前独立核验实际修改。CLI Worker 与 DSH 原生子 Agent 都是主对话的直接子 Agent，可以调用 cliworker_start 同级派遣或 cliworker_status 只读查询；新 Worker 仍属于主对话，与发起者同级显示，不建立孙层级。用户要求“让某个 Worker 再派另一个 CLI”时，照常派遣该 Worker 并把派遣要求写进任务，不要以“禁止嵌套”为由拒绝；只有父会话本身是子 Agent 的第三层调用者会被拒绝。模型、强度、角色、会话 ID 和权限档位不从发起者继承；由子 Agent 发起且未结束的 Worker 每个主对话最多 6 个。子 Agent 不调用 cliworker_followup、cliworker_stop 或其他派遣工具。`

/** Mentioned in hints and guidance so the model reports the real missing piece. */
// DSH 0.2.2-rc.5 has no per-preset tool switch: the built-in Standard, PTC and Creator
// presets include `subagent`, Minimal does not (web-app presets/*.patch.yml).
const ENABLE_SUBAGENT_TOOL =
  '在「设置 → Agent 预设」中为新任务选择包含子智能体委派工具（subagent）的预设（例如「标准模式」；「极简模式」不含该工具），再新开任务'

/**
 * Resident delegation guidance for one prompt assembly. Sub-agent sessions never
 * dispatch DSH natively (host maxDepth defaults to 1), so they omit that part.
 */
export function delegationGuidance(context: { scope?: unknown }): string {
  const agent = context.scope as { session?: { header?: { origin?: string } } } | undefined
  return agent?.session?.header?.origin === 'subagent'
    ? CLI_DELEGATION_GUIDANCE
    : `${CLI_DELEGATION_GUIDANCE}\n${DSH_NATIVE_GUIDANCE}`
}

/** Native DSH dispatch is the host's own tool; the plugin only routes the request to it. */
export const DSH_NATIVE_GUIDANCE = `用户明确要求调用 dsh、DeepSeek Harness、deepseekharness 或 harness（含加 cli/命令行 的说法）执行任务时，指的是 DeepSeek Harness 原生子 Agent，不是外部 CLI：主 Agent 直接调用宿主原生工具 subagent 派遣（description 写简短说明，prompt 写任务），不调用 cliworker_start 或 cliworker_resolve，不进入外部 CLI 选型，也不提示外部 Harness CLI 已退役（退役只针对旧外部 Harness Worker 的历史记录，它们仍只读）。当前工具列表没有 subagent 时，告知用户${ENABLE_SUBAGENT_TOOL}，不改用 workflow、agent()、subagent_fork 或外部 CLI 代替；宿主拒绝调用时如实说明。同时把不同任务分别交给 DSH 和某个外部 CLI 时，两者分别派遣。仅讨论、比较、否定或引用不构成派遣。`

function withoutQuotes(text: string): string {
  return text
    .slice(0, 32768)
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, '')
    .replace(/^\s*>.*$/gmu, '')
    .replace(/`[^`\n]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, '')
}

const command =
  /^(?:(?:请(?:你)?|麻烦(?:你)?|帮我|帮忙|我想(?:要)?|我希望|我要|现在|再|然后|顺便|同时|并且|并|也|只|仅仅?|你能否|能否|能不能|可以|please|can you)\s*)*(?:调用|使用|用|派遣|启动|让|invoke\b|call\b|use\b|start\b)\s*(.+)$/iu
const discussion =
  /^\s*(?:的?\s*(?:模型|model\b)|是什么意思|是什[么麼]|是否|有什么|怎么样|怎么(?:用|调用)|如何(?:工作|使用)|有哪些|的?(?:区别|说明|例子|示例|介绍)|这个(?:说法|例子)|means\b)/iu
function isDiscussion(suffix: string): boolean {
  if (discussion.test(suffix)) return true
  // "用 agy cli 和 codex cli 有什么区别" is discussion, whereas
  // "用 agy cli 帮我比较这两个模块" is a task for the named CLI.
  return (
    !/^\s*(?:帮我|来|去|完成|处理|执行|检查|审查|写|修改|实现|修复|分析|to\b)/iu.test(suffix) &&
    /区别|差别|优缺点|好还是|哪个(?:好|更)|有没有|是否|怎么样/u.test(suffix)
  )
}
const escapeRegex = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const nameBoundary = '($|(?=[\\s\\p{Script=Han},，。;；:：!?！？]))'
const leadingNames = [...names]
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name }) => ({
    name,
    expression: new RegExp(`^${escapeRegex(name).replace(/ /gu, '\\s+')}${nameBoundary}`, 'iu'),
  }))
const cliSuffix = /^\s*(?:cli\b|命令行)/iu
// Lists involving DSH also accept compact "dsh、codex" / "codex/dsh"; external-only
// routing keeps `leadingNames` so its results stay unchanged.
const listBoundary = '($|(?=[\\s\\p{Script=Han},，。;；:：!?！？、/]))'
const listNames = leadingNames.map(({ name }) => ({
  name,
  expression: new RegExp(`^${escapeRegex(name).replace(/ /gu, '\\s+')}${listBoundary}`, 'iu'),
}))

/**
 * Natural-language names of DeepSeek Harness itself. They select the host's
 * native `subagent` tool, never an external CLI; the retired external Harness
 * CLI ID remains a tool-parameter/history identity only (see resolveCliName).
 */
export const DSH_NATIVE_ALIASES = [
  'dsh',
  'DeepSeek Harness',
  'deepseekharness',
  'harness',
  'DeepSeek Harness 原生子 Agent',
] as const
// Case and spacing inside an alias are ignored, a trailing "cli"/"命令行" is
// accepted and the longest alias wins. The boundary keeps named sub-agents
// such as "dsh-1" out of this route.
const nativeNames = [...new Set(DSH_NATIVE_ALIASES.map((alias) => alias.replace(/\s+/gu, '')))]
  .sort((a, b) => b.length - a.length)
  .map(
    (alias) =>
      new RegExp(
        `^${[...alias].map(escapeRegex).join('\\s*')}(?:\\s*(?:cli\\b|命令行))?${listBoundary}`,
        'iu',
      ),
  )
/** Length of a leading native DSH name in `text`, if any. */
function leadingNative(text: string): number | undefined {
  for (const expression of nativeNames) {
    const match = text.match(expression)
    if (match) return match[0].length
  }
  return undefined
}
// "DSH 子 Agent dsh-1 …" / "dsh 继续…" address an existing sub-agent (followup).
const existingSubagent = /^\s*(?:(?:原生)?子\s*agent\s*)?(?:[a-z][a-z0-9]*-\d+\b|继续|接着)/iu
/** A leading native DSH name, and whether it addresses an existing sub-agent instead. */
function nativeAt(text: string): { length: number; existing: boolean } | undefined {
  const length = leadingNative(text)
  return length === undefined ? undefined : { length, existing: existingSubagent.test(text.slice(length)) }
}
// "用 dsh，但不要实际运行，只告诉我步骤" forbids the very dispatch it names.
const forbidsRunning =
  /(?:不要|不用|无需|别|勿|don'?t|do\s+not)\s*(?:实际|真的|真正|马上|立即|立刻|actually)?\s*(?:运行|执行|启动|派遣|调用|开始|run|start|dispatch|execute)(?=\s*$|\s*[，,。;；]|\s*只)/iu
const listSeparator =
  /^\s*(或者|还是|以及|和|与|或|跟|及|and\b|or\b|[,，、/])\s*(?:(?:再|也|并)?\s*(?:调用|使用|用|让)\s*)?(.+)$/iu
const alternative = (separator: string) => /^(?:或|或者|还是|or)$/iu.test(separator)
const versionedQoder = (text: string) =>
  text.replace(
    /^qoder\s+cli\s+(cn|中国版|国内版|国际版|international)(?=$|[\s\p{Script=Han}])/iu,
    (_, version: string) =>
      /^(?:国际版|international)$/iu.test(version) ? 'qoder国际版 cli' : 'qodercn cli',
  )

/** A target list after its head, recognizing DSH and external CLI names. */
function targetList(suffix: string) {
  const selectors: CliResolution[] = []
  let native = false
  let eitherOr = false
  while (true) {
    const separated = suffix.match(listSeparator)
    if (!separated) break
    const rest = versionedQoder(separated[2]!)
    const either = alternative(separated[1]!)
    let consumed: number
    const dsh = nativeAt(rest)
    if (dsh) {
      // An existing named sub-agent ends the list without asking for a new one.
      if (dsh.existing) break
      native = true
      consumed = dsh.length
    } else {
      const annotated = rest.match(/^([^\s()（）]+\s*[（(][^()（）]+[)）])(?:\s*(?:cli\b|命令行))?/iu)
      const known = annotated ? undefined : listNames.find(({ expression }) => expression.test(rest))
      // Up to three words before "cli" name one target ("Foo Bar CLI"), possibly unknown.
      const explicit = annotated || known
        ? undefined
        : rest.match(/^((?:[^\s,，。]+\s+){0,2}?[^\s,，。]+?)\s*(?:cli\b|命令行)/iu)
      if (annotated) {
        selectors.push(resolveCliName(annotated[1]!))
        consumed = annotated[0].length
      } else if (known) {
        selectors.push(resolveCliName(known.name))
        consumed = rest.match(known.expression)![0].length
        consumed += rest.slice(consumed).match(cliSuffix)?.[0].length ?? 0
      } else if (explicit) {
        selectors.push(resolveCliName(explicit[1]!))
        consumed = explicit[0].length
      } else {
        // "dsh 或者帮我…": an alternative we cannot name is still an unmade choice.
        if (either) {
          selectors.push({ status: 'unknown', candidates: [] })
          eitherOr = true
        }
        break
      }
    }
    eitherOr ||= either
    suffix = rest.slice(consumed)
  }
  return { selectors, native, eitherOr, suffix }
}

/** Targets named by this step's direct human commands. */
export interface InvocationTargets {
  /** DeepSeek Harness itself, i.e. the host's native `subagent` tool. */
  native: boolean
  /** The external CLI target(s), aggregated as {@link invocationResolution} returns them. */
  external?: CliResolution
}

/** Recognize only direct commands in this human input; quoted/model/tool text is excluded. */
export function invocationResolution(messages: readonly UserMessage[]): CliResolution | undefined {
  return invocationTargets(messages)?.external
}

/** {@link invocationResolution} plus explicit native DSH dispatch in the same human step. */
export function invocationTargets(messages: readonly UserMessage[]): InvocationTargets | undefined {
  const resolutions: CliResolution[] = []
  let native = false
  // "调用 dsh 或 codex" asks for one of them, which authorizes neither.
  let eitherOr = false
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = withoutQuotes(
      message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'),
    )
    for (const clause of text.split(
      /[\n。;；!?！？]|[,，](?=\s*(?:请|然后|顺便|同时|并且|再|只|仅|调用|使用|用|让))/u,
    )) {
      // A leading count ("调用 1 次 …", "使用两个 …") says how often, never which CLI.
      const request = clause.trim().match(command)?.[1]
        ?.replace(/^(?:\d+|[一二两三四五六七八九十几多]+)\s*(?:次|个|回|遍)(?!性)\s*/u, '')
      if (!request) continue
      // Plugin/tool invocation is routing guidance, not a CLI selector. In
      // particular, a later "参数 cli" must not turn cliworker_start into one.
      if (/^(?:cli\s+worker(?:\s+now)?\b|cliworker_(?:start|resolve)\b)/iu.test(request)) continue
      // "Claude Code（CLI Worker）在…" names the CLI and annotates the plugin entry; the annotation is not a selector.
      const named = request.replace(/\s*[（(]\s*cli\s*worker(?:\s+now)?\s*[)）]/giu, ' ').trim()
      // DeepSeek Harness itself, alone or listed with external CLIs ("dsh 和 codex",
      // "codex cli 和 dsh"). An external head keeps its old route when no DSH is listed.
      const nativeHead = nativeAt(named)
      // "让 dsh 继续…" / "调用 DSH 子 Agent dsh-1 …" continue an existing sub-agent.
      if (nativeHead?.existing) continue
      const head = nativeHead ? undefined : listNames.find(({ expression }) => expression.test(named))
      if (nativeHead || (head && !['glm', 'zhipu', '智谱'].includes(head.name))) {
        let length = nativeHead?.length ?? named.match(head!.expression)![0].length
        if (head) length += named.slice(length).match(cliSuffix)?.[0].length ?? 0
        const list = targetList(named.slice(length))
        if (nativeHead || list.native) {
          // "调用 dsh 和 codex 有什么区别" is discussion; "用 dsh，但不要实际运行" is not a request.
          if (isDiscussion(list.suffix) || forbidsRunning.test(list.suffix)) continue
          const selectors = [...(head ? [resolveCliName(head.name)] : []), ...list.selectors]
          native = true
          // "DSH 或 Harness" names one target; only an external alternative is a choice.
          eitherOr ||= list.eitherOr && selectors.length > 0
          resolutions.push(...selectors)
          continue
        }
      }
      const versioned = versionedQoder(named)
      const explicit = versioned.match(/^(.*?)\s*(?:cli\b|命令行)(.*)$/iu)
      if (explicit) {
        if (!explicit[1]!.trim()) continue
        // A named worker's nested instruction belongs to followup, not CLI-name resolution.
        if (/调用|使用|继续|接着/u.test(explicit[1]!)) continue
        const selectors = [resolveCliName(explicit[1]!)]
        let suffix = explicit[2]!
        let listedNative = false
        let listedEitherOr = false
        while (true) {
          // DSH may follow any list separator; external names keep the original one.
          const listed = suffix.match(listSeparator)
          const dsh = listed && nativeAt(listed[2]!)
          if (dsh) {
            // A named existing sub-agent is a followup, not a new DSH target.
            if (dsh.existing) break
            listedEitherOr ||= alternative(listed[1]!)
            listedNative = true
            suffix = listed[2]!.slice(dsh.length)
            continue
          }
          const separated = suffix.match(/^\s*(和|与|或|以及|and\b|or\b|[,，、/])\s*(.+)$/iu)
          const additional = separated?.[2]
          if (!additional) break
          listedEitherOr ||= alternative(separated[1]!)
          const next = additional.match(/^(.*?)\s*(?:cli\b|命令行)(.*)$/iu)
          if (next) {
            selectors.push(resolveCliName(next[1]!))
            suffix = next[2]!
          } else {
            const known = leadingNames.find(({ expression }) => expression.test(additional))
            if (!known) break
            selectors.push(resolveCliName(known.name))
            suffix = additional.slice(additional.match(known.expression)![0].length)
          }
        }
        if (isDiscussion(suffix)) continue
        if (listedNative) {
          if (forbidsRunning.test(suffix)) continue
          native = true
          eitherOr ||= listedEitherOr
        }
        resolutions.push(...selectors)
        continue
      }
      const known = leadingNames.find(({ expression }) => expression.test(named))
      if (!known || ['glm', 'zhipu', '智谱'].includes(known.name)) continue
      const suffix = named.slice(named.match(known.expression)![0].length)
      if (isDiscussion(suffix)) continue
      resolutions.push(resolveCliName(known.name))
    }
  }
  if (!native && !resolutions.length) return undefined
  const external = aggregate(resolutions)
  if (!external) return { native }
  // DSH or one external CLI is a choice the user has not made yet.
  if (native && eitherOr)
    return {
      native,
      external: {
        status: 'ambiguous',
        candidates: external.status === 'resolved' ? [external.cli] : external.candidates,
      },
    }
  return { native, external }
}

function aggregate(resolutions: readonly CliResolution[]): CliResolution | undefined {
  if (resolutions.length <= 1) return resolutions[0]
  const first = resolutions[0]!
  if (
    first.status === 'resolved' &&
    resolutions.every((result) => result.status === 'resolved' && result.cli === first.cli)
  )
    return first
  return {
    status: 'ambiguous',
    candidates: [
      ...new Set(
        resolutions.flatMap((result) => (result.status === 'resolved' ? [result.cli] : result.candidates)),
      ),
    ],
  }
}

/** The native route when this agent's step scope exposes `subagent`, or how to enable it. */
function nativeHint(available: boolean): string {
  if (!available)
    return `本步用户明确要求由 DeepSeek Harness（DSH）原生子 Agent 执行任务，但当前 Agent 本轮的工具列表中没有原生子 Agent 工具 subagent。如实告知用户：请${ENABLE_SUBAGENT_TOOL}后再试。不要改用 workflow、agent()、subagent_fork、cliworker_start 或任何外部 CLI 代为执行该任务，也不要宣称已经派遣。`
  return '本步用户明确要求由 DeepSeek Harness（DSH）原生子 Agent 执行任务。直接调用 DSH 原生工具 subagent 派遣（PTC 模式下在 run_code 内通过 SDK 调用）：description 写简短的任务说明，prompt 写用户交办的任务及必要上下文。DSH 部分不调用 cliworker_start 或 cliworker_resolve，不进入外部 CLI 选型，也不是已退役的外部 Harness CLI；不猜测模型、强度或会话 ID，遵循宿主的权限与层级检查。宿主拒绝调用（例如超过最大递归深度或并发上限）时原样报告宿主的错误，不宣称子 Agent 已启动，也不改用 workflow、agent()、subagent_fork 或外部 CLI 代替。'
}

const MIXED_HINT =
  '本步用户把任务分别交给 DSH 原生子 Agent 与外部 CLI：两部分各自派遣、各自执行，不合并任务，也不互相替代；外部 CLI 部分只处理明确交办给该 CLI 的任务，某一入口不可用时只说明该部分无法执行。'

function externalUnavailableHint(resolution: CliResolution): string {
  const label = resolution.status === 'resolved' ? CLI_LABELS[resolution.cli] : '外部 CLI'
  return `本步用户还明确要求 ${label} 执行另一项任务，但当前 Agent 本轮看不到 CLI Worker 的派遣入口。如实告知该部分无法执行，不要用 DSH 原生子 Agent、workflow 或 bash 代替它。`
}

function uncertainMixedHint(resolution: CliResolution): string {
  const candidates = (resolution.status === 'resolved' ? [resolution.cli] : resolution.candidates)
    .map((cli) => CLI_LABELS[cli])
  return `本步用户的派遣目标无法确定（DSH 原生子 Agent${candidates.length ? `、${candidates.join('、')}` : ' 与无法识别的外部 CLI'}）。返回简短候选错误，不派遣 DSH 原生子 Agent，也不启动外部 CLI；不猜测或保存设定，不增加询问。`
}

function invocationHint(resolution: CliResolution | undefined): string {
  if (!resolution) return ''
  if (resolution.status === 'resolved' && isGenericWorkBuddyName(resolution.matchedName))
    return '本步用户要求调用 WorkBuddy，尚未指定国内版或国际版。直接调用 cliworker_start，显式传入 cli="workbuddy"、任务标题与任务内容；插件只探测安装，单版本进入对应选型，双版本先用宿主原生询问选择 WorkBuddy CN 或 WorkBuddy（国际版）。不要猜测版本或提前提问；完成模型、强度及角色选型前不启动任务。保留宿主权限检查，不通过 bash 执行。'
  if (resolution.status === 'resolved' && isGenericQoderName(resolution.matchedName))
    return '本步用户要求调用 Qoder，尚未指定国际版或中国版。直接调用 cliworker_start，必须显式传入 cli="qoder"、任务标题与任务内容；插件只探测安装，单版本进入对应选型，双版本先用宿主原生询问选择 Qoder 或 Qoder CN。不要提前猜测版本，不代答插件问题；完成模型、强度及角色选型前不启动任务。保留宿主权限检查，不通过 bash 执行。'
  if (resolution.status === 'resolved')
    return `本步用户提出了明确的外部 CLI 调用，${resolution.match === 'fuzzy' ? '唯一轻微拼写匹配' : '名称映射'}结果为 ${CLI_LABELS[resolution.cli]}（cli=${resolution.cli}）。直接调用 cliworker_start，必须显式传入 cli="${resolution.cli === 'qoder' ? 'qoder国际版' : resolution.cli === 'workbuddy' ? 'WorkBuddy（国际版）' : resolution.cli}"、任务标题与任务内容；不能省略 cli 或照搬历史调用参数。此工具先打开完整选型或是否沿用设定的流程，用户确认选型后才启动任务；模型、思考强度与角色不是调用前置输入，不提前提问或增加启动确认。已有命名智能体续聊仍使用 cliworker_followup。保留宿主权限检查，不代答，不通过 bash 执行。`
  if (resolution.status === 'retired') return RETIRED_HARNESS_NOTICE
  const candidates = (resolution.candidates.length ? resolution.candidates : CLI_IDS)
    .map((cli) => CLI_LABELS[cli])
    .join('、')
  return `本步用户调用的 CLI 无法确定。返回简短候选错误：${candidates}。不启动、不猜测或保存设定，不增加询问。`
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'cliworker-invocation': { kind: 'cliworker-invocation'; form: 'instructions' }
  }
}

/** Add guidance to the accepted batch, which is sent in this very model request. */
export function registerCliRouting(ctx: Context): () => Promise<void> {
  return ctx.effect(
    () =>
      ctx.on(
        'agent/pre-step',
        async ({ agent, signal }, next) => {
          const decision = await next()
          if (decision.kind !== 'enter' || signal.aborted) return decision
          const targets = invocationTargets(decision.messages)
          if (!targets) return decision
          const scope = assembleContextFor(agent).scope
          // Sub-agents never receive native DSH dispatch guidance; their external
          // sibling dispatch keeps its own boundary below.
          const child = agent.session.header.origin === 'subagent'
          const native = targets.native && !child
          const external = targets.external
          const parts: string[] = []
          if (native && external && external.status !== 'resolved') parts.push(uncertainMixedHint(external))
          else {
            if (native) parts.push(nativeHint(!!ctx.tools.get('subagent', scope)))
            const externalVisible = !!ctx.tools.get('cliworker_start', scope)
            // The other half of a mixed request is reported, never silently dropped or rerouted.
            if (native && external && !externalVisible)
              parts.push(externalUnavailableHint(external))
            if (external && externalVisible) {
              let hint = invocationHint(external)
              if (child)
                hint = hint.replace('已有命名智能体续聊仍使用 cliworker_followup。', '') +
                  '你只能通过 cliworker_start 发起同级 Worker，或 cliworker_status 只读查询主对话的 Worker；不能调用其他派遣工具。新 Worker 属于主对话，不继承你的模型、强度、角色、会话 ID 或权限档位；未结束的子 Agent 派遣上限为 6 个。'
              parts.push(hint)
            }
            if (parts.length === 2) parts.unshift(MIXED_HINT)
          }
          const hint = parts.join('\n')
          if (!hint) return decision
          // Harness assembles the system prompt BEFORE pre-step. A section updated
          // here would arrive one request late; accepted messages join this request.
          return {
            ...decision,
            messages: [
              ...decision.messages,
              createUserMessage({
                source: { kind: 'cliworker-invocation', form: 'instructions' },
                content: [{ type: 'text', text: hint }],
              }),
            ],
          }
        },
        { prepend: true },
      ),
    'cliworker:routing',
  )
}
