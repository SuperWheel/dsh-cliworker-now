import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { qoderVariant, type QoderCliId } from '../src/host/qoder-variant.ts'
import { findWindowsPathCommand, windowsPathDirectories, windowsCommandCandidates, WINDOWS_PATH_QUERY } from '../src/host/windows-cli-path.ts'
import {
  codexAppxExecutable,
  findWindowsCodexAppx,
  hasWindowsHermesInstallDirectory,
  presentWindowsCliCandidate,
  rejectWindowsQoderCrossVariant,
  validateWindowsCodexNpmEntry,
  validateWindowsQoderNpmEntry,
  windowsCliCandidates,
  windowsQoderCliEntry,
  WindowsCliNotFoundError,
} from '../src/host/windows-cli-installation.ts'

// Explicit synthetic installer/package fixtures. No account, network or installed CLI is used.
const roots: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'synthetic-windows-cli-'))
  roots.push(home)
  return { home, env: { APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local') } }
}
function pe(path: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  const data = Buffer.alloc(80)
  data.write('MZ')
  data.writeUInt32LE(64, 0x3c)
  data.write('PE\0\0', 64)
  writeFileSync(path, data)
}
function npm(f = fixture()) {
  const shim = windowsCliCandidates('codex', f)[0]!,
    root = join(f.env.APPDATA, 'npm/node_modules/@openai/codex')
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@openai/codex', version: '0.162.0', bin: { codex: 'bin/codex.js' } }),
  )
  writeFileSync(join(root, 'bin/codex.js'), '#!/usr/bin/env node\n// Synthetic; never executed.\n')
  writeFileSync(shim, '@echo off\r\nnode "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n')
  return { f, shim, root }
}
function qoderNpm(f = fixture(), cli: QoderCliId = 'qoder') {
  const variant = qoderVariant(cli), entries = windowsCliCandidates(cli, f)
  const root = join(f.env.APPDATA, 'npm/node_modules', variant.package)
  const bin = { [variant.executable]: `bundle/${variant.executable}.js`, [cli]: `bundle/${cli}-npm-dispatcher.cjs` }
  mkdirSync(join(root, 'bundle'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: variant.package, version: '1.1.74', bin }))
  for (const [command, script] of Object.entries(bin)) {
    writeFileSync(join(root, script), '#!/usr/bin/env node\n// Synthetic Qoder bin; never executed.\n')
    writeFileSync(join(f.env.APPDATA, 'npm', command + '.cmd'), `@echo off\r\nnode "%~dp0node_modules\\${variant.package.replaceAll('/', '\\')}\\${script.replaceAll('/', '\\')}" %*\r\n`)
  }
  return { f, entries, root }
}
const packageRecord = {
  name: 'OpenAI.Codex',
  family: 'OpenAI.Codex_2p2nqsd0c76g0',
  fullName: 'OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0',
  publisher: 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B',
  signature: 'Store',
  status: 'Ok',
  location: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0',
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('known Windows CLI installation discovery', () => {
  it('finds Qoder native CLI despite a stale Desktop PATH, independently of its IDE dispatcher', () => {
    const { f, entries, root } = qoderNpm()
    pe(entries[0]!)
    expect(presentWindowsCliCandidate('qoder', { ...f, env: { ...f.env, PATH: 'C:\\stale' } })).toBe(entries[0])
    rmSync(entries[0]!)
    expect(presentWindowsCliCandidate('qoder', f)).toBe(realpathSync(join(root, 'bundle/qodercli.js')))
    rmSync(entries[1]!)
    expect(presentWindowsCliCandidate('qoder', f)).toBe(realpathSync(join(root, 'bundle/qodercli.js')))
  })
  it('normalizes a proven official npm dispatcher to its standalone CLI bin and rejects an unowned script', () => {
    const { root, f } = qoderNpm()
    const cli = realpathSync(join(root, 'bundle/qodercli.js'))
    expect(windowsQoderCliEntry(join(root, 'bundle/qoder-npm-dispatcher.cjs'))).toBe(cli)
    const unknown = join(f.home, 'qoder.js'); writeFileSync(unknown, '#!/usr/bin/env node\n')
    expect(() => windowsQoderCliEntry(unknown)).toThrow('Qoder Windows 安装入口无法确认')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@qoder-ai/qodercli', bin: { qoder: 'bundle/qoder-npm-dispatcher.cjs' } }))
    expect(() => windowsQoderCliEntry(join(root, 'bundle/qoder-npm-dispatcher.cjs'))).toThrow('Qoder Windows 安装入口无法确认')
  })
  it('accepts the observed canonical versioned Qoder native target while rejecting the IDE PE', () => {
    const f = fixture(), cli = join(f.home, 'qodercli-1.1.73.exe'), gui = join(f.home, 'Qoder.exe')
    pe(cli); pe(gui)
    expect(windowsQoderCliEntry(cli)).toBe(realpathSync(cli))
    expect(() => windowsQoderCliEntry(gui)).toThrow('Qoder Windows 安装入口无法确认')
  })
  it('does not hide a broken Qoder native install behind its npm compatibility entry', () => {
    const { f, entries } = qoderNpm()
    mkdirSync(join(entries[0]!, '..'), { recursive: true }); writeFileSync(entries[0]!, 'not a native PE')
    expect(() => presentWindowsCliCandidate('qoder', f)).toThrow('Qoder Windows 安装入口无法确认')
  })
  it('rejects a foreign npm package and a modified Qoder shim without executing either', () => {
    const { f, entries, root } = qoderNpm()
    writeFileSync(entries[1]!, '@echo off\r\nnode "%~dp0node_modules\\@qoder-ai\\qodercli\\bundle\\qodercli.js" %* & whoami\r\n')
    expect(() => presentWindowsCliCandidate('qoder', f)).toThrow('Qoder npm 安装入口无法确认')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@foreign/qodercli', bin: { qodercli: 'bundle/qodercli.js' } }))
    expect(() => validateWindowsQoderNpmEntry(entries[1]!)).toThrow('Qoder npm 安装入口无法确认')
  })
  it.each(['../outside.js', 'C:\\outside.js', '/outside.js'])(
    'rejects a Qoder npm bin outside the declared package: %s', bin => {
      const { entries, root } = qoderNpm()
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@qoder-ai/qodercli', bin: { qodercli: bin } }))
      expect(() => validateWindowsQoderNpmEntry(entries[1]!)).toThrow('Qoder npm 安装入口无法确认')
    },
  )
  it('recognizes Codex npm despite an unrelated or stale PATH and checks package identity', () => {
    const { f, shim, root } = npm()
    expect(presentWindowsCliCandidate('codex', { ...f, env: { ...f.env, PATH: '/synthetic/stale' } })).toBe(
      shim,
    )
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: '@third-party/codex', bin: { codex: 'bin/codex.js' } }),
    )
    expect(() => presentWindowsCliCandidate('codex', f)).toThrow('Codex npm 安装入口无法确认')
  })
  it.each(['../other.js', '/absolute.js', 'C:\\escape.js'])(
    'rejects npm bin traversal or a foreign absolute entry: %s',
    (bin) => {
      const { shim, root } = npm()
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: '@openai/codex', bin: { codex: bin } }),
      )
      expect(() => validateWindowsCodexNpmEntry(shim)).toThrow('Codex npm 安装入口无法确认')
    },
  )
  it('does not execute or accept a modified npm command script', () => {
    const { shim } = npm()
    writeFileSync(
      shim,
      '@echo off\r\nnode "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %* & whoami\r\n',
    )
    expect(() => validateWindowsCodexNpmEntry(shim)).toThrow('Codex npm 安装入口无法确认')
  })
  it('finds the native Hermes installer and legacy venv locations without searching arbitrary environments', () => {
    const f = fixture(),
      entries = windowsCliCandidates('hermes', f)
    expect(entries.slice(0, 3)).toEqual([
      join(f.env.LOCALAPPDATA, 'hermes/bin/hermes.exe'),
      join(f.env.LOCALAPPDATA, 'hermes/bin/hermes.cmd'),
      join(f.env.LOCALAPPDATA, 'hermes/hermes-agent/venv/Scripts/hermes.exe'),
    ])
    pe(entries[2]!)
    expect(presentWindowsCliCandidate('hermes', f)).toBe(entries[2])
    pe(entries[0]!)
    expect(presentWindowsCliCandidate('hermes', f)).toBe(entries[0])
  })
  it('keeps a present broken Hermes entry as an error instead of falling through to another environment', () => {
    const f = fixture(),
      entries = windowsCliCandidates('hermes', f)
    pe(entries[2]!)
    mkdirSync(join(entries[0]!, '..'), { recursive: true })
    writeFileSync(entries[0]!, 'not a Windows program')
    expect(() => presentWindowsCliCandidate('hermes', f)).toThrow('Hermes Windows 安装入口无法确认')
  })
  it('distinguishes Hermes install/data residue from an executable without probing credentials or running an installer', () => {
    const f = fixture()
    expect(hasWindowsHermesInstallDirectory(f)).toBe(false)
    mkdirSync(join(f.env.LOCALAPPDATA, 'hermes/tools/git-fixture'), { recursive: true })
    mkdirSync(join(f.env.LOCALAPPDATA, 'hermes/.hermes-clone-fixture'))
    expect(hasWindowsHermesInstallDirectory(f)).toBe(true)
    expect(presentWindowsCliCandidate('hermes', f)).toBeUndefined()
  })
  it('rejects relative Windows installation roots', () => {
    expect(() => windowsCliCandidates('hermes', { env: { LOCALAPPDATA: './unexpected' } })).toThrow(
      '目录配置无效',
    )
  })
})

