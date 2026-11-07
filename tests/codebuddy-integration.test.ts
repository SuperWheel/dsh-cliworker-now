import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CLI_IDS, CLI_LABELS, CLI_SHORT_NAMES } from '../src/shared/types.ts'
import { CLI_ALIASES, CLI_NAME_GUIDANCE, requireCliName, invocationResolution } from '../src/host/routing.ts'
import { transportFor, usesNativeBridge } from '../src/host/native-worker.ts'
import { cliLevelOptions, runsUnderViewOnly, workerPlanSupported } from '../src/shared/worker-permissions.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { ACCOUNT_LOGIN_HOSTS, GUIDED_ACCOUNT_CLIS, SINGLE_ACCOUNT_CLIS } from '../src/shared/account-links.ts'
import { nativeAttachmentCapability } from '../src/host/native-attachments.mjs'
import { buildNativeHarnessInjection, nativeHarnessExecutionReady, nativeHarnessMcpServers, nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import { nativeCliCapabilities, nativeSkillPaths } from '../src/host/cli-native-capabilities.mjs'
import { extractTelemetry, TelemetryReader } from '../src/host/telemetry.ts'

// Synthetic registration/ACP receipts and temporary directories only. No real CLI, login, or model.
const preference = { cli: 'codebuddy' as const, model: 'SIMULATED-model', effort: 'default' as const }
const worker = { preference, transport: 'codebuddy-acp-v1' }
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function root() {
  const path = mkdtempSync(join(tmpdir(), 'codebuddy-SIMULATED-integration-'))
  roots.push(path)
  return path
}

it('registers CodeBuddy after Qoder CN with its own label, short name and transport', () => {
  expect(CLI_IDS.indexOf('codebuddy')).toBe(CLI_IDS.indexOf('qodercn') + 1)
  expect(CLI_LABELS.codebuddy).toBe('CodeBuddy Code')
  expect(CLI_SHORT_NAMES.codebuddy).toBe('codebuddy')
  expect(transportFor('codebuddy')).toBe('codebuddy-acp-v1')
  expect(usesNativeBridge(worker)).toBe(true)
  expect(readFileSync('src/host/native-bridge.mjs', 'utf8')).toContain("codebuddy: ['native-codebuddy', 'runNativeCodebuddy']")
})

it.each(CLI_ALIASES.codebuddy)('routes explicit %s to CodeBuddy', alias => {
  expect(requireCliName(alias)).toBe('codebuddy')
  expect(invocationResolution([createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: `请用 ${alias} 检查文件` }] })]))
    .toMatchObject({ status: 'resolved', cli: 'codebuddy' })
})
it('keeps cbc exclusive and includes CodeBuddy in generated routing guidance', () => {
  expect(Object.entries(CLI_ALIASES).filter(([, names]) => names.some(name => name.toLowerCase() === 'cbc')).map(([cli]) => cli))
    .toEqual(['codebuddy'])
  expect(requireCliName('CBC CLI')).toBe('codebuddy')
  expect(CLI_NAME_GUIDANCE).toContain('codebuddy')
})

it('offers three native permission levels, planning, images and an explicit no-fork reason', () => {
  expect(cliLevelOptions('codebuddy').map(({ value, name }) => [value, name]))
    .toEqual([['ask', '询问'], ['auto', '自动审批'], ['full', '完全权限']])
  expect(cliLevelOptions('codebuddy')[1]!.description).toContain('不会再问你')
  expect(workerPlanSupported(worker)).toBe(true)
  expect(runsUnderViewOnly('codebuddy')).toBe(true)
  expect(bridgedFeatureSupport(worker).fork).toEqual({ supported: false, reason: '当前 CLI 不支持会话分支：CodeBuddy ACP 未公开 session/fork' })
  expect(nativeAttachmentCapability('codebuddy')).toBe(true)
})

it('keeps a single account in its native terminal with the observed login hosts', () => {
  expect(ACCOUNT_LOGIN_HOSTS.codebuddy).toEqual(['codebuddy.cn', 'codebuddy.ai', 'copilot.tencent.com'])
  expect(SINGLE_ACCOUNT_CLIS.has('codebuddy')).toBe(true)
  expect(GUIDED_ACCOUNT_CLIS.has('codebuddy')).toBe(false)
})

