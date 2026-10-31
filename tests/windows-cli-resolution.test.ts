import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { executableFor, resolveCliExecutable } from '../src/host/adapters.ts'
import { findWindowsPathCommand } from '../src/host/windows-cli-path.ts'
import { findWindowsCodexAppx } from '../src/host/windows-cli-installation.ts'
import { managedZCodeEntry } from '../src/host/zcode-adapter.ts'
import {
  findWindowsDesktopCli,
  windowsOpenCodeDesktopCli,
} from '../src/host/windows-desktop-cli-installation.ts'

const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (actual) => ({
  ...(await actual<typeof import('node:os')>()),
  homedir: () => state.home,
}))
vi.mock('../src/host/windows-cli-path.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/windows-cli-path.ts')>()),
  findWindowsPathCommand: vi.fn(),
}))
vi.mock('../src/host/windows-cli-installation.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/windows-cli-installation.ts')>()),
  findWindowsCodexAppx: vi.fn(),
}))
vi.mock('../src/host/windows-desktop-cli-installation.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/windows-desktop-cli-installation.ts')>()),
  findWindowsDesktopCli: vi.fn(),
  windowsOpenCodeDesktopCli: vi.fn(),
}))

// Synthetic lookup failures use the actual SDK error class; it intentionally has no ENOENT code.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const appx = vi.mocked(findWindowsCodexAppx)
const desktop = vi.mocked(findWindowsDesktopCli)
const desktopGui = vi.mocked(windowsOpenCodeDesktopCli)
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), 'synthetic-windows-resolution-'))
  vi.stubEnv('APPDATA', join(state.home, 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(state.home, 'Local'))
  vi.stubEnv('ProgramFiles', join(state.home, 'Programs'))
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  vi.mocked(findWindowsPathCommand).mockReset()
  appx.mockReset()
  desktop.mockReset()
  desktopGui.mockReset()
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  rmSync(state.home, { recursive: true, force: true })
})
function backend(resolve: (entry: string) => Promise<string>): ProcessBackend {
  return {
    resolveExecutable: vi.fn(resolve),
    spawn: () => {
      throw new Error('Unexpected process spawn')
    },
  }
}

