import { en, type MessageKey } from './i18n-messages.ts'
import { t, uiLanguage } from './i18n.ts'

/**
 * Host messages with variable parts. A `reason`, `parent` or `level` capture is
 * itself Host text and is mapped again; a `duration` capture translates its unit. Paths, counts and
 * other details stay verbatim.
 */
const hostPatterns: [RegExp, MessageKey, ...string[]][] = [
  [/^任务超时：已达到总时限 (\d+ (?:小时|分钟|秒))$/u, '任务超时：已达到总时限 {duration}', 'duration'],
  [/^任务超时：连续 (\d+ (?:小时|分钟|秒))没有收到 CLI 事件（空闲时限）$/u, '任务超时：连续 {duration}没有收到 CLI 事件（空闲时限）', 'duration'],
  [/^(.+) 已关闭，请先在 CLI Worker 设置中开启$/u, '{cli} 已关闭，请先在 CLI Worker 设置中开启', 'cli'],
  [/^正在启动 (.+)…$/u, '正在启动 {cli}…', 'cli'],
  [/^浏览器已打开 (.+) 登录页面。选择账号并授权后会自动完成。$/u, '浏览器已打开 {cli} 登录页面。选择账号并授权后会自动完成。', 'cli'],
  [/^(.+) 首次在此项目文件夹运行，需要你确认是否信任该文件夹，确认后插件会自动退出登录。$/u, '{cli} 首次在此项目文件夹运行，需要你确认是否信任该文件夹，确认后插件会自动退出登录。', 'cli'],
  [/^当前已登录 ([^，。]+)$/u, '当前已登录 {cli}', 'cli'],
  [/^已登录 ([^，。]+)$/u, '已登录 {cli}', 'cli'],
  [/^正在退出 (.+)…$/u, '正在退出 {cli}…', 'cli'],
  [/^已退出 ([^，。]+)$/u, '已退出 {cli}', 'cli'],
  [/^当前未登录 (.+)，无需退出。$/u, '当前未登录 {cli}，无需退出。', 'cli'],
  [/^目标须包含 1–(\d+) 个字符$/u, '目标须包含 1–{limit} 个字符', 'limit'],
  [/^(.+)；已改为排队，等待主目录空闲$/u, '{reason}；已改为排队，等待主目录空闲', 'reason'],
  [/^项目文件数超过隔离副本上限（(\d+) 个）$/u, '项目文件数超过隔离副本上限（{limit} 个）', 'limit'],
  [/^项目文件总大小超过隔离副本上限（(\d+) MiB）$/u, '项目文件总大小超过隔离副本上限（{limit} MiB）', 'limit'],
  [/^无法创建隔离副本：(.+)$/su, '无法创建隔离副本：{detail}', 'detail'],
  [/^合并失败：(.+)$/su, '合并失败：{reason}', 'reason'],
  [/^已附带此前 (\d+) 条记录，省略 (\d+) 条$/u, '已附带此前 {count} 条记录，省略 {omitted} 条', 'count', 'omitted'],
  [/^已附带此前 (\d+) 条记录$/u, '已附带此前 {count} 条记录', 'count'],
  [/^已合并隔离副本：写回 (\d+) 个、删除 (\d+) 个文件（未提交）$/u, '已合并隔离副本：写回 {written} 个、删除 {deleted} 个文件（未提交）', 'written', 'deleted'],
  [/^(\d+) 个文件两边都改过，等待主 Agent 整合，主目录未改动$/u, '{count} 个文件两边都改过，等待主 Agent 整合，主目录未改动', 'count'],
  [/^主目录中的 (.+) 不是目录，已停止合并$/u, '主目录中的 {path} 不是目录，已停止合并', 'path'],
  [/^合并期间主目录中的 (.+) 发生变化，请重新合并$/u, '合并期间主目录中的 {path} 发生变化，请重新合并', 'path'],
  [/^合并写回中途失败，主目录可能已部分更新，可再次合并：(.+)$/su, '合并写回中途失败，主目录可能已部分更新，可再次合并：{detail}', 'detail'],
  [/^(.+。)主对话为(仅可查看|工作区内修改|完全权限)，最高可选([^，。]+)。$/su, '{reason}主对话为{parent}，最高可选{level}。', 'reason', 'parent', 'level'],
]

/**
 * Host text in the interface language when the dictionary knows it; other
 * Host and CLI text stays verbatim rather than guessing a translation.
 */
export function hostText(text: string): string
export function hostText(text: string | undefined): string | undefined
export function hostText(text: string | undefined): string | undefined {
  if (!text) return text
  if (Object.hasOwn(en, text)) return t(text as MessageKey)
  if (uiLanguage() !== 'en') return text
  // Stored run errors may keep an `Error: ` prefix; only a known message drops it.
  const bare = text.replace(/^(?:(?:[A-Za-z_$][\w$]*Error|Error):\s*)+/, '')
  if (bare !== text && Object.hasOwn(en, bare)) return t(bare as MessageKey)
  for (const [pattern, key, ...names] of hostPatterns) {
    const match = pattern.exec(bare)
    if (match)
      return t(key, Object.fromEntries(names.map((name, index) => {
        const captured = match[index + 1]!
        if (name === 'duration') {
          const [, count, unit] = /^(\d+) (小时|分钟|秒)$/u.exec(captured)!
          const key = unit === '小时' ? '{count} 小时' : unit === '分钟' ? '{count} 分钟' : '{count} 秒'
          return [name, t(key, { count: count! })]
        }
        return [name, ['reason', 'parent', 'level'].includes(name) ? hostText(captured) : captured]
      })))
  }
  return text
}

/** Keep transport traces out of the conversation and selection options. */
export function operationMessage(error: unknown): string {
  const text = String(error)
  if (/HTTP 404/.test(text)) return t('插件服务尚未更新，请重启 DeepSeek Harness 后重试。现有记录不会丢失。')
  if (/transport failure|Failed to fetch|NetworkError/.test(text)) return t('暂时无法连接插件服务，请稍后重试。')
  return hostText(
    text
      .replace(/^.*cliworker\/unavailable[^:]*:\s*/, '')
      .replace(/^(?:(?:[A-Za-z_$][\w$]*Error|Error):\s*)+/, ''),
  )
}
