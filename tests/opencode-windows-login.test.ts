import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FlowGuide, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { OPENCODE_FLOW } from '../src/host/account-guide/multi-account.ts'
import { openCodeAuthDirectory, openCodeEnvironment } from '../src/host/opencode-adapter.ts'
import { openCodeNativePaths, readOpenCodeProfile } from '../src/host/opencode-native.ts'
import { prepareOpenCodeAccount, readOpenCodeAccount } from '../src/host/harness-opencode-accounts.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'

// 模拟：OpenCode 1.19.0 Windows ConPTY 实采画面，2026-10-29；标题路径已删除。
// OAuth URL、验证码、凭据全部为模拟值，不包含实采授权 URL 或真实账号。
const METHOD = '\x1b[0m\r\n\x1b[90m┌\x1b[39m  Add credential\r\n\x1b[3;1H\r\n\x1b[3;1H\x1b[?25l\x1b[90m│\x1b[39m\r\n\x1b[36m◆\x1b[39m  Login method\r\n\x1b[36m│\x1b[39m  \x1b[32m●\x1b[39m ChatGPT Pro/Plus (browser)\r\n\x1b[36m│\x1b[39m  \x1b[2m○\x1b[22m \x1b[2mChatGPT Pro/Plus (headless)\x1b[22m\r\n\x1b[36m│\x1b[39m  \x1b[2m○\x1b[22m \x1b[2mManually enter API Key\x1b[22m\r\n\x1b[36m└\x1b[39m\r\n'
const KEY = '\x1b[999D\x1b[6A\x1b[1B\x1b[J\x1b[32m◇\x1b[39m  Login method\r\n\x1b[90m│\x1b[39m  \x1b[2mManually enter API Key\x1b[22m\r\n\x1b[?25h\x1b[6;1H\r\n\x1b[6;1H\x1b[?25l\x1b[90m│\x1b[39m\r\n\x1b[36m◆\x1b[39m  Enter your API key\r\n\x1b[36m│\x1b[39m  \x1b[7m\x1b[8m_\x1b[28m\x1b[27m\r\n\x1b[36m└\x1b[39m\r\n'
const guides = (events: GuideEvent[]) => events.flatMap((event) => 'guide' in event ? [event.guide] : [])
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cwn-opencode-windows-simulated-'))
  roots.push(root)
  for (const name of ['HOME', 'USERPROFILE']) vi.stubEnv(name, join(root, 'home'))
  for (const name of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OPENCODE_MODELS_PATH']) vi.stubEnv(name, '')
  const config = { ...DEFAULT_CONFIG, stateDirectory: join(root, 'plugin') }
  return { root, config, native: join(root, 'home/.local/share'), managed: openCodeAuthDirectory(config.stateDirectory) }
}
function auth(data: string, providers: string[]) {
  mkdirSync(join(data, 'opencode'), { recursive: true, mode: 0o700 })
  writeFileSync(join(data, 'opencode/auth.json'), JSON.stringify(Object.fromEntries(providers.map((id) => [id, { type: 'api', key: 'SIMULATED-KEY' }]))), { mode: 0o600 })
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('OpenCode Windows 登录（模拟脱敏实采画面）', () => {
  it.each([
    ['browser', '\r', undefined],
    ['device', '\x1b[B', true],
    ['api-key', '\x1b[B\x1b[B', true],
  ] as const)('offers the native method choice and only sends the chosen %s keys', (option, write, enter) => {
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'openai' })
    const events = guide.output(METHOD)
    expect(guides(events).at(-1)).toMatchObject({ step: 'openai-method', template: 'choice' })
    expect(events.some((event) => 'write' in event)).toBe(false)
    expect(guide.respond({ option })).toEqual([{ write, enter }])
    if (option === 'api-key') {
      expect(guides(guide.output(KEY)).at(-1)).toMatchObject({ step: 'key', template: 'secret' })
      expect(guide.respond({ secret: 'SIMULATED-KEY' })).toContainEqual({ confirm: 'login' })
    }
  })
  it('shows the browser link and watches account evidence without claiming login from the URL', () => {
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'openai' })
    guide.output(METHOD)
    guide.respond({ option: 'browser' })
    const events = guide.output('◇  Login method\r\n│  ChatGPT Pro/Plus (browser)\r\n●  Go to: https://auth.openai.com/oauth/authorize?state=SIMULATED\r\n●  Complete authorization in your browser. This window will close automatically.\r\n')
    expect(guides(events).at(-1)).toMatchObject({ step: 'browser', template: 'browser', link: 'https://auth.openai.com/oauth/authorize?state=SIMULATED' })
    expect(events).toContainEqual({ watch: 'login' })
    expect(guide.proves('login', { state: 'unconfigured' }, { state: 'unconfigured' }, 0)).toBe(false)
    expect(guide.proves('login', { state: 'unconfigured' }, { state: 'authenticated', logins: [{ id: 'opencode:openai', providerLabel: 'OpenAI', authMethod: 'oauth' }] }, 0)).toBe(true)
  })
  it('handles a simulated device code and never admits an unrelated link', () => {
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'openai' })
    const events = guide.output('Go to: https://auth.openai.com/codex/device\r\nEnter code: ABCD-1234\r\nWaiting for authorization...')
    expect(guides(events).at(-1)).toMatchObject({ template: 'deviceCode', code: 'ABCD-1234' })
    const other = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'openai' })
    expect(guides(other.output('Go to: https://untrusted.invalid/oauth\r\n'))).toEqual([])
  })
  it('supports direct API-key providers and confirms typed input only after Enter', () => {
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'deepseek' })
    expect(guides(guide.output('┌  Add credential\r\n│\r\n◆  Enter your API key\r\n│  _\r\n└\r\n')).at(-1)).toMatchObject({ template: 'secret' })
    expect(guide.input('SIMULATED')).toEqual([])
    expect(guide.input('\r')).toContainEqual({ confirm: 'login' })
  })
  it('hands unknown methods and native errors to the terminal instead of waiting forever', () => {
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'other' })
    expect(guides(guide.output('Add credential\r\nLogin method\r\n● New native method\r\n└')).at(-1)).toMatchObject({ template: 'native' })
    expect(guides(guide.output('Failed to authorize')).at(-1)).toMatchObject({ template: 'native', tone: 'warning' })
  })
})

