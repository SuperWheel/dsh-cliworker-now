import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { prepareHermesHttpHome } from '../src/host/native-hermes-home.mjs'
import { runNativeHermes } from '../src/host/native-hermes.mjs'

// Synthetic homes only: no installed account, gateway or model is used.
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it.each([
  ['workspace-write', 'smart', '0'],
  ['danger-full-access', 'off', '1'],
  [undefined, 'smart', '0'],
])('writes explicit native approvals for %s without changing the source home', async (access, mode, yolo) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hermes-permissions-SIMULATED-')))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source, { mode: 0o700 })
  const original = 'auth:\n  adopt_external_logins: false\nmodel:\n  provider: openrouter\napprovals:\n  mode: manual\n'
  await writeFile(join(source, 'config.yaml'), original, { mode: 0o600 })
  await writeFile(join(source, 'auth.json'), JSON.stringify({ providers: {}, credential_pool: {} }), { mode: 0o600 })
  await writeFile(join(source, '.env'), '', { mode: 0o600 })
  const prepared = await prepareHermesHttpHome({ mode: 'accept-edits', access, project: root,
    stateDirectory: join(root, 'state'), env: { HERMES_HOME: source, HERMES_YOLO_MODE: 'inherited-unsafe' } },
  'openrouter', 'synthetic-model', 'synthetic-gateway-key', 12345)
  try {
    expect(parse(await readFile(join(prepared.home, 'config.yaml'), 'utf8')).approvals).toEqual({ mode })
    expect(prepared.env.HERMES_YOLO_MODE).toBe(yolo)
    expect(await readFile(join(source, 'config.yaml'), 'utf8')).toBe(original)
  } finally { await prepared.cleanup() }
})
it.each([
  ['plan', 'danger-full-access'],
  ['accept-edits', 'read-only'],
])('rejects %s / %s before filesystem or process access', async (mode, access) => {
  const io = { openStdio: vi.fn(), approval: vi.fn() }
  await expect(runNativeHermes({ mode, access }, io)).rejects.toThrow('不支持询问或只读派遣')
  await expect(prepareHermesHttpHome({ mode, access }, 'unused', 'unused', 'unused', 0)).rejects.toThrow('不支持询问或只读派遣')
  expect(io.openStdio).not.toHaveBeenCalled()
  expect(io.approval).not.toHaveBeenCalled()
})
