import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverPiOmp, preparePiOmp, type PiOmpCli } from '../src/host/pi-omp-adapter.ts'

const fault = vi.hoisted(() => ({ replaceDirectory: '', directoryOpAttempts: 0 }))
vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if ((await actual.lstat(args[0]).catch(() => undefined))?.isDirectory()) {
        fault.directoryOpAttempts++
        throw Object.assign(new Error('Synthetic Windows directory descriptor unavailable'), {
          code: 'EPERM',
        })
      }
      return actual.open(...args)
    },
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      await actual.chmod(...args)
      if (args[0] === fault.replaceDirectory) {
        fault.replaceDirectory = ''
        await actual.rename(args[0], `${args[0]}-replaced`)
        await actual.mkdir(args[0])
      }
    },
  }
})

// Synthetic Windows filesystem limitation and metadata replies. No CLI, model,
// native account, login, or network request is invoked by this suite.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const roots: string[] = []
beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  fault.replaceDirectory = ''
  fault.directoryOpAttempts = 0
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-windows-pi-omp-')))
  roots.push(root)
  const project = join(root, 'project'),
    state = join(root, 'state')
  await mkdir(project)
  return { root, project, state }
}
const choices = [{ id: 'synthetic/model', label: 'Synthetic model', efforts: ['low', 'high'] }]
function metadata() {
  return vi.fn(async (argv: string[]) => {
    const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
    return JSON.stringify(
      request.metadataPhase === 'native-candidates' ? { phase: 'native-candidates', count: 1 } : choices,
    )
  })
}

describe('Pi/OMP Windows catalog and worker directory preparation', () => {
  it('prepares an OMP SQLite snapshot beyond the Windows legacy path limit', async () => {
    const f = await fixture()
    const state = join(f.root, 'synthetic-long-state-'.repeat(5), 'nested-state-'.repeat(5))
    const capture = metadata()
    const options = { nativeHome: f.root, accountRoot: state }
    await discoverPiOmp('omp', 'synthetic-cli', capture, state, options)
    const prepared = await preparePiOmp({
      cli: 'omp', executable: 'synthetic-cli', project: f.project, stateDirectory: state,
      preference: { model: 'synthetic/model', effort: 'low' },
      mode: 'plan', prompt: 'Synthetic long-path task', ...options,
    }, capture)
    const request = JSON.parse(await readFile(prepared.argv.at(-1)!, 'utf8'))
    expect(request.confirmedCatalog).toEqual(choices)
    expect(capture).toHaveBeenCalledTimes(4)
    await prepared.cleanup()
  })
  it.each(['pi', 'omp'] as const)(
    '%s reaches both metadata phases and preserves native efforts',
    async (cli) => {
      const f = await fixture(),
        capture = metadata()
      const options = { nativeHome: f.root, accountRoot: f.state }
      expect(await discoverPiOmp(cli, 'synthetic-cli', capture, f.state, options)).toEqual(choices)
      const prepared = await preparePiOmp(
        {
          cli,
          executable: 'synthetic-cli',
          project: f.project,
          stateDirectory: f.state,
          preference: { model: 'synthetic/model', effort: 'low' },
          mode: 'plan',
          prompt: 'Synthetic task',
          ...options,
        },
        capture,
      )
      const request = JSON.parse(await readFile(prepared.argv.at(-1)!, 'utf8'))
      expect(request.confirmedCatalog).toEqual(choices)
      expect(request.preference).toEqual({ model: 'synthetic/model', effort: 'low' })
      expect(capture).toHaveBeenCalledTimes(4)
      expect(fault.directoryOpAttempts).toBe(0)
      await prepared.cleanup()
    },
  )

  it.each(['pi', 'omp'] as const)(
    '%s rejects a directory replaced during preparation before querying',
    async (cli) => {
      const f = await fixture(),
        capture = metadata()
      fault.replaceDirectory = f.state
      await expect(
        discoverPiOmp(cli, 'synthetic-cli', capture, f.state, {
          nativeHome: f.root,
          accountRoot: f.state,
        }),
      ).rejects.toThrow('directory changed')
      expect(capture).not.toHaveBeenCalled()
      expect(await readdir(f.state)).toEqual([])
    },
  )

  it.each(['pi', 'omp'] as const)(
    '%s rejects a linked state root before writing outside it',
    async (cli: PiOmpCli) => {
      const f = await fixture(),
        capture = metadata(),
        outside = join(f.root, 'outside')
      await mkdir(outside)
      await symlink(outside, f.state, 'junction')
      await expect(
        discoverPiOmp(cli, 'synthetic-cli', capture, f.state, {
          nativeHome: f.root,
          accountRoot: f.state,
        }),
      ).rejects.toThrow('symlink')
      expect(capture).not.toHaveBeenCalled()
      expect(await readdir(outside)).toEqual([])
    },
  )
})

describe('Pi/OMP account-scope authentication counts (synthetic bridge replies)', () => {
  const scoped = (models: unknown[], authenticationDenied: number) =>
    vi.fn(async (argv: string[]) => {
      const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
      return JSON.stringify(
        request.metadataPhase === 'native-candidates'
          ? { phase: 'native-candidates', count: 1 }
          : { phase: 'account-scope', models, authenticationDenied },
      )
    })
  it('keeps the remaining models, names the skipped credentials and confirms only the models', async () => {
    const { catalogNoticeOf } = await import('../src/host/catalog-notice.ts')
    const f = await fixture(),
      capture = scoped(choices, 1)
    const options = { nativeHome: f.root, accountRoot: f.state }
    const models = await discoverPiOmp('omp', 'synthetic-cli', capture, f.state, options)
    expect(models).toEqual(choices)
    expect(catalogNoticeOf(models)).toBe('当前账号可用模型；已跳过 1 条认证失败的凭据，可在账号窗口退出')
    const prepared = await preparePiOmp(
      {
        cli: 'omp', executable: 'synthetic-cli', project: f.project, stateDirectory: f.state,
        preference: { model: 'synthetic/model', effort: 'low' }, mode: 'plan', prompt: 'Synthetic task', ...options,
      },
      capture,
    )
    expect(JSON.parse(await readFile(prepared.argv.at(-1)!, 'utf8')).confirmedCatalog).toEqual(choices)
    await prepared.cleanup()
  })
  it.each(['pi', 'omp'] as const)('%s reports an authentication failure when every credential is rejected', async (cli) => {
    const { catalogNoticeOf } = await import('../src/host/catalog-notice.ts')
    const f = await fixture()
    const models = await discoverPiOmp(cli, 'synthetic-cli', scoped([], 2), f.state, {
      nativeHome: f.root,
      accountRoot: f.state,
    })
    expect(models).toEqual([])
    expect(catalogNoticeOf(models)).toBe(
      `${cli === 'pi' ? 'Pi' : 'OMP'} 账号认证失败，请在账号窗口重新登录或退出失效凭据后刷新`,
    )
  })
  it('leaves a clean scope without a notice and rejects a malformed count', async () => {
    const { catalogNoticeOf } = await import('../src/host/catalog-notice.ts')
    const f = await fixture()
    const options = { nativeHome: f.root, accountRoot: f.state }
    expect(catalogNoticeOf(await discoverPiOmp('pi', 'synthetic-cli', scoped(choices, 0), f.state, options))).toBeUndefined()
    await expect(discoverPiOmp('pi', 'synthetic-cli', scoped(choices, -1), f.state, options)).rejects.toThrow()
  })
})
