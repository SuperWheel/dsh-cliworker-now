import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowGuide, GuideResponseError, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { PI_FLOW } from '../src/host/account-guide/pi-flow.ts'
import { preparePiOmpAccountTerminal } from '../src/host/pi-omp-accounts.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'

// 模拟画面：标记来自 2026-10-27 隔离 HOME 中 Pi 1.0.4 的真实 PTY 探测。
// 地址参数、授权码、API Key 和账号文件均为模拟数据；不读取真实账号、不发起授权。
const guides = (events: GuideEvent[]) => events.flatMap((event) => 'guide' in event ? [event.guide] : [])
const flow = (provider = 'anthropic') => new FlowGuide(PI_FLOW, { action: 'login', provider })
const menu = (name: string, account = 'Sign in with an account') =>
  `Select authentication method for ${name}:\r\n→ ${account}\r\n  Sign in with an API key\r\n↑↓ navigate enter select escape/ctrl+c cancel`
const methods = (name: string, second: 'Copy' | 'Device') =>
  `Select ${name} login method:\r\n→ Browser login (default)\r\n  ${second} code login (headless)\r\n↑↓ navigate enter select escape/ctrl+c cancel`
const keyScreen = (name: string) => `Login to ${name}\r\nEnter ${name} API key\r\n>\r\n(escape/ctrl+c to cancel, enter to submit)`
const browserPrompt = 'Complete login in your browser, or paste the authorization code / redirect URL here:'
const device = (url: string, code = 'SYNT-HETIC') => `${url}\r\nEnter code: ${code}\r\nWaiting for authentication...`

describe('Pi 1.1.0 Windows ConPTY（实采脱敏后的模拟画面）', () => {
  it('uses the full OSC hyperlink, preserving the OAuth state and PKCE parameters across terminal chunks', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/pi-windows-login-simulated.json', import.meta.url), 'utf8'))
    expect(fixture.simulation).toBe(true)
    for (const chunkSize of [1, 17, fixture.raw.length]) {
      const guide = flow('openai')
      const events: GuideEvent[] = []
      for (let offset = 0; offset < fixture.raw.length; offset += chunkSize)
        events.push(...guide.output(fixture.raw.slice(offset, offset + chunkSize)))
      const browser = guides(events).at(-1)!
      expect(browser).toMatchObject({ step: 'browser-code', template: 'browserCode' })
      const url = new URL(browser.link!)
      expect([...url.searchParams.keys()]).toEqual([
        'client_id', 'agent_name_hint', 'ext_agent_host_id', 'response_type', 'redirect_uri',
        'resource', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'nonce',
      ])
      expect(url.searchParams.get('state')).toBe('x'.repeat(43))
      expect(url.searchParams.get('code_challenge')).toBe('x'.repeat(43))
      expect(url.searchParams.get('nonce')).toBe('x'.repeat(43))
      expect(events).toContainEqual({ watch: 'login' })
      expect(events.some((event) => 'confirm' in event || 'write' in event)).toBe(false)
    }
  })

  it('answers the selected provider with native Down then CR, and recognizes its cursor-positioned API key prompt', () => {
    const guide = flow('openai')
    // 原始 Windows 输出使用 H/K 定位和清行，而非用换行分隔每行。
    guide.output('\x1b[?2004h\x1b[52;1H\x1b[2KSelect authentication method for OpenAI:' +
      '\x1b[54;1H\x1b[2K→ Sign in with ChatGPT\x1b[55;1H\x1b[2K  Sign in with an API key')
    expect(guide.respond({ option: 'api-key' })).toEqual([{ write: '\x1b[B', enter: true }])
    const events = guide.output('\x1b[53;1H\x1b[2KLogin to OpenAI\x1b[55;1H\x1b[2KEnter OpenAI API key' +
      '\x1b[56;1H\x1b[2K> \x1b[57;1H\x1b[2K(escape/ctrl+c to cancel, enter to submit)')
    expect(guides(events).at(-1)?.template).toBe('secret')
    expect(events.some((event) => 'write' in event || 'confirm' in event)).toBe(false)
  })
})

