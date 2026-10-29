import type { CliId } from './types.ts'

/**
 * Sign-in pages each CLI's own login prints, the only addresses a login window
 * may open. `.example.com` also allows subdomains. Checked by Host and Client.
 */
export const ACCOUNT_LOGIN_HOSTS: Partial<Record<CliId, readonly string[]>> = {
  antigravity: ['accounts.google.com'],
  codex: ['auth.openai.com'],
  claude: ['claude.com', 'claude.ai'],
  qoder: ['qoder.com'],
  qodercn: ['qoder.cn'],
  grok: ['accounts.x.ai', 'auth.x.ai'],
  zcode: ['.bigmodel.cn', '.z.ai'],
  mimo: ['platform.xiaomimimo.com'],
  // Hosts seen in Pi 1.0.4 provider logins (2026-10-27).
  pi: ['claude.ai', 'auth.openai.com', 'github.com', 'www.kimi.com', 'openrouter.ai', 'accounts.x.ai'],
  // Hosts seen in OMP 16.4.4 /login screens (2026-10-27).
  omp: ['claude.ai', 'auth.openai.com', 'www.kimi.com', 'github.com'],
  // Device pages of `kimi login --region mainland-cn|global` (Kimi Code 2.3.3, 2026-10-27).
  kimi: ['www.kimi.com', 'www.kimi.ai'],
  // OpenCode 1.19.0 ChatGPT browser login (Windows ConPTY, 2026-10-29).
  opencode: ['auth.openai.com'],
  // Hermes `auth add nous` device page (2026-10-29).
  hermes: ['portal.nousresearch.com'],
}

/** An https address on one of `hosts`, without user info; trailing punctuation is not part of it. */
export function allowedLink(value: string | undefined, hosts: readonly string[] | undefined): string | undefined {
  if (!value || !hosts?.length) return undefined
  try {
    const url = new URL(value.replace(/[.,;:)\]]+$/, ''))
    const host = url.hostname.toLowerCase()
    const ok = hosts.some((item) => (item.startsWith('.') ? host.endsWith(item) || host === item.slice(1) : host === item))
    return url.protocol === 'https:' && ok && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}

/** CLIs whose login and logout the plugin draws (Host flows); others keep their native terminal. */
export const GUIDED_ACCOUNT_CLIS: ReadonlySet<CliId> = new Set<CliId>(['antigravity', 'codex', 'claude', 'qoder', 'qodercn', 'grok', 'zcode', 'mimo'])
/** CLIs that hold one account at a time; signing in again means switching accounts. */
export const SINGLE_ACCOUNT_CLIS: ReadonlySet<CliId> = new Set<CliId>([
  'antigravity',
  'codex',
  'claude',
  'qoder',
  'qodercn',
  'mimo',
  'grok',
])
/** CLIs that keep several provider logins; one 「账号」 window lists, adds and signs out each. */
export const MULTI_ACCOUNT_CLIS: ReadonlySet<CliId> = new Set<CliId>(['opencode', 'pi', 'kimi', 'zcode', 'hermes', 'omp'])

/** Provider ids and credential entry ids are plain native names; never a key, URL or path. */
export const ACCOUNT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
/** `cli:provider[:entry]`, the Host handle of one removable login (`AccountLogin.id`). */
export function accountLoginId(cli: CliId, provider: string, entry?: string): string | undefined {
  if (!ACCOUNT_NAME.test(provider) || (entry !== undefined && !ACCOUNT_NAME.test(entry))) return undefined
  return entry === undefined ? `${cli}:${provider}` : `${cli}:${provider}:${entry}`
}
export function parseAccountLoginId(id: string): { cli: string; provider: string; entry?: string } | undefined {
  const [cli, provider, entry, ...rest] = id.split(':')
  if (!cli || !provider || rest.length || !ACCOUNT_NAME.test(provider) || (entry !== undefined && !ACCOUNT_NAME.test(entry)))
    return undefined
  return { cli, provider, ...(entry === undefined ? {} : { entry }) }
}