describe('OpenCode Windows 目录与刷新（模拟凭据）', () => {
  it('uses XDG on Windows-compatible layouts, with .local/share as fallback, not LOCALAPPDATA', async () => {
    const f = fixture()
    vi.stubEnv('LOCALAPPDATA', join(f.root, 'unrelated-localappdata'))
    expect(openCodeNativePaths().data).toBe(f.native)
    const data = join(f.root, 'xdg-data'), cache = join(f.root, 'xdg-cache')
    vi.stubEnv('XDG_DATA_HOME', data)
    vi.stubEnv('XDG_CACHE_HOME', cache)
    auth(data, ['openai'])
    mkdirSync(join(cache, 'opencode'), { recursive: true })
    writeFileSync(join(cache, 'opencode/models.json'), '{"openai":{"name":"OpenAI","models":{}}}')
    const profile = await readOpenCodeProfile(f.managed)
    expect(profile.removableAuth.openai).toBe(data)
    expect(profile.modelsPath).toBe(join(cache, 'opencode/models.json'))
    expect(profile.catalog).toHaveProperty('openai')
    const env = await openCodeEnvironment(join(f.root, 'runtime'), {}, f.managed)
    expect(env.OPENCODE_MODELS_PATH).toBe(profile.modelsPath)
  })
  it('rereads provider rows after native writes and routes one logout to its original store', async () => {
    const f = fixture(), signal = new AbortController().signal
    auth(f.native, ['openai'])
    auth(f.managed, ['deepseek'])
    expect((await readOpenCodeAccount(f.config, signal)).logins?.map((row) => row.id).sort()).toEqual(['opencode:deepseek', 'opencode:openai'])
    const logout = await prepareOpenCodeAccount('/SIMULATED/opencode.cmd', 'logout', f.config, signal, { login: 'opencode:openai' })
    try {
      expect(logout.argv.slice(-3)).toEqual(['auth', 'logout', 'openai'])
      expect(logout.env.XDG_DATA_HOME).toBe(f.native)
      expect(logout.env.XDG_CONFIG_HOME).toContain(logout.cwd)
      // 模拟 native auth logout 的单行删除；不能把终端成功文字作为验收。
      auth(f.native, [])
      expect((await readOpenCodeAccount(f.config, signal)).logins?.map((row) => row.id)).toEqual(['opencode:deepseek'])
      expect(readFileSync(join(f.managed, 'opencode/auth.json'), 'utf8')).toContain('deepseek')
    } finally { logout.cleanup() }
    const login = await prepareOpenCodeAccount('/SIMULATED/opencode.cmd', 'login', f.config, signal, { provider: 'deepseek' })
    try {
      expect(login.argv.slice(-4)).toEqual(['auth', 'login', '-p', 'deepseek'])
      expect(login.env.XDG_DATA_HOME).toBe(f.managed)
      auth(f.managed, ['deepseek', 'openai'])
      expect((await readOpenCodeAccount(f.config, signal)).logins).toHaveLength(2)
    } finally { login.cleanup() }
  })
  it('preserves login identities but rejects misleading single logout for duplicate stores or config credentials', async () => {
    const f = fixture(), signal = new AbortController().signal
    auth(f.native, ['openai'])
    auth(f.managed, ['openai', 'deepseek'])
    const config = join(f.root, 'home/.config/opencode')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'opencode.json'), '{"provider":{"deepseek":{"options":{"apiKey":"SIMULATED-CONFIG-KEY"}}}}')
    const state = await readOpenCodeAccount(f.config, signal)
    expect(state.state).toBe('authenticated')
    expect(state.logins).toHaveLength(2)
    expect(state.logins?.map((row) => row.id).sort()).toEqual(['opencode:deepseek', 'opencode:openai'])
    expect(JSON.stringify(state)).not.toContain('SIMULATED')
    for (const provider of ['openai', 'deepseek'])
      await expect(prepareOpenCodeAccount('/SIMULATED/opencode', 'logout', f.config, signal, { login: `opencode:${provider}` })).rejects.toThrow('多处凭据或配置凭据')
  })
})
