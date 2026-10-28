import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  stat,
  symlink,
  link,
  unlink,
  readdir,
  chmod,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { preparePiOmp, discoverPiOmp, type PiOmpInput, type PiOmpCli } from '../src/host/pi-omp-adapter.ts'
import { extendedCatalog, extendedLaunch } from '../src/host/extended-adapters.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'
import { createNativeHarnessTools } from '../src/host/native-harness-tools.ts'
import { HARNESS_CONNECTION_ENV } from '../src/host/native-harness-mcp.mjs'
import { nativeHarnessExtensionToolName } from '../src/host/native-harness-extension.mjs'

const exec = promisify(execFile)
const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  vi.unstubAllEnvs()
})
const fixtureKey = 'SYNTHETIC_TEST_KEY_NOT_A_CREDENTIAL'
const fixtureEnvironment = (home: string | undefined, env: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  ...(process.platform === 'win32'
    ? { SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot ?? '' }
    : {}),
  HOME: home ?? '/private/tmp',
  LANG: 'C',
  ...env,
})
async function fixture(cli: PiOmpCli, scenario = 'success', version = '1.0.2') {
  const root = await mkdtemp(join(tmpdir(), 'cliworker-rpc-fixture-'))
  roots.push(root)
  const project = join(root, 'project'),
    stateDirectory = join(root, 'state'),
    executable = join(root, 'dist/cli.js')
  await mkdir(project)
  await mkdir(join(root, 'dist/core'), { recursive: true })
  const provider =
    scenario === 'non-glm' || scenario === 'wrong-model' || scenario === 'no-reasoning'
      ? 'fixture-native'
      : cli === 'pi'
        ? 'zai-coding-cn'
        : 'cliworker-zai-cn'
  const modelId = provider === 'fixture-native' ? 'native-chat' : 'glm-5.3-flash'
  const model = {
    provider,
    id: modelId,
    name: provider === 'fixture-native' ? 'Native fixture chat' : 'GLM-5.3-Flash',
    ...(scenario === 'no-reasoning'
      ? { reasoning: false }
      : {
          reasoning: true,
          thinkingLevelMap: { low: 'low', high: 'high', max: 'max' },
          thinking: { efforts: ['low', 'high', 'max'] },
        }),
  }
  const extra = {
    provider: 'second-native',
    id: 'other-chat',
    name: 'Other native fixture',
    reasoning: true,
    thinkingLevelMap: { medium: 'medium' },
    thinking: { efforts: ['medium'] },
  }
  const catalog =
    scenario === 'switch' || scenario === 'multi'
      ? [model, extra, { provider: 'plain', id: 'chat', name: 'Plain fixture', reasoning: false }]
      : [model]
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/models') {
      response.writeHead(405).end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: catalog.map((model) => ({ id: model.id })) }))
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address() as { port: number }
  const account = join(stateDirectory, 'accounts', cli, 'agent')
  await mkdir(account, { recursive: true, mode: 0o700 })
  const providers = Object.fromEntries(
    [...new Set(catalog.map((model) => model.provider))].map((provider) => [
      provider,
      {
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'FIXTURE_API_KEY',
        models: catalog.filter((model) => model.provider === provider),
      },
    ]),
  )
  await writeFile(join(account, cli === 'pi' ? 'models.json' : 'models.yml'), JSON.stringify({ providers }), {
    mode: 0o600,
  })
  await writeFile(join(account, '.env'), `FIXTURE_API_KEY=${fixtureKey}\n`, { mode: 0o600 })
  await writeFile(
    join(root, 'dist/core/auth-storage.js'),
    'export class AuthStorage { static inMemory(value) { return value } }',
  )
  await writeFile(
    join(root, 'dist/index.js'),
    '// SIMULATED SDK package marker; this suite does not invoke login.\n',
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', name: '@earendil-works/pi-coding-agent', version }),
  )
  await writeFile(
    join(root, 'dist/core/model-runtime.js'),
    `// SIMULATED SDK, no model/network.\nexport class ModelRuntime { static async create() { return new ModelRuntime() } getError() { return undefined } getAvailableSnapshot() { return ${JSON.stringify(catalog)} } }`,
  )
  // Explicitly simulated native RPC process; it never accesses a model/network.
  await writeFile(
    executable,
    `
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {createInterface} from 'node:readline';
const cli=${JSON.stringify(cli)},scenario=${JSON.stringify(scenario)},marker=${JSON.stringify(join(root, 'native-stopped'))};
const provider=${JSON.stringify(provider)},modelId=${JSON.stringify(modelId)},agent=process.env.PI_CODING_AGENT_DIR;
if(process.argv.includes('models')){
if(scenario==='catalog-cancel'){writeFileSync(${JSON.stringify(join(root, 'catalog-pid'))},String(process.pid));writeFileSync(${JSON.stringify(join(root, 'catalog-started'))},'STARTED');setInterval(()=>{},1000);process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync(marker,'STOPPED');process.exit(143)},80));}
else if(scenario==='catalog-refresh'&&!process.argv.includes('refresh')){process.stdout.write('[]');process.exit(0);}
else if(scenario==='catalog-refresh'){writeFileSync(join(agent,'refreshed-model-registry.json'),JSON.stringify(${JSON.stringify(catalog)}));process.stdout.write(JSON.stringify(${JSON.stringify(catalog)}));process.exit(0);}
else if(scenario==='secret-model-error'){process.stdout.write('{SYNTHETIC_TEST_KEY_NOT_A_CREDENTIAL');process.exit(0);}
else{process.stdout.write(JSON.stringify(${JSON.stringify(catalog)}));process.exit(0);}
}
else {
if(scenario==='catalog-refresh'&&!existsSync(join(agent,'refreshed-model-registry.json')))process.exit(3);
mkdirSync(join(agent,'sessions'),{recursive:true});
let path=join(agent,'sessions','fixture.jsonl'),nativeSessionId='fixture-id';const resumed=process.argv.includes(cli==='pi'?'--session':'--resume');
if(resumed){const flag=cli==='pi'?'--session':'--resume';path=process.argv[process.argv.indexOf(flag)+1];if(path.endsWith('fixture-fork.jsonl'))nativeSessionId='fixture-fork-id';if(!existsSync(path))process.exit(2);}
writeFileSync(path,'SIMULATED SESSION\\n',{mode:0o600});
writeFileSync(join(agent,'observed-argv.json'),JSON.stringify(process.argv.slice(2)),{mode:0o600});
let model=${JSON.stringify(model)},thinkingLevel=scenario==='no-reasoning'?'off':'low',streaming=false,steers=[],steerIds=[];
writeFileSync(join(agent,'observed-auth.json'),JSON.stringify({cnPresent:!!process.env.ZAI_CODING_CN_API_KEY,nativeFixture:process.env.ZHIPU_API_KEY==='SYNTHETIC_NATIVE_PROVIDER_ENV',unexpectedNativeKey:!!process.env.ZHIPU_API_KEY&&process.env.ZHIPU_API_KEY!=='SYNTHETIC_NATIVE_PROVIDER_ENV'&&process.env.ZHIPU_API_KEY!==${JSON.stringify(fixtureKey)}}),{mode:0o600});
const state=()=>({sessionId:scenario==='identity'&&resumed?'changed':nativeSessionId,sessionFile:path,model:scenario==='wrong-model'?{...model,id:'changed-native-model'}:model,thinkingLevel,isStreaming:streaming,pendingMessageCount:0});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const finishSteer=()=>{streaming=false;send({type:'message_end',message:{role:'assistant',provider:model.provider,model:model.id,content:[{type:'text',text:'GUIDED'}],stopReason:'stop'}});send({type:'agent_end'});if(cli==='pi')send({type:'agent_settled'})};
if(cli==='omp')send({type:'ready'});
const input=createInterface({input:process.stdin});
input.on('line',line=>{const cmd=JSON.parse(line);if(cmd.type==='get_state'){send({id:cmd.id,type:'response',command:cmd.type,success:true,data:state()});return}
if(cmd.type==='clone'){nativeSessionId='fixture-fork-id';path=join(agent,'sessions','fixture-fork.jsonl');writeFileSync(path,'SIMULATED CLONED SESSION\\n',{mode:0o600});writeFileSync(join(agent,'clone-observed.json'),'clone');send({id:cmd.id,type:'response',command:'clone',success:true,data:{cancelled:false}});return}
if(cmd.type==='get_session_stats'){if(scenario==='usage-timeout')return;send({id:cmd.id,type:'response',command:cmd.type,success:scenario!=='usage-unavailable',data:{tokens:{input:7,output:3,cacheRead:2,cacheWrite:1,total:13},contextUsage:{tokens:10,contextWindow:128000,percent:0.0078125},sessionFile:'PRIVATE_PATH_MUST_NOT_LEAK'}});return}
if(cmd.type==='set_model'){model={provider:cmd.provider,id:cmd.modelId};send({id:cmd.id,type:'response',command:cmd.type,success:true,data:model});return}
if(cmd.type==='set_thinking_level'){thinkingLevel=cmd.level;send({id:cmd.id,type:'response',command:cmd.type,success:true});return}
if(cmd.type==='get_available_models'){send({id:cmd.id,type:'response',command:cmd.type,success:true,data:{models:[model]}});return}
if(cmd.type==='abort'){writeFileSync(${JSON.stringify(join(root, 'native-aborted'))},'ABORT');send({id:cmd.id,type:'response',command:'abort',success:true});return}
if(cmd.type==='steer'){
steers.push(cmd.message);writeFileSync(join(agent,'observed-steers.json'),JSON.stringify(steers));
steerIds.push(cmd.id);writeFileSync(join(agent,'observed-steer-ids.json'),JSON.stringify(steerIds));
if(scenario==='steer-close'){process.exit(1);return}
if(scenario==='steer-race'){finishSteer();setTimeout(()=>send({id:cmd.id,type:'response',command:'steer',success:true}),30);return}
const rejected=scenario==='steer-reject'||(scenario==='steer-retry'&&steers.length===1);
send({id:cmd.id,type:'response',command:'steer',success:!rejected,...(rejected?{error:'SIMULATED REFUSAL'}:cli==='pi'?{data:{disposition:'queued'}}:{})});
if(scenario==='steer-retry'&&rejected)return;
setTimeout(finishSteer,80);return}
if(cmd.type==='prompt'){
streaming=true;
send({id:cmd.id,type:'response',command:'prompt',success:true});send({type:'message_start',message:{role:'assistant'}});
send({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'SECRET_REASONING_FIXTURE'}});
if(scenario==='public-thinking'){
send({type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:0,delta:'模拟公开',partial:{content:[{thinkingSignature:'OPAQUE_SIGNATURE'}]}}});
send({type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:0,delta:'过程'}});
send({type:'message_update',assistantMessageEvent:{type:'thinking_end',contentIndex:0,content:'模拟公开过程（完成）'}});
send({type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:2,delta:'REDACTED_TEXT',partial:{content:[null,null,{redacted:true,thinkingSignature:'OPAQUE_SIGNATURE'}]}}});
}
for(const delta of scenario==='fragmented'?['H','E','L','L','O']:[resumed?'RESUMED':'HELLO'])send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta}});
if(scenario==='cancel'||scenario.startsWith('steer-'))return;
if(scenario==='tool-error'||scenario==='tool-recovered'){send({type:'tool_execution_start',toolCallId:'t',toolName:'write'});send({type:'tool_execution_end',toolCallId:'t',toolName:'write',isError:true,result:{content:[{type:'text',text:'denied'}]}})}
if(scenario==='tool-recovered'){send({type:'tool_execution_start',toolCallId:'retry',toolName:'edit'});send({type:'tool_execution_end',toolCallId:'retry',toolName:'edit',isError:false,result:{content:[{type:'text',text:'edited'}]}})}
if(scenario==='malformed'){process.stdout.write('not-json\\n');return}
streaming=false;send({type:'message_end',message:{role:'assistant',provider:model.provider,model:model.id,content:scenario==='public-thinking'?[{type:'thinking',thinking:'模拟公开过程（权威快照）',thinkingSignature:'OPAQUE_SIGNATURE'},{type:'text',text:'HELLO'},{type:'thinking',thinking:'REDACTED_TEXT',redacted:true,thinkingSignature:'OPAQUE_SIGNATURE'},{type:'redactedThinking',data:'ENCRYPTED_DATA'},{type:'thinking',thinking:'模拟仅完成时提供'}]:[{type:'text',text:resumed?'RESUMED':'HELLO'}],stopReason:'stop'}});
send({type:'agent_end'});if(cli==='pi'&&scenario!=='unsettled')send({type:'agent_settled'});
if(scenario==='unsettled')setTimeout(()=>process.exit(0),20);
}});
input.on('close',()=>{if(scenario!=='cancel')process.exit(0)});
process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync(marker,'STOPPED');process.exit(143)},80));
}
`,
  )
  const input: PiOmpInput = {
    cli,
    executable,
    project,
    stateDirectory,
    nativeHome: root,
    accountRoot: stateDirectory,
    preference: {
      model: `${provider}/${modelId}`,
      effort: scenario === 'no-reasoning' ? 'default' : 'low',
    },
    mode: 'plan',
    prompt: 'literal $(do not execute)',
  }
  return { root, input }
}
async function launch(input: PiOmpInput) {
  try {
    const prepared = await prepareConfirmed(input)
    const result = await exec(prepared.argv[0]!, prepared.argv.slice(1), {
      env: fixtureEnvironment(input.nativeHome, prepared.env),
      timeout: 10000,
    })
    return {
      code: 0,
      frames: result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      stdout: result.stdout,
    }
  } catch (error: any) {
    if (String(error.message).includes('symlink')) throw error
    if (!error.stdout) {
      const frame = {
        type: 'result',
        status: 'ERROR',
        response: '',
        error: '无法读取 Pi/OMP 原生模型目录，请检查本机配置',
      }
      return { code: 1, frames: [frame], stdout: JSON.stringify(frame) }
    }
    return {
      code: error.code,
      frames: error.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => JSON.parse(line)),
      stdout: error.stdout,
    }
  }
}
async function prepareConfirmed(input: PiOmpInput) {
  return preparePiOmp(
    input,
    async (argv, env) =>
      (
        await exec(argv[0]!, argv.slice(1), {
          env: fixtureEnvironment(input.nativeHome, env),
          timeout: 10000,
        })
      ).stdout,
  )
}
describe('Pi/OMP bridge with simulated native RPC processes', () => {
  it('Pi explicitly whitelists run tools without persisting the connection', async () => {
    const cli = 'pi'
    const { input } = await fixture(cli)
    // Provider snapshots must never override the Host's per-run capability.
    await writeFile(join(input.accountRoot!, 'accounts', cli, 'agent/.env'), `FIXTURE_API_KEY=${fixtureKey}\nCLIWORKER_HARNESS_TOOLS=UNTRUSTED_ACCOUNT_VALUE\n`, { mode: 0o600 })
    const bridge = await createNativeHarnessTools({ binding: { parentSessionId: 'simulated-parent', harnessSessionId: 'simulated-child', workerId: 'simulated-worker', runId: 'simulated-run', cli },
      tools: [{ name: 'simulated_tool', description: 'Synthetic only', inputSchema: { type: 'object' }, execution: 'host' }], authorize() {}, execute: async () => 'synthetic', executionReady: true })
    let prepared: Awaited<ReturnType<typeof prepareConfirmed>> | undefined
    try {
      prepared = await prepareConfirmed({ ...input, harnessTools: bridge.connection })
      const requestText = await readFile(prepared.argv[2]!, 'utf8'), request = JSON.parse(requestText)
      expect(requestText).not.toContain(bridge.connection.token)
      expect(prepared.env?.[HARNESS_CONNECTION_ENV]).toBe(JSON.stringify(bridge.connection))
      await exec(prepared.argv[0]!, prepared.argv.slice(1), { env: fixtureEnvironment(input.nativeHome, prepared.env), timeout: 10000 })
      const argv = JSON.parse(await readFile(join(request.stateDirectory, 'agent/observed-argv.json'), 'utf8'))
      expect(argv).toContain('--no-extensions')
      expect(argv[argv.indexOf('--extension') + 1]).toMatch(/native-harness-extension\.mjs$/u)
      expect(argv[argv.indexOf('--tools') + 1].split(',')).toContain(nativeHarnessExtensionToolName('simulated_tool'))
      expect(await readFile(join(request.stateDirectory, 'agent/native-env.json'), 'utf8')).not.toContain(bridge.connection.token)
    } finally { await prepared?.cleanup(); await bridge.close() }
  })
  it.each(['pi', 'omp'] as const)('%s folds token-sized updates into the native message identity', async (cli) => {
    const { input } = await fixture(cli, 'fragmented')
    const result = await launch(input)
    expect(result.code).toBe(0)
    const replies = foldNativeFrames(result.frames).filter((row) => row.kind === 'assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.text).toBe('HELLO')
  })
  it.each(['pi', 'omp'] as const)(
    '%s accepts native guidance once without restarting its process',
    async (cli) => {
      const { input } = await fixture(cli, 'steer-accept')
      const prepared = await prepareConfirmed(input)
      expect(prepared.steer).toBeTypeOf('function')
      const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
        env: fixtureEnvironment(input.nativeHome, prepared.env),
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      const done = new Promise<number | null>((resolve) => child.once('close', resolve))
      try {
        await vi.waitFor(() => expect(stdout).toContain('HELLO'), { timeout: 5000 })
        await Promise.all([
          prepared.steer!('SIMULATED GUIDE', 'guide-1'),
          prepared.steer!('SIMULATED GUIDE', 'guide-1'),
        ])
        expect(await done).toBe(0)
        const frames = stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(frames.filter((frame) => frame.type === 'session')).toHaveLength(1)
        expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
        const requestRoot = dirname(prepared.argv.at(-1)!)
        const configRoot = dirname(requestRoot)
        const commands = JSON.parse(
          await readFile(join(configRoot, 'agent', 'sessions', '../observed-steers.json'), 'utf8'),
        )
        expect(commands).toEqual(['SIMULATED GUIDE'])
        await expect(prepared.steer!('LATE GUIDE', 'guide-2')).rejects.toThrow('关闭')
      } finally {
        child.kill('SIGTERM')
        await done
        await prepared.cleanup()
      }
    },
  )

  it.each(['steer-reject', 'steer-race', 'steer-close'])(
    'native guidance %s never reports successful delivery or hides the original run outcome',
    async (scenario) => {
      const { input } = await fixture('pi', scenario)
      const prepared = await prepareConfirmed(input)
      const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
        env: fixtureEnvironment(input.nativeHome, prepared.env),
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      const done = new Promise<number | null>((resolve) => child.once('close', resolve))
      try {
        await vi.waitFor(() => expect(stdout).toContain('HELLO'), { timeout: 5000 })
        const error = await prepared.steer!('SIMULATED GUIDE', scenario).catch((error) => error)
        expect(error).toBeInstanceOf(Error)
        expect(error.code).toBe(scenario === 'steer-reject' ? 'STEER_REJECTED' : undefined)
        expect(await done).toBe(scenario === 'steer-close' ? 1 : 0)
        expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({
          status: scenario === 'steer-close' ? 'ERROR' : 'SUCCESS',
        })
      } finally {
        child.kill('SIGTERM')
        await done
        await prepared.cleanup()
      }
    },
  )

  it('retries definite native guidance rejection with a fresh native request id', async () => {
    const { input } = await fixture('pi', 'steer-retry')
    const prepared = await prepareConfirmed(input)
    const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
      env: fixtureEnvironment(input.nativeHome, prepared.env),
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    const done = new Promise<number | null>((resolve) => child.once('close', resolve))
    try {
      await vi.waitFor(() => expect(stdout).toContain('HELLO'), { timeout: 5000 })
      await expect(prepared.steer!('SIMULATED RETRY', 'same-request')).rejects.toMatchObject({
        code: 'STEER_REJECTED',
      })
      await expect(prepared.steer!('SIMULATED RETRY', 'same-request')).resolves.toBeUndefined()
      expect(await done).toBe(0)
      const requestRoot = dirname(dirname(prepared.argv.at(-1)!))
      const ids = JSON.parse(await readFile(join(requestRoot, 'agent/observed-steer-ids.json'), 'utf8'))
      expect(ids).toHaveLength(2)
      expect(ids[0]).not.toBe(ids[1])
    } finally {
      child.kill('SIGTERM')
      await done
      await prepared.cleanup()
    }
  })

  it.each(['pi', 'omp'] as const)(
    '%s publishes visible thinking snapshots without opaque or redacted fields',
    async (cli) => {
      const { input } = await fixture(cli, 'public-thinking')
      const result = await launch(input)
      expect(result.code).toBe(0)
      const events = result.frames
        .filter((frame) => frame.type === 'event')
        .map((frame, index) => ({
          ...frame.event,
          seq: index + 1,
          runId: 'synthetic',
          time: '',
        })) as WorkerEvent[]
      const thoughts = foldEvents(events).filter((row) => row.kind === 'reasoning' && row.detail)
      expect(thoughts.map((row) => row.detail)).toEqual(['模拟公开过程（权威快照）', '模拟仅完成时提供'])
      expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
      expect(result.stdout).not.toMatch(
        /OPAQUE_SIGNATURE|REDACTED_TEXT|ENCRYPTED_DATA|SECRET_REASONING_FIXTURE/,
      )
    },
  )
  it.each(['1.0.2', '1.0.4'])(
    'Pi %s discovers and executes through the same SDK and native RPC package',
    async (version) => {
      const { input } = await fixture('pi', 'non-glm', version)
      const catalog = await discoverPiOmp(
        'pi',
        input.executable,
        async (argv, env) =>
          (await exec(argv[0]!, argv.slice(1), { env: fixtureEnvironment(input.nativeHome, env) })).stdout,
        input.stateDirectory,
        { nativeHome: input.nativeHome, accountRoot: input.accountRoot },
      )
      expect(catalog.map((model) => model.id)).toContain(input.preference.model)
      const run = await launch(input)
      expect(run.code).toBe(0)
      expect(run.frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS' })
    },
  )
  it('uses native arguments for SDK discovery and account metadata on the same managed OMP snapshot', async () => {
    const { root, input } = await fixture('omp', 'non-glm')
    vi.stubEnv('HOME', root)
    if (process.platform === 'win32') vi.stubEnv('USERPROFILE', root)
    const nativePrograms: string[] = []
    const phases: string[] = []
    const states: string[] = []
    const outputs: unknown[] = []
    const models = await extendedCatalog(
      'omp',
      input.executable,
      async (argv, env) => {
        expect(argv[0]).toBe(process.execPath)
        expect(argv[1]).toMatch(/private-launch[.]mjs$/)
        expect(argv.join(' ')).not.toMatch(/sandbox-exec|\(deny |\(allow /)
        nativePrograms.push(argv[2]!)
        const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
        phases.push(request.metadataPhase)
        states.push(request.stateDirectory)
        const result = await exec(argv[0]!, argv.slice(1), {
          env: fixtureEnvironment(root, env),
          timeout: 10000,
        })
        outputs.push(JSON.parse(result.stdout))
        const candidatesPath = join(request.stateDirectory, 'agent', 'catalog-candidates.json')
        if (process.platform !== 'win32') expect((await stat(candidatesPath)).mode & 0o777).toBe(0o600)
        expect(
          (await readFile(candidatesPath, 'utf8')).includes('SYNTHETIC_HOST_REFERENCE_MUST_STAY_IN_ENV'),
        ).toBe(false)
        return result.stdout
      },
      input.stateDirectory,
      {
        ...DEFAULT_CONFIG,
        stateDirectory: input.accountRoot,
        zaiCredentialRef: 'SIMULATED_REF',
        resolveCredential: async () => 'SYNTHETIC_HOST_REFERENCE_MUST_STAY_IN_ENV',
      },
    )
    expect(phases).toEqual(['native-candidates', 'account-scope'])
    expect(new Set(states).size).toBe(1)
    expect(nativePrograms).toEqual([process.execPath, process.execPath])
    expect(outputs[0]).toEqual({ phase: 'native-candidates', count: 1 })
    expect(models.map((model) => model.id)).toEqual([input.preference.model])
    expect(JSON.stringify(outputs)).not.toContain(fixtureKey)
    expect(JSON.stringify(outputs)).not.toContain('SYNTHETIC_HOST_REFERENCE_MUST_STAY_IN_ENV')
    await expect(stat(states[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('never persists native SDK expansion of the synthetic Host credential into intermediate candidates', async () => {
    const { snapshotNativeCandidates } = await import('../src/host/pi-native-catalog.mjs')
    const hostKey = 'SYNTHETIC_HOST_REFERENCE_MUST_STAY_IN_ENV'
    const candidates = snapshotNativeCandidates(
      [
        {
          provider: 'fixture',
          id: 'safe-model',
          name: hostKey,
          apiKey: hostKey,
          headers: { 'x-public': hostKey },
          baseUrl: 'https://metadata.invalid',
          api: 'openai-completions',
          thinkingLevelMap: { high: hostKey },
        },
      ],
      { ZAI_CODING_CN_API_KEY: hostKey },
    )
    expect(JSON.stringify(candidates).includes(hostKey)).toBe(false)
    expect(candidates).toMatchObject([
      { name: 'safe-model', headers: { 'x-public': true }, thinkingLevelMap: { high: true } },
    ])
  })
  it.each(['symlink', 'hardlink'] as const)(
    'rejects a %s Pi native metadata credential file before querying the SDK',
    async (kind) => {
      const { root, input } = await fixture('pi')
      const { queryNativeCandidates } = await import('../src/host/pi-native-catalog.mjs')
      const agent = join(root, 'synthetic-metadata')
      const outside = join(root, 'synthetic-outside-auth.json')
      const contents = JSON.stringify({ fixture: { type: 'api', key: 'SYNTHETIC_LINKED_KEY' } })
      await mkdir(agent)
      await writeFile(outside, contents)
      if (kind === 'symlink') await symlink(outside, join(agent, 'auth.json'))
      else await link(outside, join(agent, 'auth.json'))
      await expect(
        queryNativeCandidates('pi', input.executable, agent, fixtureEnvironment(root)),
      ).rejects.toThrow('无法读取 Pi/OMP 原生模型目录')
      expect(await readFile(outside, 'utf8')).toBe(contents)
    },
  )
  it('keeps preparation cleanup failures typed and does not start the account phase', async () => {
    const { input } = await fixture('omp')
    const capture = vi.fn(async () => {
      throw new ProcessCleanupUnconfirmedError()
    })
    await expect(preparePiOmp(input, capture)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(capture).toHaveBeenCalledTimes(1)
  })
  it('cannot execute an unconfirmed prepared request', async () => {
    const { input } = await fixture('omp')
    const prepared = await preparePiOmp(input)
    const outcome = await exec(prepared.argv[0]!, prepared.argv.slice(1), {
      env: fixtureEnvironment(input.nativeHome, prepared.env),
    }).catch((error) => error)
    expect(outcome.code).toBe(1)
    expect(outcome.stdout).not.toContain('HELLO')
  })
  it.each(['pi', 'omp'] as const)(
    '%s rejects every prepared state-directory symlink before writing a prompt',
    async (cli) => {
      for (const level of ['root', 'cli', 'project']) {
        const { root, input } = await fixture(cli)
        const outside = join(root, 'external')
        await mkdir(outside)
        await chmod(outside, 0o755)
        const identity = createHash('sha256')
          .update(await realpath(input.project))
          .digest('hex')
        const target =
          level === 'root'
            ? input.stateDirectory
            : level === 'cli'
              ? join(input.stateDirectory, cli)
              : join(input.stateDirectory, cli, identity)
        await mkdir(dirname(target), { recursive: true })
        await rm(target, { recursive: true, force: true })
        await symlink(outside, target)
        await expect(preparePiOmp(input)).rejects.toThrow('symlink')
        expect(await readdir(outside)).toEqual([])
        if (process.platform !== 'win32') expect((await stat(outside)).mode & 0o777).toBe(0o755)
      }
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s refuses linked bridge state before starting its native process',
    async (cli) => {
      for (const directory of ['agent', 't', 'sessions', 'agent/sessions']) {
        const { root, input } = await fixture(cli)
        const prepared = await preparePiOmp(input)
        const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
        const outside = join(root, 'external')
        await mkdir(outside)
        await chmod(outside, 0o755)
        const target = join(request.stateDirectory, directory)
        await mkdir(dirname(target), { recursive: true })
        await rm(target, { recursive: true, force: true })
        await symlink(outside, target)
        const result = directory === 'agent' ? undefined : await launch(input)
        if (directory === 'agent') await expect(launch(input)).rejects.toThrow('symlink')
        else {
          expect(result!.code).toBe(1)
          expect(result!.frames.at(-1)).toMatchObject({ status: 'ERROR' })
          expect(result!.stdout).not.toContain('HELLO')
        }
        expect(await readdir(outside)).toEqual([])
        if (process.platform !== 'win32') expect((await stat(outside)).mode & 0o777).toBe(0o755)
      }
    },
  )
  it.each(['symlink', 'hardlink'] as const)(
    'replaces OMP config %s entries without overwriting external files',
    async (kind) => {
      const { root, input } = await fixture('omp')
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const agent = join(request.stateDirectory, 'agent')
      await mkdir(agent, { recursive: true })
      const outside = join(root, 'external')
      await writeFile(outside, 'EXTERNAL SENTINEL')
      await chmod(outside, 0o644)
      const before = await stat(outside)
      for (const name of ['models.yml', 'config.yml']) {
        await rm(join(agent, name), { force: true })
        if (kind === 'symlink') await symlink(outside, join(agent, name))
        else await link(outside, join(agent, name))
      }
      const result = await launch(input)
      expect(result.code).toBe(0)
      expect(await readFile(outside, 'utf8')).toBe('EXTERNAL SENTINEL')
      expect((await stat(outside)).mode).toBe(before.mode)
      for (const name of ['models.yml', 'config.yml']) {
        const file = await stat(join(agent, name))
        expect(file.ino).not.toBe(before.ino)
        expect(file.nlink).toBe(1)
        if (process.platform !== 'win32') expect(file.mode & 0o777).toBe(0o600)
      }
    },
  )
  it.each(['symlink', 'hardlink'] as const)(
    'atomically replaces a session-map %s without modifying its outside target',
    async (kind) => {
      const { root, input } = await fixture('pi')
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const maps = join(request.stateDirectory, 'sessions')
      await mkdir(maps)
      const outside = join(root, 'external')
      await writeFile(outside, 'EXTERNAL SENTINEL')
      await chmod(outside, 0o644)
      const before = await stat(outside)
      const mapping = join(maps, createHash('sha256').update('fixture-id').digest('hex') + '.json')
      if (kind === 'symlink') await symlink(outside, mapping)
      else await link(outside, mapping)
      const result = await launch(input)
      expect(result.code).toBe(0)
      expect(await readFile(outside, 'utf8')).toBe('EXTERNAL SENTINEL')
      expect((await stat(outside)).mode).toBe(before.mode)
      expect((await stat(mapping)).ino).not.toBe(before.ino)
      if (process.platform !== 'win32') expect((await stat(mapping)).mode & 0o777).toBe(0o600)
      expect(JSON.parse(await readFile(mapping, 'utf8')).id).toBe('fixture-id')
    },
  )
  it.each(['symlink', 'hardlink'] as const)(
    'rejects a native resume session %s before sending a new prompt',
    async (kind) => {
      const { root, input } = await fixture('pi')
      await launch(input)
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const mapping = join(
        request.stateDirectory,
        'sessions',
        createHash('sha256').update('fixture-id').digest('hex') + '.json',
      )
      const stored = JSON.parse(await readFile(mapping, 'utf8'))
      const outside = join(root, 'external')
      await writeFile(outside, 'EXTERNAL SESSION')
      await chmod(outside, 0o644)
      await unlink(stored.path)
      if (kind === 'symlink') await symlink(outside, stored.path)
      else await link(outside, stored.path)
      const result = await launch({ ...input, conversationId: 'fixture-id' })
      expect(result.code).toBe(1)
      expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
      expect(result.stdout).not.toContain('RESUMED')
      expect(await readFile(outside, 'utf8')).toBe('EXTERNAL SESSION')
      if (process.platform !== 'win32') expect((await stat(outside)).mode & 0o777).toBe(0o644)
    },
  )
  it('a busy account between catalog phases stays a busy account, not a broken catalog', async () => {
    const { input } = await fixture('omp')
    let phases = 0
    await expect(
      discoverPiOmp(
        'omp',
        input.executable,
        async (argv, env) => {
          // The second phase starts after the first released the account.
          if (++phases === 2) throw new Error('账号正被使用，请稍后刷新')
          return (await exec(argv[0]!, argv.slice(1), { env: fixtureEnvironment(input.nativeHome, env) })).stdout
        },
        input.stateDirectory,
        { nativeHome: input.nativeHome, accountRoot: input.accountRoot },
      ),
    ).rejects.toThrow('账号正被使用，请稍后刷新')
    expect(phases).toBe(2)
  })
  it.each(['pi', 'omp'] as const)('%s discovers its exact model without prompting', async (cli) => {
    const { input } = await fixture(cli)
    const models = await discoverPiOmp(
      cli,
      input.executable,
      async (argv, env) =>
        (await exec(argv[0]!, argv.slice(1), { env: fixtureEnvironment(input.nativeHome, env) })).stdout,
      input.stateDirectory,
      { nativeHome: input.nativeHome, accountRoot: input.accountRoot },
    )
    expect(models).toEqual([
      {
        id: input.preference.model,
        label: 'GLM-5.3-Flash',
        cost: 'unknown',
        efforts: ['low', 'high', 'max'],
      },
    ])
  })
  it('refreshes stale OMP candidates in the registry later used by initial and resumed RPC', async () => {
    const { input } = await fixture('omp', 'catalog-refresh')
    const first = await launch(input)
    expect(first.code).toBe(0)
    expect(first.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    const resumed = await launch({ ...input, conversationId: 'fixture-id' })
    expect(resumed.code).toBe(0)
    expect(resumed.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'RESUMED' })
  })
  it('cancels native OMP metadata refresh and waits for the native child to exit', async () => {
    const { root, input } = await fixture('omp', 'catalog-cancel')
    const { queryNativeCandidates } = await import('../src/host/pi-native-catalog.mjs')
    const controller = new AbortController()
    const pending = queryNativeCandidates('omp', input.executable, root,
      fixtureEnvironment(root), () => {}, { refresh: true, signal: controller.signal })
    // Attach rejection before cancellation so the test never leaves it unhandled.
    const rejected = expect(pending).rejects.toThrow('无法读取 Pi/OMP 原生模型目录')
    await vi.waitFor(async () => expect(await readFile(join(root, 'catalog-started'), 'utf8')).toBe('STARTED'))
    controller.abort()
    await rejected
    const nativePid = Number(await readFile(join(root, 'catalog-pid'), 'utf8'))
    expect(nativePid).toBeGreaterThan(0)
    expect(() => process.kill(nativePid, 0)).toThrow()
    if (process.platform !== 'win32')
      expect(await readFile(join(root, 'native-stopped'), 'utf8')).toBe('STOPPED')
  })
  it.each(['pi', 'omp'] as const)(
    '%s persists the returned session path and resumes without guessing it',
    async (cli) => {
      const { input } = await fixture(cli)
      const first = await launch(input)
      expect(first.code).toBe(0)
      expect(first.frames.at(-1)).toEqual({ type: 'result', status: 'SUCCESS', response: 'HELLO', resultScope: 'run' })
      expect(first.frames.find((frame: any) => frame.record?.type === 'cliworker.rpc_usage')?.record)
        .toMatchObject({ cli, sessionId: 'fixture-id', usage: { total: 13 }, contextUsage: { tokens: 10, contextWindow: 128000 } })
      expect(first.stdout).not.toContain('PRIVATE_PATH_MUST_NOT_LEAK')
      expect(first.stdout).not.toContain('SECRET_REASONING_FIXTURE')
      expect(first.stdout).not.toContain(fixtureKey)
      const resumed = await launch({ ...input, conversationId: 'fixture-id' })
      expect(resumed.code).toBe(0)
      expect(resumed.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'RESUMED' })
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const args = JSON.parse(
        await readFile(join(request.stateDirectory, 'agent/observed-argv.json'), 'utf8'),
      )
      expect(args).toContain(cli === 'pi' ? '--session' : '--resume')
      expect(args).not.toContain('bash')
      expect(args).not.toContain('--yolo')
      if (process.platform !== 'win32') expect((await stat(prepared.argv[2]!)).mode & 0o077).toBe(0)
    },
  )
  it.each(['pi', 'omp'] as const)('%s never reports a turn that ends right after a failed tool as success', async (cli) => {
    const { input } = await fixture(cli, 'tool-error')
    const result = await launch({ ...input, mode: 'accept-edits' })
    expect(result.code).toBe(0)
    expect(result.frames.at(-1)).toMatchObject({ status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
    expect(result.frames.some((frame: any) => frame.event?.state === 'FAILED')).toBe(true)
  })
  it.each(['pi', 'omp'] as const)('%s reports a turn that carries on after a failed tool as success with the failed step count', async (cli) => {
    const { input } = await fixture(cli, 'tool-recovered')
    const result = await launch({ ...input, mode: 'accept-edits' })
    expect(result.code).toBe(0)
    expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
  })
  it.each(['pi', 'omp'] as const)('%s keeps optional unavailable/timed-out usage independent of native success', async (cli) => {
    for (const scenario of ['usage-unavailable', 'usage-timeout']) {
      const { input } = await fixture(cli, scenario)
      const result = await launch(input)
      expect(result.code).toBe(0)
      expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
      expect(result.frames.some((frame: any) => frame.record?.type === 'cliworker.rpc_usage')).toBe(false)
    }
  })
  it('Pi agent_end alone cannot become a completed task', async () => {
    const { input } = await fixture('pi', 'unsettled')
    const result = await launch(input)
    expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
  })
  it.each(['pi', 'omp'] as const)('%s rejects resume identity changes', async (cli) => {
    const { input } = await fixture(cli, 'identity')
    await launch(input)
    const result = await launch({ ...input, conversationId: 'fixture-id' })
    expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR', response: '' })
    expect(result.stdout).not.toContain('RESUMED')
  })
  it('unknown session IDs do not open arbitrary native history', async () => {
    const { input } = await fixture('pi')
    const result = await launch({ ...input, conversationId: 'unknown' })
    expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
    expect(result.stdout).not.toContain('HELLO')
  })
  it('rejects a stored path outside its private CLI state', async () => {
    const { root, input } = await fixture('pi')
    await launch(input)
    const prepared = await preparePiOmp(input)
    const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
    const mapping = join(
      request.stateDirectory,
      'sessions',
      createHash('sha256').update('fixture-id').digest('hex') + '.json',
    )
    const stored = JSON.parse(await readFile(mapping, 'utf8'))
    const unrelated = join(root, 'unrelated-session.jsonl')
    await writeFile(unrelated, 'UNRELATED')
    await writeFile(mapping, JSON.stringify({ ...stored, path: unrelated }))
    const result = await launch({ ...input, conversationId: 'fixture-id' })
    expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
    expect(result.stdout).not.toContain('HELLO')
    expect(await readFile(unrelated, 'utf8')).toBe('UNRELATED')
  })
  it('malformed RPC cannot produce a successful result', async () => {
    const { input } = await fixture('omp', 'malformed')
    const result = await launch(input)
    expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
  })
  // Node kill(SIGTERM) is TerminateProcess on Windows, not a delivered signal.
  // Windows SDK Job cancellation is covered by windows-process.test.ts instead.
  it.skipIf(process.platform === 'win32')(
    'waits for native SIGTERM cleanup before bridge termination',
    async () => {
      const { root, input } = await fixture('pi', 'cancel')
      const prepared = await prepareConfirmed(input)
      const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
        env: fixtureEnvironment(input.nativeHome, prepared.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '',
        sent = false
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        output += chunk
        if (!sent && output.includes('HELLO')) {
          sent = true
          child.kill('SIGTERM')
        }
      })
      const code = await new Promise((resolve) => child.once('close', resolve))
      expect(code).toBe(1)
      expect(await readFile(join(root, 'native-stopped'), 'utf8')).toBe('STOPPED')
      expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ status: 'ERROR' })
    },
  )
  it.each(['pi', 'omp'] as const)(
    'sends %s native abort through its scoped stop channel before teardown',
    async (cli) => {
      const { root, input } = await fixture(cli, 'cancel')
      const prepared = await prepareConfirmed(input)
      const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
        env: fixtureEnvironment(input.nativeHome, prepared.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '',
        stop: Promise<void> | undefined
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        output += chunk
        if (!stop && output.includes('HELLO')) {
          stop = prepared.stop!()
          void stop.catch(() => undefined)
        }
      })
      try {
        const code = await new Promise((resolve) => child.once('close', resolve))
        await stop
        expect(code).not.toBe(0)
        expect(await readFile(join(root, 'native-aborted'), 'utf8')).toBe('ABORT')
        expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ status: 'ERROR' })
      } finally {
        child.kill('SIGKILL')
        await prepared.cleanup()
      }
    },
  )
  it('rejects unselected routes and unsupported efforts before spawning', async () => {
    const { input } = await fixture('pi')
    await expect(
      preparePiOmp({ ...input, preference: { model: 'unverified/model', effort: 'low' } }),
    ).resolves.toHaveProperty('argv')
    await expect(
      preparePiOmp({ ...input, preference: { ...input.preference, effort: 'invented' } }),
    ).rejects.toThrow('effort')
  })
  it.each(['pi', 'omp'] as const)(
    '%s executes non-GLM metadata and emits the exact observed model',
    async (cli) => {
      const { input } = await fixture(cli, 'non-glm')
      const result = await launch(input)
      expect(result.code).toBe(0)
      expect(result.frames.find((frame: any) => frame.event?.observedModel)?.event.observedModel).toBe(
        input.preference.model,
      )
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const argv = JSON.parse(
        await readFile(join(request.stateDirectory, 'agent/observed-argv.json'), 'utf8'),
      )
      expect(argv.slice(argv.indexOf('--provider'), argv.indexOf('--provider') + 4)).toEqual([
        '--provider',
        'fixture-native',
        '--model',
        'native-chat',
      ])
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s keeps default for a native model without effort metadata',
    async (cli) => {
      const { input } = await fixture(cli, 'no-reasoning')
      expect((await launch(input)).code).toBe(0)
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const argv = JSON.parse(
        await readFile(join(request.stateDirectory, 'agent/observed-argv.json'), 'utf8'),
      )
      expect(argv).not.toContain('--thinking')
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s lists multiple providers and their own effort capabilities',
    async (cli) => {
      const { input } = await fixture(cli, 'multi')
      const models = await discoverPiOmp(
        cli,
        input.executable,
        async (argv, env) =>
          (
            await exec(argv[0]!, argv.slice(1), {
              env: fixtureEnvironment(input.nativeHome, env),
            })
          ).stdout,
        input.stateDirectory,
        { nativeHome: input.nativeHome },
      )
      expect(models.map((model) => [model.id, model.efforts])).toEqual([
        [input.preference.model, ['low', 'high', 'max']],
        ['second-native/other-chat', ['medium']],
        ['plain/chat', ['default']],
      ])
      expect(JSON.stringify(models)).not.toContain(fixtureKey)
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s switches a completed session to another native provider and effort',
    async (cli) => {
      const { input } = await fixture(cli, 'switch')
      expect((await launch(input)).code).toBe(0)
      const switched = await launch({
        ...input,
        conversationId: 'fixture-id',
        preference: { model: 'second-native/other-chat', effort: 'medium' },
      })
      expect(switched.code).toBe(0)
      expect(switched.frames.find((frame: any) => frame.type === 'session')).toMatchObject({
        id: 'fixture-id',
        model: 'second-native/other-chat',
      })
      expect(switched.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'RESUMED' })
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s rejects an unlisted model before sending a task prompt',
    async (cli) => {
      const { input } = await fixture(cli)
      const result = await launch({
        ...input,
        preference: { model: 'unknown/not-installed', effort: 'default' },
      })
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('HELLO')
      expect(result.frames.at(-1)).toMatchObject({ status: 'ERROR' })
    },
  )
  it.each(['pi', 'omp'] as const)('%s rejects a model that disagrees after native selection', async (cli) => {
    const { input } = await fixture(cli, 'wrong-model')
    const result = await launch(input)
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('HELLO')
  })
  it('sanitizes invalid OMP directory output that contains a synthetic credential', async () => {
    const { input } = await fixture('omp', 'secret-model-error')
    const result = await launch(input)
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain(fixtureKey)
    expect(result.frames.at(-1)).toMatchObject({
      status: 'ERROR',
      error: '无法读取 Pi/OMP 原生模型目录，请检查本机配置',
    })
  })
  it.skipIf(process.platform === 'win32')(
    'cleans up OMP native metadata queries when the bridge is stopped',
    async () => {
      const { root, input } = await fixture('omp', 'catalog-cancel')
      const prepared = await preparePiOmp(input)
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      await writeFile(
        prepared.argv[2]!,
        JSON.stringify({ ...request, discover: true, metadataPhase: 'native-candidates' }),
        { mode: 0o600 },
      )
      const processHandle = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
        env: fixtureEnvironment(input.nativeHome, prepared.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = '',
        stderr = ''
      processHandle.stdout.on('data', (data) => {
        stdout += data
      })
      processHandle.stderr.on('data', (data) => {
        stderr += data
      })
      await vi.waitFor(async () =>
        expect(await readFile(join(root, 'catalog-started'), 'utf8')).toBe('STARTED'),
      )
      processHandle.kill('SIGTERM')
      const code = await new Promise((resolve) => processHandle.once('close', resolve))
      expect(code).toBe(1)
      expect(await readFile(join(root, 'native-stopped'), 'utf8')).toBe('STOPPED')
      expect(stderr).not.toContain('TypeError')
      expect(stdout).not.toContain(fixtureKey)
    },
  )
  it.each(['pi', 'omp'] as const)(
    '%s preserves native env credentials across continuation without injecting a Host CN key into another provider',
    async (cli) => {
      const { root, input } = await fixture(cli, 'non-glm')
      const source = join(root, cli === 'pi' ? '.pi' : '.omp', 'agent')
      await mkdir(source, { recursive: true, mode: 0o700 })
      await writeFile(join(source, '.env'), 'ZHIPU_API_KEY=SYNTHETIC_NATIVE_PROVIDER_ENV\n', { mode: 0o600 })
      const selected = { ...input, managedCredentials: true }
      expect((await launch(selected)).code).toBe(0)
      expect((await launch({ ...selected, conversationId: 'fixture-id' })).code).toBe(0)
      const prepared = await preparePiOmp({ ...selected, conversationId: 'fixture-id' })
      expect(prepared.env?.ZHIPU_API_KEY).toBe('SYNTHETIC_NATIVE_PROVIDER_ENV')
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const observed = JSON.parse(
        await readFile(join(request.stateDirectory, 'agent/observed-auth.json'), 'utf8'),
      )
      expect(observed.nativeFixture).toBe(true)
      expect(observed.cnPresent).toBe(false)
      expect(observed.unexpectedNativeKey).toBe(false)
      expect(JSON.stringify(request)).not.toContain('SYNTHETIC_NATIVE_PROVIDER_ENV')
    },
  )
  it('does not import parent credential env into synthetic native processes', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'SIMULATED_PARENT_KEY_MUST_NOT_ENTER_FIXTURE')
    const { input } = await fixture('pi', 'non-glm')
    const result = await launch(input)
    expect(result.code).toBe(0)
    const prepared = await preparePiOmp(input)
    const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
    const observedText = await readFile(join(request.stateDirectory, 'agent/observed-auth.json'), 'utf8')
    expect(JSON.parse(observedText).unexpectedNativeKey).toBe(false)
    expect(observedText).not.toContain('SIMULATED_PARENT_KEY_MUST_NOT_ENTER_FIXTURE')
  })
  it.each(['pi', 'omp'] as const)(
    '%s never writes the resolved Host key into private snapshot files or rewrites another selected provider',
    async (cli) => {
      const { input } = await fixture(cli, 'non-glm')
      const prepared = await prepareConfirmed({ ...input, managedCredentials: true })
      const request = JSON.parse(await readFile(prepared.argv[2]!, 'utf8'))
      const hostKey = 'SYNTHETIC_HOST_REFERENCE_MUST_STAY_IN_ENV'
      const result = await exec(prepared.argv[0]!, prepared.argv.slice(1), {
        env: { ...fixtureEnvironment(input.nativeHome, prepared.env), ZAI_CODING_CN_API_KEY: hostKey },
        timeout: 10000,
      })
      expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toMatchObject({ status: 'SUCCESS' })
      const files = async (directory: string): Promise<string[]> =>
        (await readdir(directory, { withFileTypes: true })).flatMap((entry) =>
          entry.isFile() ? [join(directory, entry.name)] : [],
        )
      for (const path of await files(join(request.stateDirectory, 'agent'))) {
        expect((await readFile(path)).includes(Buffer.from(hostKey))).toBe(false)
      }
      expect(
        JSON.parse(
          await readFile(
            join(request.stateDirectory, 'agent', cli === 'pi' ? 'models.json' : 'models.yml'),
            'utf8',
          ),
        ).providers['fixture-native'].baseUrl,
      ).toMatch(/^http:\/\/127\.0\.0\.1:/)
    },
  )
})

it('sanitizes the bridge process before the Pi SDK reads environment credential fallbacks', async () => {
  const { root, input } = await fixture('pi', 'non-glm')
  const sdk = join(root, 'dist/core/model-runtime.js')
  await writeFile(
    sdk,
    `// SYNTHETIC SDK checks only fixture environment, never network.\nif(process.env.SYNTHETIC_FOREIGN_API_KEY || process.env.OMP_AUTH_BROKER_URL) throw new Error('foreign credential source');\nif(process.env.FIXTURE_API_KEY !== ${JSON.stringify(fixtureKey)}) throw new Error('missing own source');\n` +
      (await readFile(sdk, 'utf8')),
  )
  const catalog = await discoverPiOmp(
    'pi',
    input.executable,
    async (argv, env) =>
      (
        await exec(argv[0]!, argv.slice(1), {
          env: {
            ...fixtureEnvironment(input.nativeHome, env),
            SYNTHETIC_FOREIGN_API_KEY: 'SYNTHETIC_OTHER_CLI',
            OMP_AUTH_BROKER_URL: 'https://other-account.invalid',
          },
          timeout: 10000,
        })
      ).stdout,
    input.stateDirectory,
    { nativeHome: input.nativeHome, accountRoot: input.accountRoot },
  )
  expect(catalog.map((item) => item.id)).toContain(input.preference.model)
})

it.each(['pi', 'omp'] as const)(
  '%s projects only its own credential environment during native catalog and worker execution',
  async (cli) => {
    const { root, input } = await fixture(cli, 'non-glm')
    vi.stubEnv('HOME', root)
    if (process.platform === 'win32') vi.stubEnv('USERPROFILE', root)
    const foreign = [
      join(root, '.env'),
      join(root, '.env.production'),
      join(input.project, '.env'),
      join(input.project, '.env.local'),
    ]
    for (const path of foreign) await writeFile(path, 'FOREIGN_API_KEY=SYNTHETIC_FOREIGN_DOTENV\n')
    const guard = `import {readFileSync as probeRead} from 'node:fs';
if(process.env.FOREIGN_API_KEY) throw new Error('foreign dotenv credential was projected');
if(process.env.FIXTURE_API_KEY!==${JSON.stringify(fixtureKey)}) throw new Error('own env lost');
probeRead(process.env.PI_CODING_AGENT_DIR+(${JSON.stringify(cli)}==='pi'?'/auth.json':'/agent.db'));
`
    for (const path of [input.executable, join(root, 'dist/core/model-runtime.js')])
      await writeFile(path, guard + (await readFile(path, 'utf8')))
    const capture = async (argv: string[], env?: Record<string, string>) => {
      expect(argv[2]).toBe(process.execPath)
      expect(argv.join(' ')).not.toMatch(/sandbox-exec|\(deny |\(allow /)
      const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
      await writeFile(join(request.stateDirectory, 'agent/.env'), 'FOREIGN_API_KEY=SYNTHETIC_OLD_WORKER\n')
      return (
        await exec(argv[0]!, argv.slice(1), {
          cwd: input.project,
          env: fixtureEnvironment(root, env),
          timeout: 10000,
        })
      ).stdout
    }
    const config = { ...DEFAULT_CONFIG, stateDirectory: input.accountRoot }
    const models = await extendedCatalog(cli, input.executable, capture, input.stateDirectory, config)
    expect(models.map((model) => model.id)).toContain(input.preference.model)
    const launch = await extendedLaunch(
      cli,
      input.executable,
      input.project,
      { cli, model: input.preference.model, effort: 'low' },
      'plan',
      'synthetic task',
      input.stateDirectory,
      config,
      undefined,
      capture,
    )
    try {
      expect(launch.argv[2]).toBe(process.execPath)
      expect(launch.argv.join(' ')).not.toMatch(/sandbox-exec|\(deny |\(allow /)
      const run = await exec(launch.argv[0]!, launch.argv.slice(1), {
        cwd: input.project,
        env: fixtureEnvironment(root, launch.env),
        timeout: 10000,
      })
      expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toMatchObject({ status: 'SUCCESS' })
    } finally {
      launch.cleanup()
    }
  },
)

// 模拟 Pi clone 原生响应；首个正常运行仅建立模拟会话文件，不访问任何模型。
it('模拟 Pi clone preserves the source mapping, persists the returned branch ID and rolls back only the clone', async () => {
  const { input } = await fixture('pi')
  expect((await launch(input)).code).toBe(0)
  const prepared = await prepareConfirmed({ ...input, conversationId: 'fixture-id' })
  const requestPath = prepared.argv.at(-1)!
  const request = JSON.parse(await readFile(requestPath, 'utf8'))
  const maps = join(request.stateDirectory, 'sessions')
  const sourcePath = join(maps, createHash('sha256').update('fixture-id').digest('hex') + '.json')
  const sourceBefore = await readFile(sourcePath, 'utf8')
  await writeFile(requestPath, JSON.stringify({ ...request, forkOperation: 'fork' }), { mode: 0o600 })
  const result = await exec(prepared.argv[0]!, prepared.argv.slice(1), { env: fixtureEnvironment(input.nativeHome, prepared.env), timeout: 10000 })
  await prepared.cleanup()
  const frames = result.stdout.trim().split('\n').map(line => JSON.parse(line))
  expect(frames.find(frame => frame.record?.type === 'cliworker.fork_created')?.record.id).toBe('fixture-fork-id')
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
  expect(frames.some(frame => frame.type === 'event' && frame.event.kind === 'assistant')).toBe(false)
  expect(await readFile(sourcePath, 'utf8')).toBe(sourceBefore)
  const branchMap = join(maps, createHash('sha256').update('fixture-fork-id').digest('hex') + '.json')
  const mapping = JSON.parse(await readFile(branchMap, 'utf8'))
  expect(mapping.id).toBe('fixture-fork-id')
  const rollback = await prepareConfirmed({ ...input, conversationId: 'fixture-fork-id' })
  const rollbackPath = rollback.argv.at(-1)!
  const rollbackRequest = JSON.parse(await readFile(rollbackPath, 'utf8'))
  await writeFile(rollbackPath, JSON.stringify({ ...rollbackRequest, forkOperation: 'delete' }), { mode: 0o600 })
  const removed = await exec(rollback.argv[0]!, rollback.argv.slice(1), { env: fixtureEnvironment(input.nativeHome, rollback.env), timeout: 10000 })
  await rollback.cleanup()
  expect(JSON.parse(removed.stdout.trim().split('\n').at(-1)!)).toMatchObject({ status: 'SUCCESS' })
  await expect(stat(branchMap)).rejects.toThrow()
  await expect(stat(mapping.path)).rejects.toThrow()
  expect(await readFile(sourcePath, 'utf8')).toBe(sourceBefore)
  expect((await launch({ ...input, conversationId: 'fixture-id' })).code).toBe(0)
})
