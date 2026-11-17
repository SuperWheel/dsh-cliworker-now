import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Explicit synthetic native modules: no installed Hermes imports, credentials,
// network, browser or model. The stub models the reviewed native callback order
// and reentrant lock contract, and makes forbidden broader entry points fail.
const harness = String.raw`
import base64, contextlib, json, os, pathlib, runpy, stat, sys, types
home=pathlib.Path(sys.argv[2]); options=json.loads((home/'options.json').read_text())
events=[]; depths={'auth':0,'shared':0}
def event(value): events.append(value)
@contextlib.contextmanager
def lock(name):
 if name=='shared' and depths['auth']==0: raise AssertionError('shared before auth')
 event(name+':enter:'+str(depths[name])); depths[name]+=1
 try: yield
 finally: depths[name]-=1; event(name+':exit:'+str(depths[name]))
auth=types.ModuleType('hermes_cli.auth')
def load(): return json.loads((home/'auth.json').read_text())
@contextlib.contextmanager
def transaction(provider,timeout_seconds):
 assert provider=='nous' and timeout_seconds==1.0
 with lock('auth'):
  store=load()
  if options.get('race_disabled'): store['credential_pool']['nous'][0]['disabled']=True; save(store)
  yield store,dict(store['providers']['nous']),home/('foreign.json' if options.get('fallback') else 'auth.json')
def save(store):
 (home/'auth.json').write_text(json.dumps(store))
def persist(store,provider,state,source):
 assert depths['auth'] and depths['shared'] and source==home/'auth.json'
 event('save:'+state['refresh_token']); store['providers'][provider]=state; save(store)
def shared_path(): return home/('foreign' if options.get('outside_shared') else 'shared')/'nous_auth.json'
def mirror(state):
 with lock('shared'):
  event('mirror:'+state['refresh_token'])
  if options.get('mirror_failure'): return
  shared_path().parent.mkdir(exist_ok=True)
  shared={'_schema':1,**state}
  if options.get('mirror_contract')=='current' and shared_path().exists():
   held=json.loads(shared_path().read_text())
   def subject(row):
    payload=row['access_token'].split('.')[1]
    return json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))['sub']
   # Simulate native renewal=True: keep another login at the top, or keep
   # another account's nested renewal when updating this top-level login.
   if subject(held)!=subject(state): shared={**held,'renewal':dict(state)}
   elif 'renewal' in held: shared['renewal']=held['renewal']
  shared_path().write_text(json.dumps(shared))
def select(state):
 state['agent_key']=state['access_token']; state['agent_key_expires_at']=state['expires_at']; state['agent_key_id']=None
def refresh(src,*,timeout_seconds,force_refresh,on_state_update):
 assert timeout_seconds==4.0 and force_refresh and depths['auth'] and depths['shared']
 event('refresh'); print('SYNTHETIC_SECRET_OUTPUT'); print('SYNTHETIC_SECRET_ERROR',file=sys.stderr)
 if options.get('system_exit'): raise SystemExit(9)
 if options.get('failure'):
  exc=Exception('SYNTHETIC_SECRET_EXCEPTION'); exc.code=options['failure']; exc.relogin_required=options.get('terminal',False); raise exc
 fresh=json.loads((home/'fresh.json').read_text()); on_state_update(fresh,'post_refresh_access_token')
 if options.get('after_callback'): raise ValueError('SYNTHETIC_SECRET_LATE_ERROR')
 if options.get('cancel_after_callback'):
  import signal; signal.raise_signal(signal.SIGTERM)
 select(fresh); return fresh
auth._provider_state_transaction=transaction; auth._auth_file_path=lambda:home/'auth.json'
auth._nous_shared_store_path=shared_path; auth._nous_shared_store_lock=lambda timeout_seconds=15:lock('shared')
auth._save_provider_state_to_source=persist; auth._write_shared_nous_state=mirror
if options.get('mirror_contract'):
 contract=options['mirror_contract']
 def current_mirror(state, *, renewal):
  assert renewal is True
  event('mirror-renewal')
  if options.get('mirror_type_error'): raise TypeError('SYNTHETIC_SECRET_INTERNAL_ERROR')
  mirror(state)
 def future_mirror(state, *, renewal, unknown):
  raise AssertionError('unknown contract must never run')
 def opaque_mirror(*args, **kwargs):
  raise AssertionError('opaque contract must never run')
 auth._write_shared_nous_state={'current':current_mirror,'future':future_mirror,'opaque':opaque_mirror}[contract]
auth._select_nous_invoke_jwt=select; auth.refresh_nous_oauth_from_state=refresh
def forbidden(*a,**kw): raise AssertionError('forbidden broader native resolver')
auth.resolve_nous_runtime_credentials=forbidden; auth._sync_nous_pool_from_auth_store=forbidden
if options.get('unsupported'): del auth.refresh_nous_oauth_from_state
package=types.ModuleType('hermes_cli'); package.auth=auth
sys.modules['hermes_cli']=package; sys.modules['hermes_cli.auth']=auth
constants=types.ModuleType('hermes_constants'); constants.get_default_hermes_root=lambda: home
sys.modules['hermes_constants']=constants
yaml=types.ModuleType('hermes_yaml'); yaml.safe_load=json.loads
sys.modules['hermes_yaml']=None if options.get('parser_missing') else yaml
# Current official Hermes ships hermes_yaml/ruamel, not PyYAML. A mistaken
# generic yaml import must fail even on a test machine that happens to have it.
sys.modules['yaml']=None
try:
 if options.get('entry'):
  entry=pathlib.Path(sys.argv[1]).with_name('hermes-native-entry.py')
  install=home/'install'; install.mkdir(exist_ok=True); venv=home/'venv'; venv.mkdir(exist_ok=True)
  facts=home/'facts.json'; facts.write_text(json.dumps({'packages':{'venv':{'environment':str(venv)}}}))
  runtime=types.ModuleType('hermes_cli.runtime_state')
  def lease(environment):
   assert environment==venv; event('lease'); return lambda:event('release')
  runtime.lease_generation=lease; sys.modules['hermes_cli.runtime_state']=runtime
  # Native Windows install locking is mocked just like the native lease above.
  # No installed Hermes modules or Windows account state enter this fixture.
  pm=types.ModuleType('pm'); filesystem=types.ModuleType('pm.filesystem')
  def lock_fd(fd,wait):
   assert wait is False and stat.S_ISREG(os.fstat(fd).st_mode); return True
  filesystem.lock_fd=lock_fd; pm.filesystem=filesystem
  sys.modules['pm']=pm; sys.modules['pm.filesystem']=filesystem
  loader=types.ModuleType('hermes_cli.env_loader')
  def dotenv(**kwargs):
   assert kwargs=={'hermes_home':home,'project_env':None,'load_external_secrets':False}; event('own-dotenv')
  loader.load_hermes_dotenv=dotenv; package.env_loader=loader; sys.modules['hermes_cli.env_loader']=loader
  main=types.ModuleType('hermes_cli.main'); main.main=forbidden; sys.modules['hermes_cli.main']=main
  sys.argv=[str(entry),str(install),str(facts),str(venv),options.get('private_flag','--cliworker-nous-refresh'),sys.argv[3]]
  runpy.run_path(str(entry),run_name='__main__')
 else:
  result=runpy.run_path(sys.argv[1])['refresh_selected_nous'](home,sys.argv[3])
  print(json.dumps({'version':1,'state':result}))
finally: (home/'events.json').write_text(json.dumps(events))
`