describe('registered Codex MSIX CLI identity (synthetic metadata)', () => {
  it('selects resources/codex.exe in the registered Store package, never the GUI executable or another version directory', () => {
    const validate = vi.fn((path: string) => path)
    const path = codexAppxExecutable(JSON.stringify(packageRecord), validate)
    expect(path).toBe(packageRecord.location + '\\app\\resources\\codex.exe')
    expect(validate).toHaveBeenCalledExactlyOnceWith(path)
  })
  it('accepts a registered relocated package without hardcoding Program Files', () => {
    const record = { ...packageRecord, location: 'D:\\InstalledApps\\' + packageRecord.fullName }
    expect(codexAppxExecutable(JSON.stringify(record), (path) => path)).toBe(
      record.location + '\\app\\resources\\codex.exe',
    )
  })
  it('keeps no registered package distinct from unverified metadata', () => {
    expect(codexAppxExecutable('null')).toBeUndefined()
    expect(() => codexAppxExecutable('[]')).toThrow('应用包入口无法确认')
    expect(() => codexAppxExecutable('not json')).toThrow('应用包入口无法确认')
  })
  it.each([
    { name: 'Other.Codex' },
    { family: 'OpenAI.Codex_other' },
    { publisher: 'CN=Other' },
    { signature: 'Developer' },
    { status: 'Modified' },
    { fullName: 'OpenAI.Codex_latest_x64__2p2nqsd0c76g0' },
    { location: '\\\\server\\share\\' + packageRecord.fullName },
    { location: 'relative\\' + packageRecord.fullName },
    { location: 'C:\\Program Files\\WindowsApps\\Old.Codex_1.0.0.0_x64__other' },
  ])('refuses mismatched/unhealthy registration: %j', (change) => {
    const validate = vi.fn((path: string) => path)
    expect(() => codexAppxExecutable(JSON.stringify({ ...packageRecord, ...change }), validate)).toThrow(
      '应用包入口无法确认',
    )
    expect(validate).not.toHaveBeenCalled()
  })
  it('refuses missing or redirected package binaries without silently selecting a GUI or WSL entry', () => {
    expect(() =>
      codexAppxExecutable(JSON.stringify(packageRecord), () => {
        throw new Error('ENOENT')
      }),
    ).toThrow('应用包入口无法确认')
    expect(() =>
      codexAppxExecutable(JSON.stringify(packageRecord), () => 'C:\\elsewhere\\codex.exe'),
    ).toThrow('应用包入口无法确认')
  })
  it('uses fixed PowerShell arguments and passes cancellation into the metadata boundary', async () => {
    const signal = new AbortController(),
      capture = vi.fn(async () => 'null')
    expect(await findWindowsCodexAppx(capture, signal.signal, { SystemRoot: 'C:\\Windows' })).toBeUndefined()
    const argv = capture.mock.calls[0]![0]
    expect(argv.slice(0, 5)).toEqual([
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ])
    expect(Buffer.from(argv[5]!, 'base64').toString('utf16le')).toContain(
      "Get-AppxPackage -Name 'OpenAI.Codex'",
    )
    signal.abort()
    await expect(findWindowsCodexAppx(capture, signal.signal)).rejects.toThrow()
    expect(capture).toHaveBeenCalledTimes(1)
  })
  it('does not accept a late registered entry after cancellation', async () => {
    const controller = new AbortController()
    const capture = async () => {
      controller.abort()
      return JSON.stringify(packageRecord)
    }
    await expect(findWindowsCodexAppx(capture, controller.signal)).rejects.toThrow()
  })
})


