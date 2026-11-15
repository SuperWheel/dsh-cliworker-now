/** 模拟：只在临时目录写入合成凭据，不读取真实账号、不运行真实 CLI。 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FlowGuide, type AccountEvidence } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { OPENCODE_FLOW } from '../src/host/account-guide/multi-account.ts'
import { readOpenCodeAccount, readPiOmpAccount } from '../src/host/harness-opencode-accounts.ts'
import { projectHermesIdentity } from '../src/host/hermes-accounts.ts'
import { openCodeAuthDirectory } from '../src/host/opencode-adapter.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const api = (key: string) => ({ type: 'api', key })
async function fixture(cli: 'opencode' | 'pi' | 'omp' | 'hermes') {
  const root = await mkdtemp(join(tmpdir(), 'cwn-confirm-simulated-'))
  roots.push(root)
  const config = { ...DEFAULT_CONFIG, stateDirectory: join(root, 'state') }
  const signal = new AbortController().signal
  const directory = cli === 'opencode' ? join(openCodeAuthDirectory(config.stateDirectory), 'opencode')
    : join(config.stateDirectory, 'accounts', cli, 'agent')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let hermes: unknown
  return {
    guide: createAccountGuide(cli, 'login', { provider: 'deepseek' })!,
    async save(key: string, other = 'SIMULATED-OTHER', metadata = 0) {
      if (cli === 'hermes') {
        hermes = { credential_pool: { deepseek: [{ id: 'a1b2c3', auth_type: 'api_key', access_token: key, last_used: metadata }],
          openrouter: [{ id: 'd4e5f6', auth_type: 'api_key', access_token: other }] } }
      } else if (cli === 'omp') {
        const db = new DatabaseSync(join(directory, 'agent.db'))
        try {
          db.exec('CREATE TABLE IF NOT EXISTS auth_credentials (provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)')
          db.exec('DELETE FROM auth_credentials')
          const insert = db.prepare('INSERT INTO auth_credentials (rowid,provider,credential_type,data) VALUES (?,?,?,?)')
          insert.run(1, 'deepseek', 'api_key', JSON.stringify({ ...api(key), last_used: metadata }))
          insert.run(2, 'openrouter', 'api_key', JSON.stringify(api(other)))
        } finally { db.close() }
      } else await writeFile(join(directory, 'auth.json'), JSON.stringify({
        deepseek: { ...api(key), last_used: metadata }, openrouter: api(other),
      }), { mode: 0o600 })
    },
    async read(): Promise<AccountEvidence> {
      if (cli === 'hermes') return projectHermesIdentity(hermes)!
      if (cli === 'opencode') return readOpenCodeAccount(config, signal, { nativeHome: root })
      return readPiOmpAccount(cli, config, signal, { nativeHome: root })
    },
  }
}

describe.each(['opencode', 'hermes', 'omp', 'pi'] as const)('%s 同服务商凭据替换（模拟）', cli => {
  it.each([0, 7, undefined])('相同登录 ID，凭据改变，退出码 %s 仍可确认', async exitCode => {
    const f = await fixture(cli)
    await f.save('SIMULATED-OLD')
    const before = await f.read()
    await f.save('SIMULATED-NEW')
    const after = await f.read()
    expect(before.logins?.length).toBeGreaterThan(0)
    expect(before.logins).toEqual(after.logins)
    expect(f.guide.proves('login', before, after, exitCode)).toBe(true)
    // Public projections retain no fingerprint or credential properties.
    expect(JSON.stringify(after)).not.toMatch(/SIMULATED|fingerprint|credential/i)
  })
  it.each([7, undefined])('相同凭据即使重写文件、其他服务商和元数据变化也不确认（退出码 %s）', async exitCode => {
    const f = await fixture(cli)
    await f.save('SIMULATED-OLD')
    const before = await f.read()
    await f.save('SIMULATED-OLD', 'SIMULATED-CHANGED-OTHER', 123)
    expect(f.guide.proves('login', before, await f.read(), exitCode)).toBe(false)
  })
  it('无法读取基线不把现存凭据当作新增登录', async () => {
    const f = await fixture(cli)
    await f.save('SIMULATED-OLD')
    const after = await f.read()
    for (const before of [undefined, { state: 'unavailable' as const }])
      expect(f.guide.proves('login', before, after, 7)).toBe(false)
    expect(f.guide.proves('login', after, after, 0)).toBe(true)
  })
})

it('模拟：读取状态不可用时，即使带旧登录行和退出码 0 也不确认', () => {
  const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'deepseek' })
  expect(guide.proves('login', { state: 'unconfigured' }, {
    state: 'unavailable', logins: [{ id: 'opencode:deepseek', providerLabel: 'DeepSeek', authMethod: 'api' }],
  }, 0)).toBe(false)
})
