import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  agentNameProblem,
  firstFreeAgentName,
  isDshAgentName,
  numberedAgentName,
} from '../src/shared/agent-names.ts'
import {
  AGENT_NAME_OVERRIDES_FILE,
  AgentNameOverrides,
  PendingAgentNames,
  officialRename,
} from '../src/host/agent-name-overrides.ts'

describe('DSH agent name rule', () => {
  it('accepts 1 and 32 characters and rejects each invalid class with its reason', () => {
    expect(isDshAgentName('a')).toBe(true)
    expect(isDshAgentName(`a${'b'.repeat(31)}`)).toBe(true)
    expect(agentNameProblem('a')).toBeUndefined()
    expect(agentNameProblem('codex-1')).toBeUndefined()
    expect(agentNameProblem('')).toMatch('不能为空')
    expect(agentNameProblem(`a${'b'.repeat(32)}`)).toMatch('32')
    expect(agentNameProblem('小林')).toMatch('中文')
    expect(agentNameProblem('Codex')).toMatch('大写')
    expect(agentNameProblem('a b')).toMatch('空格')
    expect(agentNameProblem('a_b')).toMatch('下划线')
    expect(agentNameProblem('1a')).toMatch('字母开头')
    expect(agentNameProblem('-a')).toMatch('字母开头')
    expect(agentNameProblem('lead')).toMatch('lead')
    expect(isDshAgentName('lead')).toBe(false)
  })
  it('numbers stems within 32 characters', () => {
    expect(numberedAgentName('codex', 1)).toBe('codex-1')
    expect(numberedAgentName('agy', 12)).toBe('agy-12')
    const long = numberedAgentName('x'.repeat(40), 123)
    expect(long).toHaveLength(32)
    expect(isDshAgentName(long)).toBe(true)
    expect(isDshAgentName(numberedAgentName('小林·分支', 1))).toBe(true)
    expect(firstFreeAgentName('codex', new Set(['codex-1', 'codex-2']), new Set(['codex-3']))).toBe('codex-4')
  })
})

describe('AgentNameOverrides', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  const fresh = () => {
    const root = mkdtempSync(join(tmpdir(), 'cliworker-names-'))
    dirs.push(root)
    return join(root, 'state')
  }

  it('persists current and former names with 0700/0600 and restores them', () => {
    const dir = fresh()
    const store = new AgentNameOverrides(dir)
    const seen: string[] = []
    store.subscribe((parent) => seen.push(parent))
    store.set('p', 'c1', { name: 'reviewer', expected: 'codex-1', registeredName: 'codex-1', kind: 'worker' })
    store.set('p', 'c1', { name: 'audit', expected: 'reviewer', kind: 'worker' })
    expect(seen).toEqual(['p', 'p'])
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, AGENT_NAME_OVERRIDES_FILE)).mode & 0o777).toBe(0o600)
    const restored = new AgentNameOverrides(dir)
    expect(restored.get('p', 'c1')).toMatchObject({
      name: 'audit',
      registeredName: 'codex-1',
      formerNames: ['codex-1', 'reviewer'],
    })
    expect(restored.lookup('p', 'REVIEWER')).toMatchObject({ kind: 'match', childId: 'c1', current: false })
    expect(restored.lookup('p', 'audit')).toMatchObject({ kind: 'match', current: true })
    expect(restored.lookup('other', 'audit')).toEqual({ kind: 'none' })
    expect([...restored.occupied('p')].sort()).toEqual(['audit', 'codex-1', 'reviewer'])
    expect(restored.effectiveForRegistered('p', 'codex-1')).toBe('audit')
    expect(JSON.parse(readFileSync(join(dir, AGENT_NAME_OVERRIDES_FILE), 'utf8')).version).toBe(1)
  })

  it('rejects stale expectations and invalid names without writing', () => {
    const store = new AgentNameOverrides(fresh())
    store.set('p', 'c1', { name: 'reviewer', expected: 'codex-1', kind: 'worker' })
    expect(() => store.set('p', 'c1', { name: 'audit', expected: 'codex-1', kind: 'worker' })).toThrow('刷新')
    expect(() => store.set('p', 'c1', { name: 'Audit', expected: 'reviewer', kind: 'worker' })).toThrow(
      '大写',
    )
    expect(store.get('p', 'c1')?.name).toBe('reviewer')
  })

  it('reports ambiguity instead of guessing and deletes single entries', () => {
    const store = new AgentNameOverrides(fresh())
    store.set('p', 'c1', { name: 'one', expected: 'x', kind: 'native' })
    store.set('p', 'c2', { name: 'two', expected: 'x', kind: 'native' })
    expect(store.lookup('p', 'x')).toEqual({ kind: 'ambiguous', childIds: ['c1', 'c2'] })
    store.delete('p', 'c1')
    store.delete('p', 'c2')
    expect(store.parents()).toEqual([])
  })
})

describe('PendingAgentNames and official probe', () => {
  it('reserves per parent with idempotent release', () => {
    const pending = new PendingAgentNames()
    const release = pending.reserve('p', 'codex-1')
    const again = pending.reserve('p', 'codex-1')
    expect(pending.has('p', 'CODEX-1')).toBe(true)
    expect(pending.has('q', 'codex-1')).toBe(false)
    release()
    release()
    expect(pending.has('p', 'codex-1')).toBe(true)
    again()
    expect(pending.keys('p').size).toBe(0)
  })
  it('detects the (simulated) official rename only when it is a function', () => {
    expect(officialRename({})).toBeUndefined()
    expect(officialRename({ rename: 1 })).toBeUndefined()
    expect(officialRename({ rename: () => undefined })).toBeDefined()
  })
})
