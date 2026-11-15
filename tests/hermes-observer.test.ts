import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hermesObservedResponse, prepareHermesObserver } from '../src/host/hermes-observer.mjs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))
function root() { const path = realpathSync(mkdtempSync(join(tmpdir(), 'hermes-observer-synthetic-'))); chmodSync(path, 0o700); roots.push(path); return path }
const start = { phase: 'request', session_id: 'synthetic-session', task_id: 'synthetic-session',
  turn_id: 'synthetic-turn', api_request_id: 'synthetic-turn:api:1', api_call_count: 1,
  provider: 'synthetic', model: 'synthetic-model', api_mode: 'chat_completions' }
const end = { ...start, phase: 'response', context_length: 1000, usage_basis: 'hermes-canonical',
  usage: { input_tokens: 12, cache_read_tokens: 20, cache_write_tokens: 3, output_tokens: 8,
    reasoning_tokens: 5, prompt_tokens: 35, total_tokens: 43 } }
const turnEnd = { phase: 'turn_end', session_id: start.session_id, task_id: start.task_id, turn_id: start.turn_id,
  model: start.model, completed: true, failed: false, interrupted: false }

async function fixture() {
  const capture = await prepareHermesObserver(root(), { provider: start.provider, model: start.model })
  const path = join(capture.env.CLIWORKER_HERMES_OBSERVER_DIR, 'events.jsonl'),
    nonce = capture.env.CLIWORKER_HERMES_OBSERVER_NONCE
  await capture.bind(start.session_id); capture.bindRun('synthetic-http-run')
  let seq = 0
  const put = (value: object) => appendFileSync(path, JSON.stringify({ v: 1, nonce, seq: ++seq, ...value }) + '\n')
  put({ phase: 'ready' })
  return { capture, path, nonce, put }
}

function numericObserver(payloads: object[]) {
  const base = root(), agent = join(base, 'agent')
  mkdirSync(agent)
  writeFileSync(join(agent, '__init__.py'), '')
  // Synthetic public estimator functions: distinctive message/schema costs
  // expose missing inputs and double-counting without loading a model/provider.
  writeFileSync(join(agent, 'model_metadata.py'), `import json
def estimate_messages_tokens_rough(messages):
 if any(m.get('content') == 'FAIL_ESTIMATE' for m in messages): raise ValueError('synthetic estimator failure')
 return sum(5 + len(m.get('content') or '') for m in messages)
def estimate_request_tokens_rough(messages, *, tools=None):
 return sum(7 + len(t['function']['name']) for t in tools or [])
`)
  const script = `import sys,runpy,json
sys.path.insert(0,sys.argv[1])
module=runpy.run_path(sys.argv[2])
print(json.dumps([module['request_context_breakdown'](p) for p in json.load(sys.stdin)]))
`
  return JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-I', '-c', script, base,
    resolve('src/host/hermes-observer.py')], { input: JSON.stringify(payloads), encoding: 'utf8', env: { HOME: base } }))
}

describe.skipIf(process.platform === 'win32')('Hermes public request classification (synthetic numeric estimators)', () => {
  const input = { api_mode: 'chat_completions', provider: 'synthetic',
    request_messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: '你好' }], system_prompt: 'SYS',
    request: { body: { tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] } } }
  const label = { estimated: true, basis: 'hermes-native-request-estimate' }
  it('counts the actual outgoing input once and emits only known numeric estimates', () => {
    expect(numericObserver([input])).toEqual([{ systemTokens: 8, messageTokens: 7, toolTokens: 11, ...label }])
    const secret = 'SYNTHETIC_PRIVATE_SYSTEM_AND_API_KEY'
    const [result] = numericObserver([{ ...input, system_prompt: secret,
      request_messages: [{ role: 'system', content: secret }],
      request: { body: { tools: [], authorization: secret }, authorization: secret } }])
    expect(result).toEqual({ systemTokens: 5 + secret.length, messageTokens: 0, toolTokens: 0, ...label })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it('keeps missing inputs unknown, while an explicit empty list measures zero', () => {
    expect(numericObserver([{ ...input, request: undefined }, { ...input, request_messages: undefined },
      { api_mode: 'chat_completions' }, { api_mode: 'chat_completions', request_messages: [], request: { body: { tools: [] } } }]))
      .toEqual([{ systemTokens: 8, messageTokens: 7, ...label }, { toolTokens: 11, ...label }, null,
        { systemTokens: 0, messageTokens: 0, toolTokens: 0, ...label }])
  })
  it.each([
    { _truncated: true, preview: 'private' },
    { body: { tools: [{ _truncated_items: 2 }] } },
    { body: { tools: [{ type: 'function', function: { name: 'read', description: 'x...[truncated 9 chars]' } }] } },
    { body: { tools: [{ type: 'function', function: { name: 'read', parameters: '<dict depth limit>' } }] } },
    { body: { tools: [{ type: 'function', function: { name: 'read', description: '<redacted>' } }] } },
    { body: { tools: [{ type: 'custom', name: 'unsupported-wire' }] } },
    { body: { tools: [] }, _truncated_items: 1 },
    { body: { tools: [], _truncated_items: 1 } },
  ])('does not account a partial or unsupported schema as complete tools: %j', (request) => {
    expect(numericObserver([{ ...input, request }])).toEqual([{ systemTokens: 8, messageTokens: 7, ...label }])
  })
  it('bounds work, fails closed on unknown wire shapes, and tolerates estimator failure', () => {
    expect(numericObserver([{ ...input, api_mode: 'codex_responses' }, { ...input, api_mode: 'anthropic' },
      { ...input, provider: 'moa' }, { ...input, request_messages: [{ type: 'function_call_output', output: 'x' }] },
      { ...input, request_messages: [{ role: 'user', content: 'x'.repeat(4 * 1024 * 1024 + 1) }] },
      { ...input, request_messages: [{ role: 'user', content: 'FAIL_ESTIMATE' }] }]))
      .toEqual([null, null, null, { toolTokens: 11, ...label }, { toolTokens: 11, ...label }, null])
  })
  it('does not invent a system count if the hook exposes an unrelated out-of-band prompt', () => {
    expect(numericObserver([{ ...input, system_prompt: 'DIFFERENT' }]))
      .toEqual([{ messageTokens: 7, toolTokens: 11, ...label }])
  })
})

