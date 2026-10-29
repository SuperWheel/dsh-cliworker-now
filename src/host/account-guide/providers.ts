import type { AccountLogin, AccountProvider } from '../../shared/accounts.ts'
import { parseAccountLoginId } from '../../shared/account-links.ts'
import type { CliId } from '../../shared/types.ts'

/*
 * 「登录到」 targets the plugin can open directly. Ids are checked against the
 * installed CLIs (2026-10-27): OpenCode 1.19.0 models.dev catalog ids for
 * `auth login -p`, Hermes `auth add` "Known providers", Pi 1.0.4
 * `getLoginProviderOptions()`, OMP 16.4.4 `/login <id>` registry ids and Kimi
 * `login --region`. Anything else is chosen in the native terminal.
 */
type Entry = Omit<AccountProvider, 'signedIn'> & {
  /** The provider the CLI files this login under, when it differs from the id. */
  stores?: string
}

const OPENCODE: Entry[] = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'xai', label: 'xAI' },
  { id: 'zhipuai', label: '智谱 AI' },
  { id: 'zhipuai-coding-plan', label: '智谱 Coding Plan' },
  { id: 'zai', label: 'Z.AI' },
  { id: 'zai-coding-plan', label: 'Z.AI Coding Plan' },
  { id: 'moonshotai-cn', label: '月之暗面（中国）' },
  { id: 'moonshotai', label: 'Moonshot AI' },
  { id: 'minimax-cn', label: 'MiniMax（中国）' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'alibaba-cn', label: '阿里云百炼（中国）' },
  { id: 'alibaba', label: 'Alibaba Cloud' },
  { id: 'siliconflow', label: 'SiliconFlow' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'groq', label: 'Groq' },
]

const HERMES: Entry[] = [
  { id: 'nous', label: 'Nous' },
  { id: 'openrouter', label: 'OpenRouter', multi: true },
  { id: 'deepseek', label: 'DeepSeek', multi: true },
  { id: 'anthropic', label: 'Anthropic', multi: true },
  { id: 'openai-api', label: 'OpenAI', multi: true },
  { id: 'gemini', label: 'Google Gemini', multi: true },
  { id: 'xai', label: 'xAI', multi: true },
  { id: 'zai', label: 'Z.AI', multi: true },
  { id: 'kimi-coding-cn', label: 'Kimi Coding（中国）', multi: true },
  { id: 'kimi-coding', label: 'Kimi Coding', multi: true },
  { id: 'minimax-cn', label: 'MiniMax（中国）', multi: true },
  { id: 'minimax', label: 'MiniMax', multi: true },
  { id: 'xiaomi', label: '小米 MiMo', multi: true },
  { id: 'huggingface', label: 'Hugging Face', multi: true },
]

const ZCODE: Entry[] = [
  { id: 'bigmodel', label: '中国智谱 BigModel' },
  { id: 'zai', label: '海外 Z.AI' },
]

// Pi: one stored credential per provider and account location.
const PI: Entry[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-codex', label: 'OpenAI Codex（旧版）' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'kimi-coding', label: 'Kimi For Coding' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'xai', label: 'xAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'moonshotai-cn', label: '月之暗面（中国）' },
  { id: 'moonshotai', label: 'Moonshot AI' },
  { id: 'zai', label: 'Z.AI' },
  { id: 'zai-coding-cn', label: 'Z.AI Coding（中国）' },
  { id: 'minimax-cn', label: 'MiniMax（中国）' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'xiaomi', label: '小米 MiMo' },
  { id: 'google', label: 'Google' },
]

// OMP keeps several credentials of one provider; the device login is filed as openai-codex.
const OMP: Entry[] = [
  { id: 'anthropic', label: 'Anthropic（Claude Pro/Max）', multi: true },
  { id: 'openai-codex', label: 'ChatGPT Plus/Pro（Codex）', multi: true },
  { id: 'openai-codex-device', label: 'ChatGPT Plus/Pro（Codex，设备码）', multi: true, stores: 'openai-codex' },
  { id: 'kimi-code', label: 'Kimi Code', multi: true },
  { id: 'github-copilot', label: 'GitHub Copilot', multi: true },
  { id: 'openrouter', label: 'OpenRouter', multi: true },
  { id: 'deepseek', label: 'DeepSeek', multi: true },
  { id: 'moonshot', label: 'Moonshot（Kimi API）', multi: true },
  { id: 'minimax-code-cn', label: 'MiniMax Token Plan（中国）', multi: true },
  { id: 'minimax-code', label: 'MiniMax Token Plan', multi: true },
]

const KIMI: Entry[] = [
  { id: 'kimi-code-cn', label: 'Kimi Code（kimi.com）', stores: 'kimi-code' },
  { id: 'kimi-code-global', label: 'Kimi Code（kimi.ai）', stores: 'kimi-code' },
]

const TABLES: Partial<Record<CliId, Entry[]>> = { opencode: OPENCODE, hermes: HERMES, zcode: ZCODE, pi: PI, omp: OMP, kimi: KIMI }

/** The providers a login window may sign in to directly, marked when a removable login already holds one. */
export function loginProviders(cli: CliId, logins: AccountLogin[] | undefined): AccountProvider[] | undefined {
  const table = TABLES[cli]
  if (!table) return undefined
  const held = new Set(
    (logins ?? []).flatMap((login) => {
      const parsed = login.id ? parseAccountLoginId(login.id) : undefined
      return parsed?.cli === cli ? [parsed.provider] : []
    }),
  )
  return table.map(({ stores, ...entry }) => (held.has(stores ?? entry.id) ? { ...entry, signedIn: true } : entry))
}

export function isLoginProvider(cli: CliId, provider: string): boolean {
  return !!TABLES[cli]?.some((entry) => entry.id === provider)
}

/** The provider a login of this id is filed under. */
export function providerStores(cli: CliId, provider: string): string | undefined {
  return TABLES[cli]?.find((entry) => entry.id === provider)?.stores
}