describe('synthetic shared Windows path discovery', () => {
  it.each(['antigravity', 'codex', 'claude', 'kimi', 'mimo', 'zcode', 'grok', 'omp', 'pi', 'hermes', 'opencode', 'qoder', 'qodercn',
    'codebuddy',
  ] as const)(
    'discovers %s through a common user bin without a product-specific installer branch', cli => {
      const f = fixture(), command = cli === 'antigravity' ? 'agy' : cli === 'qoder' || cli === 'qodercn' ? qoderVariant(cli).executable : cli
      const entry = join(f.home, '.local/bin', command + '.exe')
      pe(entry)
      expect(presentWindowsCliCandidate(cli, f)).toBe(entry)
    },
  )
  it('refreshes only fixed system PowerShell metadata and finds a newly installed custom user PATH bin', async () => {
    const f = fixture(), directory = join(f.home, 'new custom 中文 bin'), entry = join(directory, 'claude.exe')
    pe(entry)
    const capture = vi.fn(async () => JSON.stringify({ user: directory, machine: '' }))
    expect(await findWindowsPathCommand(['claude'], capture, new AbortController().signal,
      { ...f, env: { ...f.env, SystemRoot: 'C:\\Windows', PATH: 'C:\\stale' } })).toBe(entry)
    const [argv, cwd] = capture.mock.calls[0] as unknown as [string[], string]
    expect(argv.slice(0, 5)).toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(Buffer.from(argv[5]!, 'base64').toString('utf16le')).toBe(WINDOWS_PATH_QUERY)
    expect(cwd).toBe(f.home)
    expect(WINDOWS_PATH_QUERY).not.toMatch(/Get-ChildItem|Start-Process|cmd \/c/)
  })
  it('uses machine PATH too and does not cache stale metadata between lookups', async () => {
    const f = fixture(), first = join(f.home, 'first'), second = join(f.home, 'second')
    pe(join(first, 'kimi.exe')); pe(join(second, 'kimi.exe'))
    const capture = vi.fn().mockResolvedValueOnce(JSON.stringify({ user: '', machine: first }))
      .mockResolvedValueOnce(JSON.stringify({ user: second, machine: '' }))
    expect(await findWindowsPathCommand(['kimi'], capture, new AbortController().signal, f)).toBe(join(first, 'kimi.exe'))
    expect(await findWindowsPathCommand(['kimi'], capture, new AbortController().signal, f)).toBe(join(second, 'kimi.exe'))
    expect(capture).toHaveBeenCalledTimes(2)
  })
  it('prefers a standalone Qoder command across all PATH directories over an earlier IDE alias', async () => {
    const f = fixture(), ide = join(f.home, 'IDE'), cli = join(f.home, 'CLI')
    pe(join(ide, 'qodercn.exe')); pe(join(cli, 'qoderclicn.exe'))
    const capture = vi.fn(async () => JSON.stringify({ user: ide + ';' + cli, machine: '' }))
    expect(await findWindowsPathCommand(['qoderclicn', 'qodercn'], capture, new AbortController().signal, f))
      .toBe(join(cli, 'qoderclicn.exe'))
  })
  it('skips relative, empty, network and unresolved PATH entries and deduplicates case-insensitively', () => {
    expect(windowsPathDirectories(['.;relative;;C:\\safe;"c:\\SAFE";\\\\server\\share;//server/share;%UNKNOWN%\\bin;C:\\other']))
      .toEqual(['C:\\safe', 'C:\\other'])
    expect(windowsCommandCandidates(['claude'], ['C:\\safe'], { PATHEXT: '.PS1;.EXE;.exe;.JS;.CMD' }))
      .toEqual([join('C:\\safe', 'claude.exe'), join('C:\\safe', 'claude.cmd')])
    expect(() => windowsCommandCandidates(['other & evil'], ['C:\\safe'])).toThrow()
    expect(() => windowsPathDirectories(['x'.repeat(65_537)])).toThrow()
    expect(() => windowsPathDirectories([Array.from({ length: 257 }, (_, i) => `C:\\bin${i}`).join(';')])).toThrow()
  })
  it('preserves a broken symlink rather than selecting another installation or guessed version', async () => {
    const f = fixture(), first = join(f.home, 'broken'), next = join(f.home, 'working')
    mkdirSync(first); symlinkSync(join(first, 'missing.exe'), join(first, 'mimo.exe')); pe(join(next, 'mimo.exe'))
    const capture = vi.fn(async () => JSON.stringify({ user: first + ';' + next, machine: '' }))
    expect(await findWindowsPathCommand(['mimo'], capture, new AbortController().signal, f)).toBe(join(first, 'mimo.exe'))
  })
  it.each(['null', '{}', '{"user":[],"machine":""}', '{"user":"","machine":"","command":"evil"}'])(
    'rejects malformed PATH metadata %s', async raw => {
      await expect(findWindowsPathCommand(['codex'], async () => raw, new AbortController().signal, fixture())).rejects.toThrow()
    },
  )
  it('does not start a cancelled lookup or adopt a late result and preserves capture cleanup errors', async () => {
    const controller = new AbortController(), reason = new Error('Synthetic cancellation'), capture = vi.fn(async () => '{}')
    controller.abort(reason)
    await expect(findWindowsPathCommand(['codex'], capture, controller.signal)).rejects.toBe(reason)
    expect(capture).not.toHaveBeenCalled()
    const late = new AbortController()
    await expect(findWindowsPathCommand(['codex'], async () => { late.abort(reason); return '{}'}, late.signal)).rejects.toBe(reason)
    const cleanup = new Error('Synthetic cleanup unconfirmed')
    await expect(findWindowsPathCommand(['codex'], async () => { throw cleanup }, new AbortController().signal)).rejects.toBe(cleanup)
  })
  it('rejects an unsafe Windows system root before starting a process', async () => {
    const capture = vi.fn()
    await expect(findWindowsPathCommand(['codex'], capture, new AbortController().signal,
      { env: { SystemRoot: '\\\\network\\Windows' } })).rejects.toThrow()
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('synthetic Qoder CN and international Windows installation isolation', () => {
  it.each(['qoder', 'qodercn'] as const)('resolves the observed canonical native symlink for %s without version enumeration', cli => {
    const f = fixture(), variant = qoderVariant(cli), entry = windowsCliCandidates(cli, f)[0]!
    const versioned = join(entry, '..', variant.executable + '-1.1.74.exe')
    pe(versioned); symlinkSync(versioned, entry)
    expect(presentWindowsCliCandidate(cli, f)).toBe(entry)
    expect(windowsQoderCliEntry(entry, cli)).toBe(realpathSync(versioned))
    rmSync(entry)
    expect(presentWindowsCliCandidate(cli, f)).toBeUndefined()
  })
  it.each(['qoder', 'qodercn'] as const)('normalizes only the proven %s npm dispatcher and rejects the other brand', cli => {
    const f = fixture(), own = qoderNpm(f, cli), otherCli = cli === 'qoder' ? 'qodercn' : 'qoder', other = qoderNpm(f, otherCli)
    const ownScript = join(own.root, 'bundle', qoderVariant(cli).executable + '.js')
    expect(validateWindowsQoderNpmEntry(own.entries[2]!, cli)).toBe(realpathSync(ownScript))
    expect(() => windowsQoderCliEntry(other.entries[1]!, cli)).toThrow('安装入口无法确认')
    expect(() => rejectWindowsQoderCrossVariant(other.entries[1]!, cli)).toThrow('另一版本')
    expect(() => rejectWindowsQoderCrossVariant(join(other.root, 'bundle', qoderVariant(otherCli).executable + '.js'), cli)).toThrow('另一版本')
    expect(() => rejectWindowsQoderCrossVariant(`D:\\custom\\${qoderVariant(otherCli).executable}-1.1.74.exe`, cli)).toThrow('另一版本')
  })
  it('does not fall back to the international install when CN is absent or broken', () => {
    const f = fixture(), international = windowsCliCandidates('qoder', f)[0]!, cn = windowsCliCandidates('qodercn', f)[0]!
    pe(international)
    expect(presentWindowsCliCandidate('qodercn', f)).toBeUndefined()
    pe(cn); writeFileSync(cn, 'Synthetic corrupt binary')
    expect(() => presentWindowsCliCandidate('qodercn', f)).toThrow('Qoder CN Windows 安装入口无法确认')
    expect(presentWindowsCliCandidate('qoder', f)).toBe(international)
  })
})

// Synthetic CodeBuddy npm shim/package only; never executed.
it('discovers CodeBuddy npm and verifies its package identity', () => {
  const f = fixture(), shim = join(f.env.APPDATA, 'npm/codebuddy.cmd')
  const root = join(f.env.APPDATA, 'npm/node_modules/@tencent-ai/codebuddy-code')
  expect(windowsCliCandidates('codebuddy', f)[0]).toBe(shim)
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@tencent-ai/codebuddy-code', bin: { codebuddy: 'bin/codebuddy.js' } }))
  writeFileSync(join(root, 'bin/codebuddy.js'), '// SIMULATED; never executed')
  writeFileSync(shim, '@echo off\r\nnode "%~dp0node_modules\\@tencent-ai\\codebuddy-code\\bin\\codebuddy.js" %*\r\n')
  expect(presentWindowsCliCandidate('codebuddy', f)).toBe(shim)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@foreign/package', bin: { codebuddy: 'bin/codebuddy.js' } }))
  expect(() => presentWindowsCliCandidate('codebuddy', f)).toThrow('CodeBuddy npm 安装入口无法确认')
  expect(new WindowsCliNotFoundError('codebuddy').message).toBe('CodeBuddy CLI 未找到，请配置 codebuddyExecutable')
})

// Synthetic TRAE CLI install_v2.ps1 layout only; never executed.
it('finds the official TRAE CLI user install despite a stale Desktop PATH and launches its PE', () => {
  const f = fixture(), bin = join(f.env.LOCALAPPDATA, 'Programs/TraeCLI/bin'), shim = join(bin, 'traecli.cmd')
  expect(windowsCliCandidates('traecn', f)[0]).toBe(shim)
  expect(presentWindowsCliCandidate('traecn', f)).toBeUndefined()
  pe(join(bin, 'traex.exe'))
  writeFileSync(shim, '@echo off\r\n"%~dp0traex.exe" %*\r\n')
  expect(presentWindowsCliCandidate('traecn', f)).toBe(shim)
  writeFileSync(shim, '@echo off\r\npowershell -c "SIMULATED unsafe"\r\n')
  expect(() => presentWindowsCliCandidate('traecn', f)).toThrow('启动入口无法确认')
})
