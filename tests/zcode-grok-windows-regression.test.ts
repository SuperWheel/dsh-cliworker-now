import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { FlowGuide, GuideResponseError, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { GROK_FLOW } from '../src/host/account-guide/single-account.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { zcodeGrokAccountStatus } from '../src/host/zcode-grok-accounts.ts'

const guides = (events: GuideEvent[]) => events.flatMap(event => 'guide' in event ? [event.guide] : [])

describe('Grok Windows login regressions (模拟)', () => {
  // Windows 1.0.50 + installed Electron/SDK ConPTY, 2026-10-29.
  // Real native errors and controls; URL replaced with a synthetic endpoint.
  const initialization = '\x1b[1t\x1b[c\x1b[?1004h\x1b[?9001h\x1b[0m'
  it.each([
    'operation timed out',
    'client error (Connect): tcp connect error: 由于连接方在一段时间后没有正确答复或连接的主机没有反应，连接尝试失败。 (os error 10060)',
  ])('shows a safe network failure before an authorization URL exists: %s', reason => {
    const flow = new FlowGuide(GROK_FLOW, { action: 'login' })
    const events = flow.output(initialization +
      `Error: error sending request for url (https://accounts.x.ai/synthetic?secret=SIMULATED) ${reason}\r\n`)
    expect(guides(events)).toEqual([{
      step: 'networkError', tone: 'warning', template: 'result',
      text: 'Grok 无法连接登录服务。请检查网络或 Grok 的代理设置，然后重新登录。',
    }])
    expect(events.at(-1)).toEqual({ finish: true })
    expect(events.some(event => 'confirm' in event || 'write' in event)).toBe(false)
    expect(JSON.stringify(events)).not.toMatch(/https:|SIMULATED|10060/)
    expect(flow.exited()).toEqual([])
  })

  // 模拟: these alternative prompts are present in the installed Windows binary.
  // Network timeout prevented capturing their live authorization screens this run.
  it.each(['Confirm this code in your browser', 'Then enter this code'])(
    'supports the native device-code wording: %s', marker => {
      const flow = new FlowGuide(GROK_FLOW, { action: 'login' })
      const events = flow.output(
        `To sign in, open this URL in your browser:\r\nhttps://accounts.x.ai/oauth2/device\r\n${marker}:\r\nSYNT-HETC\r\n`,
      )
      expect(guides(events)[0]).toMatchObject({
        step: 'device', template: 'deviceCode', code: 'SYNT-HETC', link: 'https://accounts.x.ai/oauth2/device',
      })
      expect(() => flow.respond({ code: 'not-a-callback' })).toThrow(GuideResponseError)
    },
  )

  it('guides native OIDC browser and callback URL without claiming login from text', () => {
    const flow = new FlowGuide(GROK_FLOW, { action: 'login' })
    const first = flow.output('Open this URL to sign in:\r\nhttps://auth.x.ai/authorize?state=synthetic\r\n')
    expect(guides(first)[0]).toMatchObject({ step: 'browser', template: 'browser' })
    const next = flow.output("Paste the URL here if it doesn't connect:\r\n")
    expect(guides(next)[0]).toMatchObject({ step: 'callback', template: 'browserCode' })
    const callback = 'http://127.0.0.1:12345/callback?code=synthetic&state=synthetic'
    const answered = flow.respond({ code: callback })
    expect(answered[0]).toEqual({ write: callback, enter: true })
    expect(answered).toContainEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(answered))).not.toContain(callback)
    expect(flow.proves('login', { state: 'unconfigured' }, { state: 'configured' }, 0)).toBe(false)
  })

  it('does not promote unrelated errors or foreign URLs into a Grok login', () => {
    const flow = new FlowGuide(GROK_FLOW, { action: 'login' })
    expect(flow.output('operation timed out\r\n')).toEqual([])
    const shown = guides(flow.output('Open this URL to sign in:\r\nhttps://auth.x.ai.evil.invalid/authorize\r\n'))
    expect(shown[0]?.link).toBeUndefined()
    expect(flow.proves('login', undefined, { state: 'configured' }, 0)).toBe(false)
  })
})

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('rereads a ZCode binding after login and never upgrades orphaned Windows-shaped credentials (模拟)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cwn-zcode-windows-simulated-'))
  roots.push(home)
  const stateDirectory = join(home, 'state'), zcodeAuthDirectory = join(stateDirectory, 'accounts/zcode')
  const directory = join(zcodeAuthDirectory, '.zcode/v2'), path = join(directory, 'credentials.json')
  await mkdir(directory, { recursive: true })
  const config = { ...DEFAULT_CONFIG, stateDirectory, zcodeAuthDirectory }
  const secret = 'SIMULATED-WINDOWS-SECRET', key = createHash('sha256').update(secret).digest()
  const encrypt = (plain: string) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(plain), cipher.final()])
    return `enc:v1:${[iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.')}`
  }
  // Keys observed in the OLD native Windows store (written 2026-10-11), not
  // evidence of the reported current login failure. Every value is simulated.
  const raw: Record<string, string> = {
    zcodefeedbackclientid: encrypt('simulated-client'),
    'oauth:active_provider': encrypt('bigmodel'),
    'oauth:bigmodel:access_token': encrypt('SIMULATED-ACCESS'),
    zcodejwttoken: encrypt('SIMULATED-JWT'),
    'oauth:bigmodel:user_info': encrypt(JSON.stringify({ id: 'simulated', rawProfile: { user_id: 'simulated' } })),
    'account-provider:coding-plan:account:bigmodel-individual-coding-plan:account:simulated:api-key': encrypt('SIMULATED-KEY'),
  }
  const read = () => zcodeGrokAccountStatus('zcode', config, new AbortController().signal, { home, credentialSecret: secret })
  await writeFile(path, JSON.stringify(raw))
  const incomplete = await readFile(path, 'utf8')
  expect(await read()).toMatchObject({ state: 'configured', verification: 'local', summary: 'ZCode 登录凭据已保存，账号绑定未确认，请重新登录' })
  expect(await readFile(path, 'utf8')).toBe(incomplete)
  raw['account-provider:account:bigmodel-individual-coding-plan:identity'] = encrypt('simulated')
  await writeFile(path, JSON.stringify(raw))
  expect(await read()).toMatchObject({ state: 'authenticated', authMethod: 'oauth', verification: 'local' })
  raw['account-provider:account:bigmodel-individual-coding-plan:identity'] = encrypt('different-user')
  await writeFile(path, JSON.stringify(raw))
  expect((await read()).state).toBe('configured')
  await writeFile(path, '{}')
  expect((await read()).state).toBe('unconfigured')
  key.fill(0)
})