const roots: string[] = []
const now = Math.floor(Date.now() / 1000)
const portal = 'https://portal.nousresearch.com'
const inference = 'https://inference-api.nousresearch.com/v1'
const helper = resolve('src/host/hermes-nous-refresh.py')
// Windows's python3 App Execution Alias may exist without an interpreter.
// Use the platform's real Python command, and fail explicitly if it cannot run.
const python = process.env.CWN_TEST_PYTHON ?? (process.platform === 'win32' ? 'python.exe' : 'python3')
const token = (exp: number, subject = 'synthetic-subject', client?: string, iat?: number) =>
  `e30.${Buffer.from(JSON.stringify({ sub: subject, org_id: 'synthetic-org', iss: 'synthetic-issuer', exp, scope: 'inference:invoke', ...(client ? { client_id: client } : {}), ...(iat === undefined ? {} : { iat }) })).toString('base64url')}.synthetic`
const digest = (subject = 'synthetic-subject', client = '') =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'hermes-nous-v1',
        subject,
        'synthetic-org',
        'synthetic-issuer',
        client,
        portal,
        inference,
      ]),
    )
    .digest('hex')
function state(exp = now - 10, subject = 'synthetic-subject', refresh = 'synthetic-old-refresh', stamps: { iat?: number; obtained_at?: string | number } = {}) {
  const access = token(exp, subject, undefined, stamps.iat)
  return {
    access_token: access,
    agent_key: access,
    refresh_token: refresh,
    expires_at: new Date(exp * 1000).toISOString(),
    agent_key_expires_at: new Date(exp * 1000).toISOString(),
    scope: 'inference:invoke',
    client_id: 'hermes-cli',
    portal_base_url: portal,
    inference_base_url: inference,
    ...(stamps.obtained_at === undefined ? {} : { obtained_at: stamps.obtained_at }),
  }
}
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cliworker-nous-renewal-synthetic-')))
  roots.push(home)
  const original = state()
  const row = {
    ...original,
    id: 'synthetic-entry',
    source: 'device_code',
    auth_type: 'oauth',
    label: 'synthetic-label',
    priority: 7,
    model_cooldowns: { 'synthetic-model': now - 99 },
    last_status: 'ok',
    extra_metadata: { keep: true },
  }
  const store = {
    version: 1,
    active_provider: 'nous',
    providers: { nous: { ...original, label: 'keep-label', custom: { keep: 1 } }, other: { keep: 2 } },
    credential_pool: {
      nous: [row, { ...row, id: 'synthetic-alias', source: 'manual:device_code' }],
      other: [{ keep: 3 }],
    },
    unrelated: { keep: 4 },
  }
  const fresh = state(now + 3600, 'synthetic-subject', 'synthetic-rotated-refresh')
  function write(name: string, data: unknown) {
    writeFileSync(join(home, name), JSON.stringify(data), { mode: 0o600 })
  }
  write('auth.json', store)
  write('fresh.json', fresh)
  write('options.json', {})
  write('config.yaml', { auth: { adopt_external_logins: false }, model: { provider: 'nous' } })
  writeFileSync(join(home, 'runner.py'), harness)
  function run(options: Record<string, unknown> = {}, expected = digest(), env: Record<string, string> = {}) {
    write('options.json', options)
    const result = spawnSync(python, [join(home, 'runner.py'), helper, home, expected], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        HOME: home,
        HERMES_HOME: home,
        PYTHONDONTWRITEBYTECODE: '1',
        ...env,
      },
    })
    if (result.error) throw new Error(`Synthetic Python runner could not start: ${result.error.code}`)
    if (result.status === 9009) throw new Error('Synthetic Python runner resolved an inactive Windows App Execution Alias')
    return {
      ...result,
      receipt: result.status === 0 ? JSON.parse(result.stdout) : null,
      events: JSON.parse(readFileSync(join(home, 'events.json'), 'utf8')) as string[],
    }
  }
  function share(value: unknown) {
    mkdirSync(join(home, 'shared'), { recursive: true })
    write('shared/nous_auth.json', { _schema: 1, ...(value as object) })
  }
  const read = (name = 'auth.json') => JSON.parse(readFileSync(join(home, name), 'utf8'))
  function select(value: ReturnType<typeof state>) {
    Object.assign(store.providers.nous, value)
    store.credential_pool.nous.forEach((row) => Object.assign(row, value))
    write('auth.json', store)
  }
  return { home, store, fresh, write, run, share, read, select }
}
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('Hermes Nous private renewal (explicit synthetic native fixtures)', () => {
  it.each(['foreign-subject', 'synthetic-subject'])('模拟：优先采用当前主体的嵌套 renewal，顶层主体为 %s', (subject) => {
    const f = fixture()
    const top = { _schema: 1, ...state(now - 100, subject, 'synthetic-top-refresh'), keep: { identity: true } }
    f.share({ ...top, renewal: f.fresh })
    const result = f.run({ mirror_contract: 'current' })
    expect(result.receipt.state).toBe('ready')
    expect(result.events).not.toContain('refresh')
    expect(f.read().providers.nous).toMatchObject({ ...f.fresh, custom: { keep: 1 } })
    expect(f.read().credential_pool.nous.every((row: any) => row.refresh_token === f.fresh.refresh_token)).toBe(true)
    const saved = f.read('shared/nous_auth.json')
    expect(saved.renewal).toMatchObject(f.fresh)
    if (subject === 'foreign-subject') {
      const { renewal: _renewal, ...held } = saved
      expect(held).toEqual(top)
    }
  })
  it.each([false, true])('模拟：嵌套 renewal 续期即时落盘并保留顶层其他身份，后续验证失败=%s', (afterCallback) => {
    const f = fixture()
    const top = { _schema: 1, ...state(now + 7200, 'foreign-subject'), keep: { identity: true } }
    f.share({ ...top, renewal: f.store.providers.nous })
    const result = f.run({ mirror_contract: 'current', after_callback: afterCallback })
    expect(result.receipt.state).toBe(afterCallback ? 'unavailable' : 'ready')
    expect(result.events.filter((event) => event === 'refresh')).toHaveLength(1)
    expect(result.events.indexOf('save:' + f.fresh.refresh_token)).toBeLessThan(result.events.indexOf('mirror:' + f.fresh.refresh_token))
    expect(result.events).toContain('shared:enter:1')
    const { renewal, ...held } = f.read('shared/nous_auth.json')
    expect(held).toEqual(top)
    expect(renewal.refresh_token).toBe(f.fresh.refresh_token)
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
    expect(f.read().credential_pool.nous.every((row: any) => row.refresh_token === f.fresh.refresh_token)).toBe(true)
  })
  it('模拟：修复当前主体的旧嵌套 renewal 后再续期，保留顶层身份', () => {
    const f = fixture()
    const top = { _schema: 1, ...state(now + 7200, 'foreign-subject') }
    f.share({ ...top, renewal: state(now - 100, 'synthetic-subject', 'synthetic-stale-refresh') })
    const result = f.run({ mirror_contract: 'current' })
    expect(result.receipt.state).toBe('ready')
    expect(result.events.indexOf('save:synthetic-old-refresh')).toBeLessThan(result.events.indexOf('refresh'))
    const { renewal, ...held } = f.read('shared/nous_auth.json')
    expect(held).toEqual(top)
    expect(renewal.refresh_token).toBe(f.fresh.refresh_token)
  })
  it.each([false, true])('模拟：其他身份的嵌套 renewal 不遮蔽当前顶层账号，访客=%s', (guest) => {
    const f = fixture()
    const other = guest
      ? { ...state(now + 7200), auth_method: 'anonymous', anon_token: 'synthetic-guest' }
      : state(now + 7200, 'foreign-subject')
    f.share({ ...f.store.providers.nous, renewal: other })
    expect(f.run({ mirror_contract: 'current' }).receipt.state).toBe('ready')
    expect(f.read('shared/nous_auth.json').renewal).toEqual(other)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(f.fresh.refresh_token)
  })
  it.each(['subject', 'client', 'route'])('模拟：嵌套 renewal 的 %s 不匹配时禁止采用或改写', (kind) => {
    const f = fixture()
    const renewed = { ...f.fresh }
    if (kind === 'subject') renewed.access_token = token(now + 3600, 'other-subject')
    if (kind === 'client') renewed.client_id = 'other-client'
    if (kind === 'route') renewed.portal_base_url = 'https://other.example.test'
    f.share({ ...state(now + 7200, 'foreign-subject'), renewal: renewed })
    const shared = f.read('shared/nous_auth.json')
    const result = f.run({ mirror_contract: 'current' })
    expect(result.receipt.state).toBe('changed')
    expect(result.events).not.toContain('refresh')
    expect(f.read()).toEqual(f.store)
    expect(f.read('shared/nous_auth.json')).toEqual(shared)
  })
  it.each([
    { label: 'iat 较新但提前到期', localExp: now + 7200, peerExp: now + 600, local: { iat: now - 60 }, peer: { iat: now - 30 } },
    { label: '相同 exp 按 iat', localExp: now + 600, peerExp: now + 600, local: { iat: now - 60 }, peer: { iat: now - 30 } },
    { label: 'iat 优先于相反的 obtained_at', localExp: now + 7200, peerExp: now + 600, local: { iat: now - 60, obtained_at: now }, peer: { iat: now - 30, obtained_at: now - 100 } },
    { label: '相同 iat 按 obtained_at 小数秒', localExp: now + 7200, peerExp: now + 600, local: { iat: now - 30, obtained_at: now - 20.8 }, peer: { iat: now - 30, obtained_at: now - 20.2 } },
    { label: '无 iat 按 ISO obtained_at', localExp: now + 7200, peerExp: now + 600, local: { obtained_at: new Date((now - 60) * 1000).toISOString() }, peer: { obtained_at: new Date((now - 30) * 1000).toISOString() } },
    { label: '无 iat 按毫秒 obtained_at', localExp: now + 7200, peerExp: now + 600, local: { obtained_at: (now - 60) * 1000 }, peer: { obtained_at: String((now - 30) * 1000) } },
    { label: '均无签发时间时回退 exp', localExp: now + 300, peerExp: now + 600, local: {}, peer: {} },
  ])('模拟：轮换排序 $label，采用共享令牌且不重复兑换', ({ localExp, peerExp, local, peer }) => {
    const f = fixture()
    f.select(state(localExp, 'synthetic-subject', 'synthetic-local-refresh', local))
    const newer = state(peerExp, 'synthetic-subject', 'synthetic-peer-refresh', peer)
    f.share(newer)
    const result = f.run({ mirror_contract: 'current' })
    expect(result.receipt.state).toBe('ready')
    expect(result.events).not.toContain('refresh')
    expect(f.read().providers.nous).toMatchObject(newer)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(newer.refresh_token)
  })
  it('模拟：iat 较旧但较晚到期的共享副本由本地较新轮换修复', () => {
    const f = fixture()
    const newer = state(now + 600, 'synthetic-subject', 'synthetic-local-refresh', { iat: now - 30 })
    f.select(newer)
    f.share(state(now + 7200, 'synthetic-subject', 'synthetic-peer-refresh', { iat: now - 60 }))
    const result = f.run({ mirror_contract: 'current' })
    expect(result.receipt.state).toBe('ready')
    expect(result.events).not.toContain('refresh')
    expect(f.read().providers.nous).toMatchObject(newer)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(newer.refresh_token)
  })
  it.each([{ iat: now - 30 }, { obtained_at: now - 30 }])('模拟：相同签发时间 %j 不以不同 exp 判定轮换', (stamps) => {
    const f = fixture()
    f.select(state(now + 600, 'synthetic-subject', 'synthetic-local-refresh', stamps))
    f.share(state(now + 7200, 'synthetic-subject', 'synthetic-peer-refresh', stamps))
    const shared = f.read('shared/nous_auth.json')
    expect(f.run({ mirror_contract: 'current' }).receipt.state).toBe('changed')
    expect(f.read()).toEqual(f.store)
    expect(f.read('shared/nous_auth.json')).toEqual(shared)
  })
  it.each([false, true])('模拟 Hermes 0.23.1 必需 renewal 参数，含旧共享镜像恢复=%s', (staleMirror) => {
    const f = fixture()
    if (staleMirror) f.share(state(now - 100, 'synthetic-subject', 'synthetic-older-refresh'))
    const result = f.run({ entry: true, mirror_contract: 'current' })
    expect(result.receipt).toEqual({ version: 1, state: 'ready' })
    expect(result.stderr).toBe('')
    expect(result.events.filter((x) => x === 'refresh')).toHaveLength(1)
    expect(result.events).toContain('mirror-renewal')
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(f.fresh.refresh_token)
    expect(f.read().credential_pool.nous[0]).toMatchObject({ label: 'synthetic-label', priority: 7 })
  })
  it.each(['future', 'opaque'])('模拟未知共享写入签名 %s 在任何兑换或写入前拒绝', (contract) => {
    const f = fixture()
    f.share(state(now - 100, 'synthetic-subject', 'synthetic-older-refresh'))
    const shared = f.read('shared/nous_auth.json')
    const result = f.run({ mirror_contract: contract })
    expect(result.receipt).toEqual({ version: 1, state: 'unsupported' })
    expect(result.events).toEqual([])
    expect(f.read()).toEqual(f.store)
    expect(f.read('shared/nous_auth.json')).toEqual(shared)
  })
  it('模拟共享写入内部 TypeError 不降级重试，保留已经落盘的轮换', () => {
    const f = fixture()
    const result = f.run({ mirror_contract: 'current', mirror_type_error: true })
    expect(result.receipt.state).toBe('unavailable')
    expect(result.stderr).toBe('')
    expect(result.events.filter((x) => x === 'refresh')).toHaveLength(1)
    expect(result.events.filter((x) => x === 'mirror-renewal')).toHaveLength(1)
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
    expect(f.read().credential_pool.nous.every((row: any) => row.refresh_token === f.fresh.refresh_token)).toBe(true)
  })
  it('uses the official parser without importing an absent PyYAML package', () => {
    const f = fixture()
    const result = f.run({ entry: true })
    expect(result.receipt).toEqual({ version: 1, state: 'ready' })
    expect(result.stderr).toBe('')
  })
  it('returns only a safe classification when the native parser is missing', () => {
    const f = fixture()
    const result = f.run({ entry: true, parser_missing: true })
    expect(result.receipt).toEqual({ version: 1, state: 'unavailable' })
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('{"version":1,"state":"unavailable"}')
    expect(result.events).not.toContain('refresh')
    expect(f.read()).toEqual(f.store)
  })
  it('honors a process-only early-renewal threshold without changing configuration', () => {
    const f = fixture()
    const almost = state(now + 600)
    Object.assign(f.store.providers.nous, almost)
    f.store.credential_pool.nous.forEach((row) => Object.assign(row, almost))
    f.write('auth.json', f.store)
    const config = f.read('config.yaml')
    const result = f.run({}, digest(), { HERMES_NOUS_MIN_KEY_TTL_SECONDS: '1200' })
    expect(result.receipt.state).toBe('ready')
    expect(result.events.filter((x) => x === 'refresh')).toHaveLength(1)
    expect(f.read('config.yaml')).toEqual(config)
  })
  it('renews once, persists rotation immediately and preserves account/pool metadata', () => {
    const f = fixture()
    f.share(f.store.providers.nous)
    const result = f.run()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.receipt).toEqual({ version: 1, state: 'ready' })
    expect(result.events.filter((x) => x === 'refresh')).toHaveLength(1)
    expect(result.events).toContain('shared:enter:1')
    const saved = f.read()
    expect(saved.unrelated).toEqual(f.store.unrelated)
    expect(saved.providers.other).toEqual(f.store.providers.other)
    expect(saved.providers.nous).toMatchObject({ ...f.fresh, custom: { keep: 1 }, label: 'keep-label' })
    saved.credential_pool.nous.forEach((row: any, index: number) => {
      expect(row).toMatchObject({
        ...f.fresh,
        id: f.store.credential_pool.nous[index]!.id,
        priority: 7,
        extra_metadata: { keep: true },
        last_status: 'ok',
        model_cooldowns: { 'synthetic-model': now - 99 },
      })
    })
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(f.fresh.refresh_token)
  })
  it('retains rotated token in both stores and aliases when later native validation fails', () => {
    const f = fixture()
    const result = f.run({ after_callback: true })
    expect(result.receipt.state).toBe('unavailable')
    expect(result.stderr).toBe('')
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
    expect(
      f.read().credential_pool.nous.every((row: any) => row.refresh_token === f.fresh.refresh_token),
    ).toBe(true)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(f.fresh.refresh_token)
  })
  it('does not refresh or rewrite a healthy selected token', () => {
    const f = fixture()
    f.store.providers.nous = { ...f.store.providers.nous, ...f.fresh }
    f.store.credential_pool.nous = f.store.credential_pool.nous.map((row) => ({ ...row, ...f.fresh }))
    f.write('auth.json', f.store)
    const result = f.run()
    expect(result.receipt.state).toBe('ready')
    expect(result.events).not.toContain('refresh')
    expect(f.read()).toEqual(f.store)
  })
  it('adopts only a newer same-identity shared rotation without spending it again', () => {
    const f = fixture()
    f.share(f.fresh)
    const result = f.run()
    expect(result.receipt.state).toBe('ready')
    expect(result.events).not.toContain('refresh')
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
  })
  it('repairs an older same-identity shared mirror instead of rolling back', () => {
    const f = fixture()
    f.share(state(now - 100, 'synthetic-subject', 'synthetic-older-refresh'))
    const result = f.run()
    expect(result.receipt.state).toBe('ready')
    expect(result.events.filter((x) => x === 'refresh')).toHaveLength(1)
    expect(f.read('shared/nous_auth.json').refresh_token).toBe(f.fresh.refresh_token)
  })
  it.each(['subject', 'client', 'route', 'equal-expiry'])(
    'rejects unproven shared %s before rotation or writes',
    (kind) => {
      const f = fixture()
      const shared: any =
        kind === 'equal-expiry'
          ? state(now - 10, 'synthetic-subject', 'synthetic-different-grant')
          : { ...f.fresh }
      if (kind === 'subject') shared.access_token = token(now + 3600, 'foreign-subject')
      if (kind === 'client') shared.client_id = 'foreign-client'
      if (kind === 'route') shared.portal_base_url = 'https://outside.example.test'
      f.share(shared)
      const result = f.run()
      expect(result.receipt.state).toBe('changed')
      expect(result.events).not.toContain('refresh')
      expect(f.read()).toEqual(f.store)
    },
  )
  it.each(['invalid_grant', 'invalid_token', 'refresh_token_reused'])(
    'classifies terminal %s without deleting credentials',
    (failure) => {
      const f = fixture()
      const result = f.run({ failure, terminal: true })
      expect(result.receipt.state).toBe('relogin')
      expect(f.read()).toEqual(f.store)
      expect(result.stderr).toBe('')
    },
  )
  it.each(['temporarily_unavailable', 'upstream_blocked', 'timeout'])(
    'keeps temporary %s separate from relogin',
    (failure) => {
      const f = fixture()
      expect(f.run({ failure }).receipt.state).toBe('unavailable')
      expect(f.read()).toEqual(f.store)
    },
  )
  it.each(['disabled', 'dead', 'exhausted', 'cooldown'])(
    'does not renew blocked %s rows and preserves them',
    (kind) => {
      const f = fixture()
      const row: any = f.store.credential_pool.nous[0]
      if (kind === 'disabled') row.disabled = true
      if (kind === 'dead') row.last_status = 'dead'
      if (kind === 'exhausted') {
        row.last_status = 'exhausted'
        row.last_error_reset_at = now + 300
      }
      if (kind === 'cooldown') row.model_cooldowns = { 'synthetic-model': now + 300 }
      f.write('auth.json', f.store)
      const result = f.run()
      expect(result.receipt.state).toBe('unavailable')
      expect(result.events).not.toContain('refresh')
      expect(f.read()).toEqual(f.store)
    },
  )
  it('rechecks availability under the native lock', () => {
    const f = fixture()
    const result = f.run({ race_disabled: true })
    expect(result.receipt.state).toBe('unavailable')
    expect(result.events).not.toContain('refresh')
  })
  it('ignores an old terminal marker when credentials have since been restored', () => {
    const f = fixture()
    Object.assign(f.store.providers.nous, { last_auth_error: { relogin_required: true } })
    f.write('auth.json', f.store)
    expect(f.run().receipt.state).toBe('ready')
  })
  it.each([{ fallback: true }, { outside_shared: true }])('rejects nonselected storage %j', (options) => {
    const f = fixture()
    const result = f.run(options)
    expect(result.receipt.state).toBe('changed')
    expect(result.events).not.toContain('refresh')
    expect(f.read()).toEqual(f.store)
  })
  it('refuses unsupported native capability and a mismatched expected principal', () => {
    const f = fixture()
    expect(f.run({ unsupported: true }).receipt.state).toBe('unsupported')
    expect(f.run({}, digest('other-subject')).receipt.state).toBe('changed')
  })
  it('does not swallow SystemExit', () => {
    const f = fixture()
    const result = f.run({ system_exit: true })
    expect(result.status).toBe(9)
    expect(result.receipt).toBeNull()
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
  it('defers cancellation through rotated-token persistence', () => {
    const f = fixture()
    const result = f.run({ cancel_after_callback: true })
    expect(result.receipt.state).toBe('unavailable')
    expect(f.read().providers.nous.refresh_token).toBe(f.fresh.refresh_token)
  })
  it('fails closed on wrong identity returned by the native endpoint', () => {
    const f = fixture()
    f.write('fresh.json', state(now + 3600, 'unexpected-subject'))
    expect(f.run().receipt.state).toBe('changed')
    expect(f.read()).toEqual(f.store)
  })
  it('requires reauthentication when an expired selected identity has no refresh token', () => {
    const f = fixture()
    delete (f.store.providers.nous as any).refresh_token
    f.store.credential_pool.nous.forEach((row) => delete (row as any).refresh_token)
    f.write('auth.json', f.store)
    expect(f.run().receipt.state).toBe('relogin')
  })
  it('allows missing native client_id to normalize to the official default', () => {
    const f = fixture()
    delete (f.store.providers.nous as any).client_id
    f.store.credential_pool.nous.forEach((row) => delete (row as any).client_id)
    f.write('auth.json', f.store)
    expect(f.run().receipt.state).toBe('ready')
  })
  it('uses only the selected configuration and bounded private files', () => {
    const f = fixture()
    f.write('config.yaml', { model: { provider: 'other' } })
    expect(f.run().receipt.state).toBe('changed')
    f.write('config.yaml', { auth: { adopt_external_logins: false }, model: { provider: 'nous' } })
    mkdirSync(join(f.home, 'shared'))
    symlinkSync(join(f.home, 'auth.json'), join(f.home, 'shared', 'nous_auth.json'))
    expect(f.run().receipt.state).toBe('changed')
  })
  it('enters the fixed helper only after the native lease and own dotenv boundary', () => {
    const f = fixture()
    const result = f.run({ entry: true })
    expect(result.receipt).toEqual({ version: 1, state: 'ready' })
    expect(result.stderr).toBe('')
    expect(result.events.slice(0, 2)).toEqual(['lease', 'own-dotenv'])
    expect(result.events.at(-1)).toBe('release')
  })
  it('never dispatches an unknown private operation to native main', () => {
    const f = fixture()
    const result = f.run({ entry: true, private_flag: '--cliworker-unknown' })
    expect(result.receipt).toEqual({ version: 1, state: 'unsupported' })
    expect(result.stderr).toBe('')
    expect(result.events).toEqual(['lease', 'release'])
  })
})
