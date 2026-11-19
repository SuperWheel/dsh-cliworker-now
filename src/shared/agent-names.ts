/**
 * DSH child-name rule shared by Host and Client (REQ-0138 §7).
 * Mirrors `@deepseek-ai/dsh-subagent/names` (`isAgentName`) in dsh-v0.2.2-rc.5:
 * 1–32 lower-case ASCII letters, digits or hyphens, starting with a letter, never `lead`.
 * New names (automatic, custom, rename) use this rule; stored historical names and
 * aliases are only looked up, never re-validated here.
 */

export const DSH_ROOT_AGENT_NAME = 'lead'
export const DSH_AGENT_NAME_MAX = 32
export const DSH_AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u

/** Whether `value` is a name DSH accepts for a new child. */
export function isDshAgentName(value: string): boolean {
  return DSH_AGENT_NAME_PATTERN.test(value) && value !== DSH_ROOT_AGENT_NAME
}

/** The first concrete reason a candidate name is rejected, in user-facing Chinese; undefined when valid. */
export function agentNameProblem(value: string): string | undefined {
  if (value.length === 0) return '名称不能为空'
  if ([...value].length > DSH_AGENT_NAME_MAX) return `名称最多 ${DSH_AGENT_NAME_MAX} 个字符`
  if (/\s/u.test(value)) return '名称不能包含空格'
  if (/[A-Z]/u.test(value)) return '名称不能使用大写字母，请改成小写'
  if (value.includes('_')) return '名称不能包含下划线，可改用连字符（-）'
  if (/[^a-z0-9-]/u.test(value)) return '名称只能使用小写英文字母、数字和连字符（-），不能包含中文或其他符号'
  if (!/^[a-z]/u.test(value)) return '名称必须以小写英文字母开头'
  if (value === DSH_ROOT_AGENT_NAME) return '“lead” 保留给 DSH 主 Agent，请换一个名称'
  return undefined
}

/** Throw the specific reason for an invalid new name; returns the name unchanged when valid. */
export function assertDshAgentName(value: string): string {
  const problem = agentNameProblem(value)
  if (problem) throw new Error(problem)
  return value
}

/** Case-insensitive key used for occupancy so legacy mixed-case aliases still block their lower-case form. */
export const agentNameKey = (name: string): string => name.trim().toLocaleLowerCase()

/** `${stem}-${n}` truncated so the whole name stays within 32 characters and still matches the DSH rule. */
export function numberedAgentName(stem: string, n: number): string {
  const suffix = `-${n}`
  let clean = stem
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^[^a-z]+/u, '')
    .replace(/-+$/u, '')
  if (!clean) clean = 'agent'
  clean = clean.slice(0, DSH_AGENT_NAME_MAX - suffix.length).replace(/-+$/u, '') || 'a'
  return `${clean}${suffix}`
}

/** First free `${stem}-N` (N ≥ 1) not in `taken` (compared with {@link agentNameKey}) nor in `skip`. */
export function firstFreeAgentName(
  stem: string,
  taken: ReadonlySet<string>,
  skip: ReadonlySet<string> = new Set(),
): string {
  for (let n = 1; ; n++) {
    const candidate = numberedAgentName(stem, n)
    if (!taken.has(agentNameKey(candidate)) && !skip.has(agentNameKey(candidate))) return candidate
  }
}