it('injects ACP MCP transport while execution remains unverified', () => {
  expect(nativeHarnessToolCapability('codebuddy')).toMatchObject({ transport: true, ready: false })
  expect(nativeHarnessExecutionReady('codebuddy')).toBe(false)
  const connection = { url: 'http://127.0.0.1:12345/rpc', token: 'S'.repeat(43),
    binding: { parentSessionId: 'parent', harnessSessionId: 'child', workerId: 'worker', runId: 'run', cli: 'codebuddy' },
    executionReady: false, tools: [] }
  const argv = ['SIMULATED-codebuddy', '--acp']
  const injection = buildNativeHarnessInjection({ cli: 'codebuddy', argv, connection })
  expect(injection).toMatchObject({ transport: true, ready: false, argv })
  expect(injection.acpMcpServers).toHaveLength(1)
  expect(injection.acpMcpServers[0].name).toBe('dsh_worker_tools')
  expect(nativeHarnessMcpServers({ cli: 'codebuddy', argv, harnessTools: connection }, {})).toEqual(injection.acpMcpServers)
  expect(injection.argv.join(' ')).not.toContain(connection.token)
})

it('reports native tool classes and only CodeBuddy skill roots that exist', () => {
  const home = root(), project = join(home, 'project')
  const paths = [join(home, '.codebuddy/skills'), join(project, '.codebuddy/skills')]
  paths.forEach(path => mkdirSync(path, { recursive: true }))
  mkdirSync(join(home, '.opencode/skills'), { recursive: true })
  expect(nativeSkillPaths('codebuddy', { home, project, env: {} })).toEqual(paths)
  expect(nativeCliCapabilities({ cli: 'codebuddy', mode: 'accept-edits' }).classes)
    .toEqual(['file-read', 'file-write', 'search', 'shell', 'web', 'skills'])
  expect(nativeCliCapabilities({ cli: 'codebuddy', mode: 'plan' }).classes).not.toContain('file-write')
})

it('packages both CodeBuddy runtime resources and disables automatic updates only for its native launches', () => {
  const build = readFileSync('scripts/build.mjs', 'utf8')
  expect(build).toContain("'native-codebuddy',")
  expect(build).toContain("'codebuddy-catalog',")
  const runtime = readFileSync('src/host/runtime.ts', 'utf8')
  expect(runtime).toContain("...(cli === 'codebuddy' ? { DISABLE_AUTOUPDATER: '1' } : {})")
  expect(runtime).toContain("...(cliOf(worker.preference) === 'codebuddy' ? { DISABLE_AUTOUPDATER: '1' } : {})")
  expect(runtime).not.toContain('CODEBUDDY_INTERNET_ENVIRONMENT')
})

it('reads own raw and cached ACP context usage without token, credit or Grok metadata fallbacks', () => {
  const identity = { conversationId: 'SIMULATED-session', model: preference.model }
  const record = { method: 'session/update', params: { sessionId: identity.conversationId,
    update: { sessionUpdate: 'usage_update', used: 23742, size: 960000, _meta: { usage: { totalTokens: 999 } } } } }
  const path = join(root(), 'native.jsonl')
  writeFileSync(path, JSON.stringify({ type: 'native', record }) + '\n')
  const reader = new TelemetryReader()
  for (let i = 0; i < 2; i++) {
    const result = reader.read(path, 'codebuddy', identity)
    expect(result).toMatchObject({ contextUsed: 23742, contextCapacity: 960000, contextSource: 'CodeBuddy 原生会话上下文统计' })
    expect(result.usage).toBeUndefined()
    expect(result.providerCredits).toBeUndefined()
  }
  expect(extractTelemetry('codebuddy', [record], { ...identity, conversationId: 'foreign-session' }).contextUsed).toBeUndefined()
  expect(extractTelemetry('codebuddy', [{ method: 'session/update', params: { sessionId: identity.conversationId,
    update: { sessionUpdate: 'session_info_update' }, _meta: { totalTokens: 999 } } }], identity).contextUsed).toBeUndefined()
})