describe('Pi 1.0.4 账号窗口（模拟画面）', () => {
  it.each([
    ['anthropic', 'Anthropic', 'Sign in with an account'],
    ['openai', 'OpenAI', 'Sign in with ChatGPT'],
    ['github-copilot', 'GitHub Copilot', 'Sign in with an account'],
    ['kimi-coding', 'Kimi For Coding', 'Sign in with Kimi Code'],
    ['openrouter', 'OpenRouter', 'Sign in with OpenRouter'],
    ['xai', 'xAI', 'Sign in with SuperGrok or X Premium'],
  ])('%s 只在原生两种认证方式均显示时提供选择', (provider, name, account) => {
    const guide = flow(provider)
    expect(guide.output(`Select authentication method for ${name}:\r\n→ ${account}`)).toEqual([])
    const events = guide.output('\r\nSign in with an API key')
    expect(guides(events)[0]).toMatchObject({ template: 'choice', options: [
      { id: 'account', label: '使用账号登录' }, { id: 'api-key', label: '使用 API Key' },
    ] })
    expect(events.every((event) => 'guide' in event)).toBe(true)
    expect(() => guide.respond({ secret: 'synthetic-key' })).toThrow(GuideResponseError)
    expect(guide.respond({ option: 'account' })).toEqual([{ write: '\r', enter: undefined }])
    expect(() => guide.respond({ option: 'account' })).toThrow(GuideResponseError)
    const api = flow(provider)
    api.output(menu(name, account))
    expect(api.respond({ option: 'api-key' })).toEqual([{ write: '\x1b[B', enter: true }])
    expect(guides(api.output(keyScreen(name)))[0]).toMatchObject({ step: 'key', template: 'secret' })
    expect(() => api.respond({ option: 'account' })).toThrow(GuideResponseError)
  })

  it.each(['browser', 'copy'] as const)('Anthropic 从认证菜单推进至 %s，再接受授权码', (option) => {
    const guide = flow()
    guide.output(menu('Anthropic'))
    guide.respond({ option: 'account' })
    expect(guides(guide.output(methods('Anthropic', 'Copy')))[0]?.options?.map((item) => item.id)).toEqual(['browser', 'copy'])
    expect(() => guide.respond({ option: 'device' })).toThrow(GuideResponseError)
    expect(guide.respond({ option })).toEqual([option === 'browser' ? { write: '\r', enter: undefined } : { write: '\x1b[B', enter: true }])
    const prompt = option === 'copy' ? 'Paste the code Anthropic shows after you sign in:' : browserPrompt
    const events = guide.output(`\x1b[?2004hhttps://claude.ai/oauth/authorize?state=synthetic\r\n${prompt}`)
    expect(guides(events)[0]).toMatchObject({ template: 'browserCode', link: 'https://claude.ai/oauth/authorize?state=synthetic' })
    expect(() => guide.respond({ option })).toThrow(GuideResponseError)
    const answer = guide.respond({ code: ' synthetic-code#synthetic-state ' })
    expect(answer[0]).toEqual({ write: '\x1b[200~synthetic-code#synthetic-state\x1b[201~', enter: true })
    expect(answer.at(-1)).toEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(answer))).not.toContain('synthetic-code')
    expect(() => guide.respond({ code: 'again' })).toThrow(GuideResponseError)
  })

  it.each(['browser', 'device'] as const)('Codex legacy 方法子菜单只提供 browser/device：%s', (option) => {
    const guide = flow('openai-codex')
    expect(guides(guide.output(methods('OpenAI Codex', 'Device')))[0]?.options?.map((item) => item.id)).toEqual(['browser', 'device'])
    expect(() => guide.respond({ option: 'copy' })).toThrow(GuideResponseError)
    expect(guide.respond({ option })).toEqual([option === 'browser' ? { write: '\r', enter: undefined } : { write: '\x1b[B', enter: true }])
    const next = option === 'browser'
      ? `https://auth.openai.com/oauth/authorize?state=synthetic\r\n${browserPrompt}`
      : device('https://auth.openai.com/codex/device')
    expect(guides(guide.output(next))[0]?.template).toBe(option === 'browser' ? 'browserCode' : 'deviceCode')
  })

  it.each([
    ['openai', 'OpenAI', 'Sign in with ChatGPT', 'https://auth.openai.com/api/accounts/authorize?state=synthetic', 'Complete login in your browser, or paste the final redirect URL here:'],
    ['openrouter', 'OpenRouter', 'Sign in with OpenRouter', 'https://openrouter.ai/auth?state=synthetic', 'Complete sign-in in your browser, or paste the authorization code / redirect URL here:'],
  ])('%s 从认证方式直接进入浏览器加粘贴页面', (provider, name, account, url, prompt) => {
    const guide = flow(provider)
    guide.output(menu(name, account))
    guide.respond({ option: 'account' })
    expect(guides(guide.output(`${url}\r\n${prompt}`))[0]).toMatchObject({ template: 'browserCode', link: url })
    expect(guide.respond({ code: 'http://localhost:1455/auth/callback?code=synthetic' })[0]).toEqual({
      write: 'http://localhost:1455/auth/callback?code=synthetic', enter: true,
    })
  })

  it('Copilot 企业域名步骤只允许 github.com 的空回车', () => {
    const guide = flow('github-copilot')
    guide.output(menu('GitHub Copilot'))
    guide.respond({ option: 'account' })
    const shown = guides(guide.output('GitHub Enterprise URL/domain (blank for github.com)\r\ne.g., company.ghe.com\r\n>'))[0]
    expect(shown).toMatchObject({ template: 'choice', options: [{ id: 'github.com', label: 'github.com' }] })
    expect(() => guide.respond({ code: 'company.ghe.com' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ option: 'enterprise' })).toThrow(GuideResponseError)
    expect(guide.respond({ option: 'github.com' })).toEqual([{ write: '\r', enter: undefined }])
    expect(guides(guide.output(device('https://github.com/login/device', 'SYNT-HETC')))[0]).toMatchObject({
      template: 'deviceCode', code: 'SYNT-HETC', link: 'https://github.com/login/device',
    })
  })

  it.each([
    ['kimi-coding', 'Kimi For Coding', 'Sign in with Kimi Code', 'https://www.kimi.com/code/device'],
    ['xai', 'xAI', 'Sign in with SuperGrok or X Premium', 'https://accounts.x.ai/device'],
  ])('%s 从认证方式进入设备码页面，不接收粘贴回应', (provider, name, account, url) => {
    const guide = flow(provider)
    guide.output(menu(name, account))
    guide.respond({ option: 'account' })
    expect(guides(guide.output(device(url)))[0]).toMatchObject({ template: 'deviceCode', code: 'SYNT-HETIC', link: url })
    expect(() => guide.respond({ code: 'synthetic' })).toThrow(GuideResponseError)
    expect(guide.exited().at(-1)).toEqual({ confirm: 'login' })
  })

  it.each([false, true])('纯 API Key 服务商直接进入 secret，输入及回显不进入任何 guide（括号粘贴 %s）', (bracketed) => {
    const guide = flow('deepseek')
    const secret = 'SYNTHETIC_SECRET_NOT_A_CREDENTIAL'
    const events = guide.output((bracketed ? '\x1b[?2004h' : '') + keyScreen('DeepSeek'))
    expect(guides(events)[0]).toMatchObject({ step: 'key', template: 'secret' })
    for (const response of [{ code: secret }, { option: 'api-key' }, { secret: 'a\r\nb' }, { secret: '' }, { secret: 'x\x1b[201~' }])
      expect(() => guide.respond(response)).toThrow(GuideResponseError)
    const submitted = guide.respond({ secret: ` ${secret} ` })
    expect(submitted[0]).toEqual({ write: bracketed ? `\x1b[200~${secret}\x1b[201~` : secret, enter: true })
    expect(submitted.at(-1)).toEqual({ confirm: 'login' })
    const echo = `\r\n> ${secret}\r\nSaved API key for DeepSeek`
    events.push(...submitted, ...guide.output(echo), ...guide.unconfirmed('login'), ...guide.output(keyScreen('DeepSeek') + echo))
    expect(JSON.stringify(guides(events))).not.toContain(secret)
    expect(guides(events).some((item) => item.template === 'result' && item.tone === 'success')).toBe(false)
  })

  it('原生输入只有实际值加回车才请求确认，成功文字不作为证据', () => {
    const guide = flow('deepseek')
    guide.output(keyScreen('DeepSeek'))
    expect(guide.input('\r')).toEqual([])
    expect(guide.input('synthetic')).toEqual([])
    expect(guide.input('\r').at(-1)).toEqual({ confirm: 'login' })
    expect(guide.output('Saved API key for DeepSeek')).toEqual([])
  })

  it('链接只接受精确白名单主机的 HTTPS，支持 OSC 8 与分片输出', () => {
    expect(PI_FLOW.links).toEqual(['claude.ai', 'auth.openai.com', 'github.com', 'www.kimi.com', 'openrouter.ai', 'accounts.x.ai'])
    for (const host of PI_FLOW.links!) {
      const guide = flow()
      guide.output(`\x1b]8;;https://${host}/authorize?state=`)
      expect(guides(guide.output(`synthetic\x07打开\x1b]8;;\x07\r\n${browserPrompt}`))[0]?.link).toBe(`https://${host}/authorize?state=synthetic`)
    }
    for (const url of ['https://evil.example/login', 'https://auth.openai.com.evil.example/', 'https://evil.auth.openai.com/', 'https://user:pass@github.com/', 'http://claude.ai/', 'http://localhost:1455/callback']) {
      expect(guides(flow().output(`${url}\r\n${browserPrompt}`))[0]?.link).toBeUndefined()
      const shown = guides(flow().output(device(url)))[0]
      expect(shown?.link).toBeUndefined()
      expect(shown?.code).toBe('SYNT-HETIC')
    }
  })

  it('设备码只从 Enter code 标记提取，并拒绝不合法及过长的值', () => {
    expect(flow().output('https://github.com/login/device\r\nSYNT-HETC\r\nWaiting for authentication...')).toEqual([])
    for (const code of ['../../secret', 'ABC_DEF', 'ABCD-EFGH-EXTRA', 'A'.repeat(30), 'https://evil.example']) {
      const guide = flow()
      expect(guide.output(device('https://github.com/login/device', code))).toEqual([])
      expect(guides(guide.settled())[0]?.template).toBe('native')
    }
    expect(guides(flow().output('Enter\r\n code: SYNT-HETIC\r\nWaiting for authentication...'))[0]?.code).toBe('SYNT-HETIC')
  })

  it('未知画面交回原生终端，不生成不存在的选项', () => {
    const guide = flow()
    expect(guide.output('Select authentication method for Future:\r\nSign in with magic')).toEqual([])
    expect(() => guide.respond({ option: 'account' })).toThrow(GuideResponseError)
    expect(guides(guide.settled())[0]?.template).toBe('native')
  })

  it('登录仅由目标服务商的状态证明；单条退出等进程结束并核对目标', () => {
    const row = (id: string) => ({ id, providerLabel: '模拟服务商', authMethod: 'api' as const })
    const guide = flow('deepseek')
    const before = { state: 'authenticated' as const, logins: [row('pi:openai:native')] }
    expect(guide.proves('login', before, before, 0)).toBe(false)
    const after = { ...before, logins: [...before.logins, row('pi:deepseek:plugin')] }
    expect(guide.proves('login', before, after)).toBe(true)
    expect(guide.proves('login', after, after)).toBe(false)
    expect(guide.proves('login', after, after, 1)).toBe(false)
    expect(guide.proves('login', after, after, 0)).toBe(true)
    const logout = new FlowGuide(PI_FLOW, { action: 'logout', login: 'pi:deepseek:plugin' })
    expect(logout.output('已移除该服务商的凭据。')).toEqual([])
    expect(logout.exited().at(-1)).toEqual({ confirm: 'logout' })
    expect(logout.proves('logout', after, after)).toBe(false)
    expect(logout.proves('logout', after, before)).toBe(true)
    expect(logout.proves('logout', after, { state: 'unknown' })).toBe(false)
  })
})

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Pi 账号启动 argv（隔离模拟目录，无 CLI 执行）', () => {
  it.each(['native', 'plugin'] as const)('预选登录和 %s 单条退出传递精确尾部参数', async (source) => {
    const root = await mkdtemp(join(tmpdir(), 'cwn-pi-window-fixture-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project)
    const input = {
      cli: 'pi' as const, executable: '/fixture/pi/cli.js', project,
      stateDirectory: join(root, 'state'), nativeHome: root, config: { ...DEFAULT_CONFIG },
    }
    const login = await preparePiOmpAccountTerminal({ ...input, action: 'login', provider: 'deepseek' })
    try {
      expect(login.argv.slice(-2)).toEqual(['login', 'deepseek'])
      expect(login.argv.slice(-4, -2)).toEqual([expect.stringContaining('pi-login.mjs'), input.executable])
    } finally { await login.cleanup() }
    const agent = source === 'native' ? join(root, '.pi', 'agent') : join(input.stateDirectory, 'accounts', 'pi', 'agent')
    await mkdir(agent, { recursive: true, mode: 0o700 })
    const auth = join(agent, 'auth.json')
    const stored = JSON.stringify({ deepseek: { type: 'api_key', key: 'SYNTHETIC_ARGV_FIXTURE' } })
    await writeFile(auth, stored, { mode: 0o600 })
    const logout = await preparePiOmpAccountTerminal({ ...input, action: 'logout', login: `pi:deepseek:${source}` })
    try {
      expect(logout.argv.slice(-3)).toEqual(['logout', join(await realpath(agent), 'auth.json'), 'deepseek'])
      expect(logout.argv).not.toContain('SYNTHETIC_ARGV_FIXTURE')
      expect(await readFile(auth, 'utf8')).toBe(stored)
    } finally { await logout.cleanup() }
    expect(await readFile(auth, 'utf8')).toBe(stored)
  })
})

describe('Pi authorization that keeps the CLI running (simulated screen)', () => {
  it('watches the native account once while a device code waits, and ends only once', () => {
    const guide = new FlowGuide(PI_FLOW, { action: 'login', provider: 'xai' })
    const events = guide.output('https://accounts.x.ai/oauth2/device\r\nEnter code: ABCD-EFGH\r\nWaiting for authentication...\r\n')
    expect(events.filter((event) => 'watch' in event)).toEqual([{ watch: 'login' }])
    expect(guide.output('Waiting for authentication...\r\n').some((event) => 'watch' in event)).toBe(false)
    expect(guide.confirmed('login').some((event) => 'finish' in event)).toBe(true)
    // A late confirmation loop cannot draw another result over the finished window.
    expect(guide.confirmed('login')).toEqual([])
    expect(guide.unconfirmed('login')).toEqual([])
  })
})