describe('Hermes own-process observer (offline synthetic lifecycle only)', () => {
  it('separates the exact provider prompt from session bill and preserves canonical cache semantics', () => {
    expect(hermesObservedResponse(start, end)).toEqual({ sessionId: start.session_id, turnId: start.turn_id,
      requestId: start.api_request_id, provider: start.provider, model: start.model,
      usage: { input: 35, output: 8, total: 43, cacheRead: 20, cacheWrite: 3, reasoning: 5 },
      source: 'hermes.observer.post_api_request', usageBasis: 'cli-normalized',
      context: { used: 35, capacity: 1000, basis: 'provider-prompt' } })
    expect(hermesObservedResponse(start, { ...end, moa: true })?.context).toBeUndefined()
    expect(hermesObservedResponse(start, { ...end, context_length: undefined })?.context).toBeUndefined()
  })
  it('does not present normalized zero cache/reasoning as raw provider precision', () => {
    expect(hermesObservedResponse(start, { ...end, usage: { input_tokens: 35, cache_read_tokens: 0,
      cache_write_tokens: 0, output_tokens: 8, reasoning_tokens: 0, prompt_tokens: 35, total_tokens: 43 } })?.usage)
      .toEqual({ input: 35, output: 8, total: 43 })
  })
  it('binds numeric classification to its exact request and preserves partial categories', () => {
    const breakdown = { systemTokens: 100, messageTokens: 200, estimated: true, basis: 'hermes-native-request-estimate' }
    expect(hermesObservedResponse({ ...start, context_breakdown: breakdown }, end)?.context)
      .toEqual({ used: 35, capacity: 1000, basis: 'provider-prompt', breakdown })
    expect(hermesObservedResponse(start, { ...end, context_breakdown: breakdown })?.context?.breakdown).toBeUndefined()
    expect(hermesObservedResponse({ ...start, context_breakdown: breakdown }, { ...end, api_request_id: 'foreign' })).toBeUndefined()
    expect(hermesObservedResponse({ ...start, context_breakdown: breakdown }, { ...end, moa: true })?.context).toBeUndefined()
  })
  it.each([{ systemTokens: -1 }, { systemTokens: 0.5 }, { systemTokens: Number.MAX_SAFE_INTEGER + 1 },
    { estimated: false }, { basis: 'guessed' }, { prompt: 'SYNTHETIC_SECRET' },
    { systemTokens: undefined, messageTokens: undefined }])('rejects unproven or nonnumeric classification: %j', (change) => {
    const context_breakdown = { systemTokens: 100, messageTokens: 200, estimated: true,
      basis: 'hermes-native-request-estimate', ...change }
    expect(hermesObservedResponse({ ...start, context_breakdown }, end)?.context?.breakdown).toBeUndefined()
  })
  it.each(['session_id', 'task_id', 'turn_id', 'api_request_id', 'model', 'provider', 'api_mode', 'api_call_count'])('refuses mismatched %s', (key) => {
    expect(hermesObservedResponse(start, { ...end, [key]: 'foreign' })).toBeUndefined()
  })
  it.each([{ total_tokens: 1 }, { prompt_tokens: 1 }, { output_tokens: -1 }, { reasoning_tokens: 9 }, { input_tokens: NaN }, { cache_read_tokens: undefined }])('rejects invalid canonical usage %j', (usage) => {
    expect(hermesObservedResponse(start, { ...end, usage: { ...end.usage, ...usage } })).toBeUndefined()
  })
  it('settles an exact request once and summarizes only fully covered successful requests', async () => {
    const f = await fixture(), records: any[] = []
    try {
      f.put(start); f.put(end); f.put(turnEnd)
      expect(await f.capture.read((value: any) => records.push(value))).toBe(true)
      await f.capture.finish((value: any) => records.push(value))
      await f.capture.finish((value: any) => records.push(value))
      const accounting = records.filter(record => record.type !== 'hermes.request-state')
      expect(accounting).toHaveLength(2)
      expect(accounting[0].nativeRunId).toBe('synthetic-http-run')
      expect(accounting[1]).toMatchObject({ type: 'cliworker.hermes_observer_summary', coverageComplete: true,
        source: 'hermes.observer.summary', usageComplete: true, requestCount: 1, responseCount: 1, errorCount: 0, usage: { total: 43 } })
    } finally { await f.capture.close() }
    expect(existsSync(f.path)).toBe(false)
  })
  it('retains only a valid response after a real retry pair; error accounting never becomes a full run bill', async () => {
    const f = await fixture(), records: any[] = []
    try {
      f.put(start); f.put({ ...start, phase: 'error' }); f.put(start); f.put(end); f.put(turnEnd)
      await f.capture.finish((value: any) => records.push(value))
      const accounting = records.filter(record => record.type !== 'hermes.request-state')
      expect(accounting[0].requestId).toBe(start.api_request_id)
      expect(accounting[1]).toMatchObject({ coverageComplete: true, usageComplete: false, errorCount: 1 })
      expect(accounting[1].usage).toBeUndefined()
    } finally { await f.capture.close() }
  })
  it('uses only the successful retry classification and never sums context categories', async () => {
    const f = await fixture(), records: any[] = []
    const labels = { estimated: true, basis: 'hermes-native-request-estimate' }
    try {
      f.put({ ...start, context_breakdown: { systemTokens: 999, ...labels } }); f.put({ ...start, phase: 'error' })
      f.put({ ...start, context_breakdown: { messageTokens: 12, ...labels } }); f.put(end); f.put(turnEnd)
      await f.capture.finish((value: any) => records.push(value))
      const observed = records.filter(record => record.type === 'cliworker.hermes_observation')
      expect(observed).toHaveLength(1)
      expect(observed[0].context.breakdown).toEqual({ messageTokens: 12, ...labels })
      expect(records.at(-1).context).toBeUndefined()
      expect(f.capture.confirmedRuntime()).toBeUndefined()
    } finally { await f.capture.close() }
  })
  it('does not call the aggregator-only MOA observations a complete run total', async () => {
    const f = await fixture(), records: any[] = []
    try {
      f.put(start); f.put({ ...end, moa: true }); f.put(turnEnd)
      await f.capture.finish((value: any) => records.push(value))
      const accounting = records.filter(record => record.type !== 'hermes.request-state')
      expect(accounting[0].context).toBeUndefined()
      expect(accounting[1]).toMatchObject({ coverageComplete: true, usageComplete: false })
      expect(accounting[1].usage).toBeUndefined()
      expect(f.capture.confirmedRuntime()).toBeUndefined()
    } finally { await f.capture.close() }
  })
  it.each(['foreign', 'foreign-model', 'foreign-provider', 'sequence', 'duplicate', 'missing-post', 'partial', 'missing-end', 'interrupted-end', 'nonce'])('模拟 does not elevate %s observations to complete run accounting', async (mode) => {
    const f = await fixture(), records: any[] = []
    try {
      f.put(start)
      if (mode === 'foreign') f.put({ ...end, session_id: 'foreign' })
      else if (mode === 'foreign-model' || mode === 'foreign-provider') {
        f.put(end)
        f.put({ ...start, api_request_id: 'different-request', [mode === 'foreign-model' ? 'model' : 'provider']: 'different' })
        f.put(turnEnd)
      }
      else if (mode === 'sequence') f.put({ ...end, seq: 99 })
      else if (mode === 'duplicate') { f.put(end); f.put(end) }
      else if (mode === 'partial') appendFileSync(f.path, '{"v":')
      else if (mode === 'missing-end') f.put(end)
      else if (mode === 'interrupted-end') { f.put(end); f.put({ ...turnEnd, interrupted: true }) }
      else if (mode === 'nonce') f.put({ ...end, nonce: 'foreign' })
      await f.capture.finish((value: any) => records.push(value))
      expect(records.at(-1)).toMatchObject({ usageComplete: false, coverageComplete: false })
      expect(records.at(-1).usage).toBeUndefined()
      expect(f.capture.confirmedRuntime()).toBeUndefined()
    } finally { await f.capture.close() }
  })
  it.skipIf(process.platform === 'win32')('rejects permissive observation-file modes', async () => {
    const f = await fixture(), records: any[] = []
    try {
      chmodSync(f.path, 0o644)
      f.put(start); f.put(end); f.put(turnEnd)
      expect(await f.capture.read((value: any) => records.push(value))).toBe(false)
      expect(records).toEqual([])
      await f.capture.finish((value: any) => records.push(value))
      expect(records.at(-1).usageComplete).toBe(false)
    } finally { await f.capture.close() }
  })
  it.skipIf(process.platform === 'win32').each(['synthetic', 'different-provider'])(
    '模拟 public hooks retain same-session provider %s without loading accounts or models', (provider) => {
    const base = root(), python = join(base, 'hermes_cli')
    mkdirSync(python)
    writeFileSync(join(python, '__init__.py'), '')
    writeFileSync(join(python, 'plugins.py'), `# Explicitly synthetic public Hermes API fixture\ncallbacks={}\nclass PluginManifest:\n def __init__(self, **kw): pass\nclass Handle:\n def __init__(self, key): self.key=key\n def dispose(self): callbacks.pop(self.key,None)\nclass PluginContext:\n def __init__(self, manifest, manager): pass\n def register_hook(self, name, callback):\n  callbacks[name]=callback\n  return Handle(name)\ndef get_plugin_manager(): return object()\n`)
    const agent = join(base, 'agent'); mkdirSync(agent); writeFileSync(join(agent, '__init__.py'), '')
    writeFileSync(join(agent, 'model_metadata.py'), `def estimate_messages_tokens_rough(messages): return sum(len(m['content']) for m in messages)\ndef estimate_request_tokens_rough(messages, *, tools=None): return len(tools or [])\n`)
    const directory = join(base, 'capture'); mkdirSync(directory, { mode: 0o700 })
    writeFileSync(join(directory, 'events.jsonl'), '', { mode: 0o600 })
    const nonce = 'a'.repeat(64)
    writeFileSync(join(directory, 'identity.json'), JSON.stringify({ nonce, sessionId: start.session_id,
      model: start.model, provider: start.provider }), { mode: 0o600 })
    const script = `import sys,runpy,json,os\nsys.path.insert(0,sys.argv[1])\nmodule=runpy.run_path(sys.argv[2])\ndispose=module['install_observer']()\nfrom hermes_cli.plugins import callbacks\nassert set(callbacks)=={'pre_api_request','post_api_request','api_request_error','on_session_end'}\npayload=json.loads(sys.argv[3]);callbacks['pre_api_request'](**payload)\npayload.update(json.loads(sys.argv[4]));callbacks['post_api_request'](**payload)\ndispose();assert not callbacks\nassert os.environ['HERMES_SAFE_MODE']=='1'\n`
    execFileSync('/usr/bin/python3', ['-B', '-I', '-c', script, base,
      resolve('src/host/hermes-observer.py'), JSON.stringify({ ...start, provider, platform: 'api_server',
        request: { authorization: 'SYNTHETIC_SECRET', body: { tools: [] } }, system_prompt: 'SYNTHETIC_SECRET',
        request_messages: [{ role: 'system', content: 'SYNTHETIC_SECRET' }, { role: 'user', content: 'SYNTHETIC_USER_PRIVATE' }] }), JSON.stringify({ ...end, provider })],
    { env: { HOME: base, HERMES_HOME: base, HERMES_SAFE_MODE: '1',
      CLIWORKER_HERMES_OBSERVER_DIR: directory, CLIWORKER_HERMES_OBSERVER_NONCE: nonce } })
    const contents = readFileSync(join(directory, 'events.jsonl'), 'utf8')
    expect(contents).not.toContain('SYNTHETIC_SECRET')
    expect(contents).not.toContain('SYNTHETIC_USER_PRIVATE')
    expect(JSON.parse(contents.split('\n')[1]).context_breakdown).toEqual({ systemTokens: 16, messageTokens: 22,
      toolTokens: 0, estimated: true, basis: 'hermes-native-request-estimate' })
    expect(contents.split('\n').filter(Boolean).map((value) => JSON.parse(value).phase)).toEqual(['ready', 'request', 'response'])
    expect(JSON.parse(contents.split('\n')[2]).provider).toBe(provider)
  })
})