describe('Windows default executable fallback without changing other platforms', () => {
  it('discovers the installed Qoder standalone CLI before consulting an IDE alias or stale PATH', async () => {
    const entry = join(state.home, '.qoder/bin/qodercli/qodercli.exe'), bytes = Buffer.alloc(80)
    bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.write('PE\0\0', 64)
    mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, bytes)
    const lookup = backend(async path => path)
    expect(executableFor('qoder', DEFAULT_CONFIG)).toBe(entry)
    await expect(resolveCliExecutable('qoder', lookup, DEFAULT_CONFIG)).resolves.toBe(realpathSync(entry))
    expect(lookup.resolveExecutable).toHaveBeenCalledExactlyOnceWith(entry)
    const custom = 'D:\\Custom CLI\\qodercli.exe'
    expect(executableFor('qoder', { ...DEFAULT_CONFIG, qoderExecutable: custom })).toBe(custom)
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    expect(executableFor('qoder', DEFAULT_CONFIG)).toBe('qoder')
  })
  it('finds a custom Qoder CLI on PATH and uses the legacy alias only when qodercli is absent', async () => {
    const entry = join(state.home, 'Custom CLI/qodercli.exe'), bytes = Buffer.alloc(80)
    bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.write('PE\0\0', 64)
    mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, bytes)
    const direct = backend(async name => name === 'qodercli' ? entry : 'unexpected')
    await expect(resolveCliExecutable('qoder', direct, DEFAULT_CONFIG)).resolves.toBe(realpathSync(entry))
    expect(direct.resolveExecutable).toHaveBeenCalledExactlyOnceWith('qodercli')
    const legacy = backend(async command => {
      if (command === 'qodercli') throw new SubprocessExecutableNotFoundError('Synthetic old npm install')
      return entry
    })
    await expect(resolveCliExecutable('qoder', legacy, DEFAULT_CONFIG)).resolves.toBe(realpathSync(entry))
    expect(vi.mocked(legacy.resolveExecutable).mock.calls.map(call => call[0])).toEqual(['qodercli', 'qoder'])
  })
  it('rejects IDE or unknown legacy qoder paths and ignores an unrelated local-bin GUI without spawning it', async () => {
    const gui = join(state.home, '.local/bin/qoder.exe')
    mkdirSync(dirname(gui), { recursive: true }); writeFileSync(gui, 'Synthetic IDE; must not execute')
    const lookup = backend(async name => {
      if (name === 'qodercli') throw new SubprocessExecutableNotFoundError('Synthetic missing CLI')
      return gui
    })
    expect(executableFor('qoder', DEFAULT_CONFIG)).toBe('qodercli')
    await expect(resolveCliExecutable('qoder', lookup, DEFAULT_CONFIG)).rejects.toThrow('Qoder Windows 安装入口无法确认')
    expect(vi.mocked(lookup.resolveExecutable).mock.calls.map(call => call[0])).toEqual(['qodercli', 'qoder'])
    await expect(resolveCliExecutable('qoder', backend(async () => 'C:\\Program Files\\Qoder\\Qoder.exe'), DEFAULT_CONFIG))
      .rejects.toThrow('Qoder Windows 安装入口无法确认')
  })
  it('rechecks Qoder automatic cache identity while leaving an explicit manual path authoritative', async () => {
    const gui = join(state.home, 'Qoder.exe'); writeFileSync(gui, 'Synthetic IDE; never executed')
    const remember = vi.fn(), store = { read: () => ({ mode: 'auto', path: gui }), revision: () => 0, remember }
    await expect(resolveCliExecutable('qoder', backend(async path => path), {
      ...DEFAULT_CONFIG, cliExecutablePaths: store as never,
    })).rejects.toThrow('Qoder Windows 安装入口无法确认')
    expect(remember).not.toHaveBeenCalled()
    await expect(resolveCliExecutable('qoder', backend(async path => path), { ...DEFAULT_CONFIG, qoderExecutable: gui }))
      .resolves.toBe(gui)
  })
  it('does not replace explicit or inaccessible Qoder entries with another installation', async () => {
    for (const config of [DEFAULT_CONFIG, { ...DEFAULT_CONFIG, qoderExecutable: 'D:\\explicit\\qoder.exe' }]) {
      const denied = Object.assign(new Error('Synthetic denied'), { code: 'EACCES' })
      const lookup = backend(async () => { throw denied })
      await expect(resolveCliExecutable('qoder', lookup, config)).rejects.toBe(denied)
      expect(lookup.resolveExecutable).toHaveBeenCalledTimes(1)
    }
    const missing = backend(async () => { throw new SubprocessExecutableNotFoundError('Synthetic missing') })
    await expect(resolveCliExecutable('qoder', missing, DEFAULT_CONFIG)).rejects.toThrow('Qoder CLI 未找到')
    const explicit = backend(async () => { throw new SubprocessExecutableNotFoundError('Synthetic explicit missing') })
    await expect(resolveCliExecutable('qoder', explicit, { ...DEFAULT_CONFIG, qoderExecutable: 'D:\\missing\\qoder.exe' })).rejects.toThrow('explicit missing')
    expect(explicit.resolveExecutable).toHaveBeenCalledTimes(1)
    expect(desktop).not.toHaveBeenCalled()
  })
  it.each(['win32', 'darwin'] as const)(
    'prefers a deployed managed ZCode runtime on %s while preserving explicit custom paths',
    async (target) => {
      Object.defineProperty(process, 'platform', { ...platform, value: target })
      const managed = managedZCodeEntry(),
        bundled = join(state.home, 'Local/Programs/ZCode/resources/glm/zcode.cjs')
      for (const entry of [managed, bundled]) {
        mkdirSync(dirname(entry), { recursive: true })
        writeFileSync(entry, '// Synthetic installation entry; never executed.\n')
      }
      const lookup = backend(async (entry) => entry)
      expect(executableFor('zcode', DEFAULT_CONFIG)).toBe(managed)
      expect(executableFor('zcode', { ...DEFAULT_CONFIG, zcodeExecutable: 'zcode' })).toBe(managed)
      await expect(resolveCliExecutable('zcode', lookup, DEFAULT_CONFIG)).resolves.toBe(managed)
      expect(lookup.resolveExecutable).not.toHaveBeenCalled()
      const custom = join(state.home, 'custom/zcode.cjs')
      expect(executableFor('zcode', { ...DEFAULT_CONFIG, zcodeExecutable: custom })).toBe(custom)
      const missing = new SubprocessExecutableNotFoundError('synthetic missing explicit ZCode')
      await expect(
        resolveCliExecutable(
          'zcode',
          backend(async () => {
            throw missing
          }),
          {
            ...DEFAULT_CONFIG,
            zcodeExecutable: custom,
          },
        ),
      ).rejects.toBe(missing)
    },
  )
  it('falls back to the Windows Desktop bundle or PATH only when managed ZCode is absent', async () => {
    const bundled = join(state.home, 'Local/Programs/ZCode/resources/glm/zcode.cjs')
    mkdirSync(dirname(bundled), { recursive: true })
    writeFileSync(bundled, '// Synthetic bundled CLI; never executed.\n')
    expect(executableFor('zcode', DEFAULT_CONFIG)).toBe(bundled)
    await expect(
      resolveCliExecutable(
        'zcode',
        backend(async (entry) => entry),
        DEFAULT_CONFIG,
      ),
    ).resolves.toBe(bundled)
    rmSync(bundled)
    expect(executableFor('zcode', DEFAULT_CONFIG)).toBe('zcode')
    const missing = new SubprocessExecutableNotFoundError('synthetic no native ZCode installation')
    await expect(
      resolveCliExecutable(
        'zcode',
        backend(async () => {
          throw missing
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toThrow('ZCode CLI 未找到')
    expect(desktop).toHaveBeenCalledOnce()
  })
  it('rejects a broken managed ZCode installation instead of silently switching runtimes', async () => {
    const managed = managedZCodeEntry(),
      bundled = join(state.home, 'Local/Programs/ZCode/resources/glm/zcode.cjs')
    mkdirSync(managed, { recursive: true })
    mkdirSync(dirname(bundled), { recursive: true })
    writeFileSync(bundled, '// Synthetic bundled CLI; never executed.\n')
    await expect(
      resolveCliExecutable(
        'zcode',
        backend(async (entry) => entry),
        DEFAULT_CONFIG,
      ),
    ).rejects.toThrow('CLI 脚本路径不是普通文件')
  })
  it('discovers the registered Codex CLI after the real SDK missing-executable error', async () => {
    appx.mockResolvedValue('C:\\registered\\codex.exe')
    const process = backend(async (entry) => {
      if (entry === 'codex') throw new SubprocessExecutableNotFoundError('synthetic missing PATH')
      return entry
    })
    await expect(resolveCliExecutable('codex', process, DEFAULT_CONFIG)).resolves.toBe(
      'C:\\registered\\codex.exe',
    )
    expect(appx).toHaveBeenCalledOnce()
    expect(process.resolveExecutable).toHaveBeenLastCalledWith('C:\\registered\\codex.exe')
  })
  it('preserves explicit Codex configuration and never replaces a broken requested entry', async () => {
    const process = backend(async () => {
      throw new SubprocessExecutableNotFoundError('synthetic bad configured entry')
    })
    await expect(
      resolveCliExecutable('codex', process, { ...DEFAULT_CONFIG, codexExecutable: 'C:\\custom\\codex.exe' }),
    ).rejects.toThrow('synthetic bad')
    expect(appx).not.toHaveBeenCalled()
  })
  it('preserves a working PATH entry without querying another installed account runtime', async () => {
    await expect(
      resolveCliExecutable(
        'codex',
        backend(async () => 'C:\\preferred\\codex.exe'),
        DEFAULT_CONFIG,
      ),
    ).resolves.toBe('C:\\preferred\\codex.exe')
    expect(appx).not.toHaveBeenCalled()
  })
  it('does not hide a permission or unsupported-launcher failure behind Appx fallback', async () => {
    const denied = Object.assign(new Error('synthetic denied'), { code: 'EACCES' })
    await expect(
      resolveCliExecutable(
        'codex',
        backend(async () => {
          throw denied
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toBe(denied)
    expect(appx).not.toHaveBeenCalled()
  })
  it('retains missing status when neither PATH nor a registered Codex package exists', async () => {
    const missing = new SubprocessExecutableNotFoundError('synthetic missing')
    appx.mockResolvedValue(undefined)
    await expect(
      resolveCliExecutable(
        'codex',
        backend(async () => {
          throw missing
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toBe(missing)
  })
  it('reports Hermes incomplete installation evidence without inventing a CLI version or launching an installer', async () => {
    mkdirSync(join(state.home, 'Local/hermes/tools/git-fixture'), { recursive: true })
    const process = backend(async () => {
      throw new SubprocessExecutableNotFoundError('synthetic missing')
    })
    await expect(resolveCliExecutable('hermes', process, DEFAULT_CONFIG)).rejects.toMatchObject({
      code: 'CLI_INSTALLATION_UNAVAILABLE',
      installed: false,
      message: '检测到 Hermes 安装目录，但未找到可用 CLI 入口，请完成安装或配置已有入口',
    })
    expect(appx).not.toHaveBeenCalled()
  })
  it('does not consult Windows installers or install residue on macOS', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    mkdirSync(join(state.home, 'Local/hermes/tools'), { recursive: true })
    expect(executableFor('codex', DEFAULT_CONFIG)).toBe('codex')
    const missing = new SubprocessExecutableNotFoundError('synthetic missing')
    await expect(
      resolveCliExecutable(
        'codex',
        backend(async () => {
          throw missing
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toBe(missing)
    await expect(
      resolveCliExecutable(
        'hermes',
        backend(async () => {
          throw missing
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toBe(missing)
    expect(appx).not.toHaveBeenCalled()
  })
  it('does not adopt a late fallback after cancellation', async () => {
    const controller = new AbortController()
    appx.mockImplementation(async () => {
      controller.abort()
      return 'C:\\registered\\codex.exe'
    })
    const process = backend(async () => {
      throw new SubprocessExecutableNotFoundError('synthetic missing')
    })
    await expect(resolveCliExecutable('codex', process, DEFAULT_CONFIG, controller.signal)).rejects.toThrow()
    expect(process.resolveExecutable).toHaveBeenCalledOnce()
  })

  it.each(['zcode', 'opencode'] as const)(
    'discovers %s from Desktop metadata after missing PATH',
    async (cli) => {
      const entry =
        cli === 'zcode'
          ? 'E:\\自定义 安装\\resources\\glm\\zcode.cjs'
          : 'D:\\OpenCode\\resources\\opencode-cli.exe'
      desktop.mockResolvedValue(entry)
      const native = backend(async (value) => {
        if (value === cli) throw new SubprocessExecutableNotFoundError('synthetic missing PATH')
        return value
      })
      await expect(resolveCliExecutable(cli, native, DEFAULT_CONFIG)).resolves.toBe(entry)
      expect(desktop).toHaveBeenCalledOnce()
      expect(native.resolveExecutable).toHaveBeenCalledTimes(cli === 'zcode' ? 1 : 2)
    },
  )

  it.each(['zcode', 'opencode'] as const)(
    'preserves explicit, working PATH and access failures for %s',
    async (cli) => {
      await expect(
        resolveCliExecutable(
          cli,
          backend(async () => 'D:\\native\\cli.exe'),
          DEFAULT_CONFIG,
        ),
      ).resolves.toBe('D:\\native\\cli.exe')
      const missing = new SubprocessExecutableNotFoundError('synthetic explicit missing')
      await expect(
        resolveCliExecutable(
          cli,
          backend(async () => {
            throw missing
          }),
          {
            ...DEFAULT_CONFIG,
            [`${cli}Executable`]: 'D:\\explicit\\cli.exe',
          },
        ),
      ).rejects.toBe(missing)
      const denied = Object.assign(new Error('synthetic denied'), { code: 'EACCES' })
      await expect(
        resolveCliExecutable(
          cli,
          backend(async () => {
            throw denied
          }),
          DEFAULT_CONFIG,
        ),
      ).rejects.toBe(denied)
      expect(desktop).not.toHaveBeenCalled()
    },
  )

  it('uses only the CLI accompanying a PATH OpenCode GUI and rejects an explicit GUI', async () => {
    const gui = 'D:\\Desktop\\OpenCode.exe',
      entry = 'D:\\Desktop\\resources\\opencode-cli.exe'
    desktopGui.mockImplementation((_entry, explicit) => {
      if (explicit) throw new Error('执行路径指向桌面主程序')
      return entry
    })
    await expect(
      resolveCliExecutable(
        'opencode',
        backend(async () => gui),
        DEFAULT_CONFIG,
      ),
    ).resolves.toBe(entry)
    await expect(
      resolveCliExecutable(
        'opencode',
        backend(async () => gui),
        { ...DEFAULT_CONFIG, opencodeExecutable: gui },
      ),
    ).rejects.toThrow('桌面主程序')
    expect(desktop).not.toHaveBeenCalled()
  })

  it('never queries desktop metadata on macOS and rejects a late result after cancellation', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    const missing = new SubprocessExecutableNotFoundError('synthetic missing')
    await expect(
      resolveCliExecutable(
        'opencode',
        backend(async () => {
          throw missing
        }),
        DEFAULT_CONFIG,
      ),
    ).rejects.toBe(missing)
    expect(desktop).not.toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    const controller = new AbortController()
    desktop.mockImplementation(async () => {
      controller.abort()
      return 'D:\\cli\\opencode-cli.exe'
    })
    const native = backend(async () => {
      throw missing
    })
    await expect(
      resolveCliExecutable('opencode', native, DEFAULT_CONFIG, controller.signal),
    ).rejects.toThrow()
    expect(native.resolveExecutable).toHaveBeenCalledOnce()
  })

  it.each([
    ['codex', true],
    ['codex', false],
    ['zcode', true],
    ['zcode', false],
    ['opencode', true],
    ['opencode', false],
  ] as const)(
    'awaits %s metadata cleanup on cancellation and preserves unconfirmed exit (confirmed=%s)',
    async (cli, confirmed) => {
      const controller = new AbortController()
      const stdout = new PassThrough(),
        stderr = new PassThrough()
      let finish!: (value: { exitCode: null }) => void
      let confirmCleanup!: (value: boolean) => void
      const done = new Promise<{ exitCode: null }>((resolve) => {
        finish = resolve
      })
      const cleanup = new Promise<boolean>((resolve) => {
        confirmCleanup = resolve
      })
      const terminate = vi.fn()
      const waitForExit = vi.fn(() => cleanup)
      const process = backend(async () => {
        throw new SubprocessExecutableNotFoundError('synthetic missing PATH')
      })
      process.spawn = vi.fn((spec) => {
        spec.signal!.addEventListener(
          'abort',
          () => {
            stdout.end()
            stderr.end()
            finish({ exitCode: null })
          },
          { once: true },
        )
        return { stdout, stderr, done, terminate, waitForExit } as ReturnType<ProcessBackend['spawn']>
      })
      // Exercise the real captureCatalogMetadata lifecycle through the resolver.
      // Only Windows registration parsing is replaced; no real subprocess runs.
      const captureMetadata = async (capture: (argv: string[], cwd: string) => Promise<string>) => {
        await capture(['synthetic-appx-query'], state.home)
        return undefined
      }
      appx.mockImplementation(captureMetadata)
      desktop.mockImplementation(async (_cli, capture) => captureMetadata(capture))
      let settled = false
      const result = resolveCliExecutable(cli, process, DEFAULT_CONFIG, controller.signal).then(
        () => {
          settled = true
          return undefined
        },
        (error: unknown) => {
          settled = true
          return error
        },
      )
      await vi.waitFor(() => expect(process.spawn).toHaveBeenCalledOnce())
      const cancellation = new Error('synthetic cancelled')
      controller.abort(cancellation)
      await vi.waitFor(() => expect(waitForExit).toHaveBeenCalledOnce())
      expect(terminate).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
      confirmCleanup(confirmed)
      const error = await result
      if (confirmed) expect(error).toBe(cancellation)
      else expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
      expect(process.resolveExecutable).toHaveBeenCalledOnce()
    },
  )
})


describe('synthetic shared latest Windows PATH resolution', () => {
  it.each(['antigravity', 'claude', 'kimi', 'mimo', 'grok', 'hermes'] as const)(
    'reuses the common PATH refresh for %s after an inherited PATH miss', async cli => {
      const command = cli === 'antigravity' ? 'agy' : cli, entry = join(state.home, 'new bin', command + '.exe')
      const bytes = Buffer.alloc(80); bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.write('PE\0\0', 64)
      mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, bytes)
      vi.mocked(findWindowsPathCommand).mockResolvedValue(entry)
      const lookup = backend(async value => {
        if (value === command) throw new SubprocessExecutableNotFoundError('Synthetic stale inherited PATH')
        return value
      })
      await expect(resolveCliExecutable(cli, lookup, DEFAULT_CONFIG)).resolves.toBe(entry)
      expect(vi.mocked(findWindowsPathCommand).mock.calls[0]?.[0]).toEqual([command])
      expect(vi.mocked(lookup.resolveExecutable).mock.calls.map(call => call[0])).toEqual([command, entry])
    },
  )
  it('normalizes a freshly discovered Qoder CN npm dispatcher without resolving or executing the script as a program', async () => {
    const root = join(state.home, 'custom npm'), packageRoot = join(root, 'node_modules/@qodercn-ai/qoderclicn')
    const script = join(packageRoot, 'bundle/qoderclicn.js'), dispatcher = join(packageRoot, 'bundle/qodercn-npm-dispatcher.cjs')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, '#!/usr/bin/env node\n// Synthetic standalone entry; never executed.\n')
    writeFileSync(dispatcher, '#!/usr/bin/env node\n// Synthetic dispatcher; never executed.\n')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@qodercn-ai/qoderclicn', bin: {
      qoderclicn: 'bundle/qoderclicn.js', qodercn: 'bundle/qodercn-npm-dispatcher.cjs',
    } }))
    const shim = join(root, 'qodercn.cmd')
    writeFileSync(shim, '@echo off\r\nnode "%~dp0node_modules\\@qodercn-ai\\qoderclicn\\bundle\\qodercn-npm-dispatcher.cjs" %*\r\n')
    vi.mocked(findWindowsPathCommand).mockResolvedValue(shim)
    const lookup = backend(async value => {
      expect(value).toBe('qoderclicn')
      throw new SubprocessExecutableNotFoundError('Synthetic stale inherited PATH')
    })
    await expect(resolveCliExecutable('qodercn', lookup, DEFAULT_CONFIG)).resolves.toBe(realpathSync(script))
    expect(lookup.resolveExecutable).toHaveBeenCalledOnce()
  })
  it('preserves explicit Antigravity configuration and never refreshes a missing manual path', async () => {
    const custom = 'D:\\custom\\agy.exe', missing = new SubprocessExecutableNotFoundError('Synthetic manual missing')
    const lookup = backend(async () => { throw missing })
    await expect(resolveCliExecutable('antigravity', lookup, { ...DEFAULT_CONFIG, executable: custom })).rejects.toBe(missing)
    expect(findWindowsPathCommand).not.toHaveBeenCalled()
  })
  it('rejects a broken newly discovered shim instead of trying another CLI or desktop runtime', async () => {
    const entry = join(state.home, 'new bin/opencode.cmd')
    mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, '@echo off\r\nstart evil.exe\r\n')
    vi.mocked(findWindowsPathCommand).mockResolvedValue(entry)
    const lookup = backend(async () => { throw new SubprocessExecutableNotFoundError('Synthetic missing') })
    await expect(resolveCliExecutable('opencode', lookup, DEFAULT_CONFIG)).rejects.toThrow('CLI 启动入口无法确认')
    expect(desktop).not.toHaveBeenCalled()
    expect(lookup.resolveExecutable).toHaveBeenCalledOnce()
  })
  it('does not refresh after a working inherited PATH, explicit configuration, or access failure', async () => {
    await resolveCliExecutable('claude', backend(async () => 'D:\\native\\claude.exe'), DEFAULT_CONFIG)
    const denied = Object.assign(new Error('Synthetic denied'), { code: 'EACCES' })
    await expect(resolveCliExecutable('claude', backend(async () => { throw denied }), DEFAULT_CONFIG)).rejects.toBe(denied)
    expect(findWindowsPathCommand).not.toHaveBeenCalled()
  })
  it('rejects a late refreshed path after cancellation without running a follow-up lookup', async () => {
    const controller = new AbortController(), reason = new Error('Synthetic cancelled')
    vi.mocked(findWindowsPathCommand).mockImplementation(async () => { controller.abort(reason); return 'D:\\late.exe' })
    const lookup = backend(async () => { throw new SubprocessExecutableNotFoundError('Synthetic missing') })
    await expect(resolveCliExecutable('claude', lookup, DEFAULT_CONFIG, controller.signal)).rejects.toBe(reason)
    expect(lookup.resolveExecutable).toHaveBeenCalledOnce()
  })
  it('requires process-tree cleanup before accepting refreshed PATH metadata', async () => {
    vi.mocked(findWindowsPathCommand).mockImplementation(async (_commands, capture) => capture(['synthetic powershell'], state.home))
    const stdout = new PassThrough(), stderr = new PassThrough()
    stdout.end('{"user":"","machine":""}'); stderr.end()
    const terminate = vi.fn(), waitForExit = vi.fn(async () => false)
    const lookup: ProcessBackend = {
      resolveExecutable: async () => { throw new SubprocessExecutableNotFoundError('Synthetic missing') },
      spawn: () => ({ stdout, stderr, done: Promise.resolve({ exitCode: 0 }), terminate, waitForExit }) as never,
    }
    await expect(resolveCliExecutable('claude', lookup, DEFAULT_CONFIG)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    // A bounded natural-exit wait, then terminate and the confirming wait.
    expect(terminate).toHaveBeenCalledOnce(); expect(waitForExit).toHaveBeenCalledTimes(2)
  })
  it('keeps explicit known Qoder CN and international native entries isolated', async () => {
    for (const [cli, other] of [['qoder', 'qoderclicn'], ['qodercn', 'qodercli']] as const) {
      const entry = `D:\\other brand\\${other}-1.1.74.exe`
      await expect(resolveCliExecutable(cli, backend(async () => entry), { ...DEFAULT_CONFIG, [`${cli}Executable`]: entry }))
        .rejects.toThrow('另一版本')
    }
    expect(findWindowsPathCommand).not.toHaveBeenCalled()
  })
})
