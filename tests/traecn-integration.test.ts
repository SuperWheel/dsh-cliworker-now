import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, utimes, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CLI_IDS, CLI_LABELS, CLI_SHORT_NAMES } from '../src/shared/types.ts'
import { requireCliName, invocationResolution } from '../src/host/routing.ts'
import { resolveCliExecutable, workerArguments, executableFor } from '../src/host/adapters.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { supportsNativeSteering } from '../src/shared/running-message.ts'
import { nativeAttachmentCapability } from '../src/host/native-attachments.mjs'
import { transportFor, usesNativeBridge } from '../src/host/native-worker.ts'
import { nativeSkillPaths, nativeCliCapabilities } from '../src/host/cli-native-capabilities.mjs'
import { nativeHarnessExecutionReady } from '../src/host/native-harness-injection.mjs'
import { traecnEnvironment } from '../src/host/traecn-accounts.ts'
import { windowsCliCommands } from '../src/host/windows-cli-installation.ts'
import { traecnMetadata } from './fixtures/traecn-metadata.ts'
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => state.home }))
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const path = await mkdtemp(join(tmpdir(), 'traecn-SIMULATED-identity-')); roots.push(path); state.home = path; return path }
const preference = { cli: 'traecn' as const, model: 'SIMULATED-model', effort: 'default' as const }
describe('模拟：TRAE 注册、路由与官方身份', () => {
  it('registers one CLI, a unique transport, native-only tasks and Windows command', () => {
    expect(CLI_IDS).toContain('traecn'); expect(CLI_LABELS.traecn).toBe('TRAE CN'); expect(CLI_SHORT_NAMES.traecn).toBe('traecn')
    expect(transportFor('traecn')).toBe('traecn-acp-v1')
    expect(usesNativeBridge({ preference, transport: transportFor('traecn') })).toBe(true)
    expect(executableFor('traecn', DEFAULT_CONFIG)).toBe('traecli')
    expect(windowsCliCommands('traecn')).toEqual(['traecli'])
    expect(() => workerArguments('traecli', '/模拟', preference, 'accept-edits', '模拟', 1000)).toThrow('ACP')
    expect(workerArguments('traecli', '/模拟', preference, 'plan', '模拟', 1000, undefined, true)).toEqual(['traecli'])
    expect(nativeHarnessExecutionReady('traecn')).toBe(false)
    expect(supportsNativeSteering('traecn')).toBe(false)
    expect(nativeAttachmentCapability('traecn')).toBe(true)
    expect(bridgedFeatureSupport({ preference, transport: 'traecn-acp-v1' })).toMatchObject({ fork: { supported: true }, forkEarlier: { supported: false } })
    expect(bridgedFeatureSupport({ preference, transport: 'qoder-acp-v1' }).fork.supported).toBe(false)
  })
  it.each(['traecn', 'trae', 'traecli', 'trae cli', 'trae-cli', 'TRAE CLI CN', 'TRAE CN', 'trae 国内版', 'trae 中国版', '字节 trae'])('routes alias %s, including generic trae', alias => {
    expect(requireCliName(alias)).toBe('traecn')
    expect(invocationResolution([createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `请用 ${alias} 检查文件` }] })]))
      .toMatchObject({ status: 'resolved', cli: 'traecn' })
  })
  it('checks auto and manual identities, caches by path+mtime and rechecks changed paths', async () => {
    const path = join(await root(), 'traecli'); await writeFile(path, '模拟 executable')
    const f = traecnMetadata(); vi.mocked(f.backend.resolveExecutable).mockResolvedValue(path)
    await expect(resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)).resolves.toBe(path)
    await resolveCliExecutable('traecn', f.backend, { ...DEFAULT_CONFIG, traecnExecutable: path })
    expect(f.spawn).toHaveBeenCalledTimes(1)
    await utimes(path, new Date(), new Date(Date.now() + 3000))
    await resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)
    expect(f.spawn).toHaveBeenCalledTimes(2)
    const other = join(state.home, 'manual-trae-cli'); await writeFile(other, '模拟 official alias')
    vi.mocked(f.backend.resolveExecutable).mockResolvedValue(other)
    await resolveCliExecutable('traecn', f.backend, { ...DEFAULT_CONFIG, traecnExecutable: other })
    expect(f.spawn).toHaveBeenCalledTimes(3)
    expect(f.calls.every(call => call.argv[1] === '--version')).toBe(true)
  })
  it.each(['traecli', 'trae-cli'])('rejects a wrong-identity same-name or manual %s fake', async name => {
    const path = join(await root(), name); await writeFile(path, '模拟 open-source fake')
    const f = traecnMetadata(() => ({ output: 'trae-agent 1.0.0\n' })); vi.mocked(f.backend.resolveExecutable).mockResolvedValue(path)
    await expect(resolveCliExecutable('traecn', f.backend, { ...DEFAULT_CONFIG, ...(name === 'trae-cli' ? { traecnExecutable: path } : {}) })).rejects.toThrow('不是官方 TRAE CLI')
    expect(f.calls).toHaveLength(1)
  })
  it.each(['traecli 0.213.1\n', 'warning\ntraecli 0.213.1\ninstallation: public'])('rejects incomplete identity %s', async output => {
    await root(); const f = traecnMetadata(() => ({ output }))
    await expect(resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)).rejects.toThrow('不是官方 TRAE CLI')
  })
  it('uses only the local/bin/traecli fallback, never alternate aliases', async () => {
    const home = await root(), path = join(home, '.local/bin/traecli')
    await mkdir(join(home, '.local/bin'), { recursive: true }); await writeFile(path, '模拟 executable')
    const f = traecnMetadata()
    vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => { if (name === path) return path; throw Object.assign(new Error('模拟 absent'), { code: 'ENOENT' }) })
    await expect(resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)).resolves.toBe(path)
    expect(vi.mocked(f.backend.resolveExecutable).mock.calls.map(c => c[0])).toEqual(['traecli', path])
    await rm(path)
    vi.mocked(f.backend.resolveExecutable).mockRejectedValue(Object.assign(new Error('模拟 only trae-cli installed'), { code: 'ENOENT' }))
    await expect(resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)).rejects.toThrow('only trae-cli')
    expect(f.calls).toHaveLength(1)
  })
  it('preserves native environment and advertises only confirmed skills/capability paths', async () => {
    const home = await root(), project = join(home, 'project')
    const paths = [join(home, '.trae/skills'), join(home, '.agents/skills'), join(project, '.trae/skills'), join(project, '.agents/skills')]
    for (const path of paths) await mkdir(path, { recursive: true })
    expect(nativeSkillPaths('traecn', { home, project })).toEqual(paths)
    expect(nativeCliCapabilities({ cli: 'traecn', mode: 'accept-edits' }).classes).toEqual(['file-read', 'file-write', 'search', 'shell', 'web', 'skills'])
    expect(traecnEnvironment({ PATH: '/usr/bin', TRAE_HOME: '/模拟native' }, 'darwin', home)).toEqual({ TRAE_HOME: '/模拟native', PATH: `/usr/bin:${join(home, '.local/bin')}` })
    expect(traecnEnvironment({ PATH: `/usr/bin:${join(home, '.local/bin')}` }, 'darwin', home)).toEqual({})
  })
})

it('模拟：Windows 只走共享 PATH，缺失提示配置 traecnExecutable', async () => {
  await root()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('PATH', '')
  vi.stubEnv('Path', '')
  const f = traecnMetadata(() => ({ output: '{"user":"","machine":""}' }))
  vi.mocked(f.backend.resolveExecutable).mockRejectedValue(Object.assign(new Error('模拟 missing'), { code: 'ENOENT' }))
  await expect(resolveCliExecutable('traecn', f.backend, DEFAULT_CONFIG)).rejects.toThrow('未找到，请配置 traecnExecutable')
  expect(vi.mocked(f.backend.resolveExecutable).mock.calls.map(c => c[0])).toEqual(['traecli'])
  expect(f.calls[0].argv).toContain('-EncodedCommand')
})