it('distinguishes native API fallback from terminal personal.json and completed plugin OAuth (模拟)', async () => {
  // Reproduced with the installed Windows plugin and isolated files on 2026-10-30.
  // The native runtime's local persistence functions were separately exercised
  // through the real Electron/SDK ConPTY chain; no browser login was performed.
  const home = await mkdtemp(join(tmpdir(), 'cwn-zcode-fallback-simulated-'))
  roots.push(home)
  const stateDirectory = join(home, 'state')
  const auth = join(stateDirectory, 'accounts/zcode/.zcode/v2')
  const terminal = join(stateDirectory, 'accounts/zcode-terminal')
  const native = join(home, '.zcode/v2')
  for (const directory of [auth, terminal, native]) await mkdir(directory, { recursive: true })
  const credentialPath = join(auth, 'credentials.json')
  const config = { ...DEFAULT_CONFIG, stateDirectory }
  const read = () => zcodeGrokAccountStatus('zcode', config, new AbortController().signal, { home })
  const personal = JSON.stringify({
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: [{
        providerId: 'synthetic-api',
        config: { access: { type: 'api-key', apiKey: 'SIMULATED-API-KEY' } },
      }] },
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
    },
  })
  await writeFile(credentialPath, '{}')
  await writeFile(join(terminal, 'personal.json'), personal)
  expect((await read()).state).toBe('unconfigured')
  await writeFile(join(native, 'provider_config.json'), personal)
  expect(await read()).toMatchObject({ state: 'configured', authMethod: 'api', summary: '已配置 ZCode API' })

  await writeFile(credentialPath, JSON.stringify({
    'oauth:active_provider': 'bigmodel',
    'oauth:bigmodel:user_info': JSON.stringify({ id: 'synthetic-user', rawProfile: { user_id: 'synthetic-user' } }),
    'account-provider:account:bigmodel-individual-coding-plan:identity': 'synthetic-user',
    'account-provider:coding-plan:account:bigmodel-individual-coding-plan:account:synthetic-user:api-key': 'SIMULATED-BOUND-KEY',
  }))
  expect(await read()).toMatchObject({ state: 'authenticated', authMethod: 'oauth', verification: 'local' })

  // A failed private credential read must not silently become the native API fallback.
  await writeFile(credentialPath, JSON.stringify({ 'oauth:active_provider': 'enc:v1:invalid' }))
  expect((await read()).state).toBe('unavailable')
  expect(await readFile(join(native, 'provider_config.json'), 'utf8')).toBe(personal)
  expect(await readFile(join(terminal, 'personal.json'), 'utf8')).toBe(personal)
})
