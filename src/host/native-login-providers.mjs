// Installation metadata only. The parent gives this helper an empty private HOME.
// Never load the user's account, extensions or project and never send a model prompt.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnNativeProcess } from './native-spawn.mjs'
import { nativeLaunchArgv } from './native-launch.mjs'
import { inspectPiInstallation } from './pi-installation.mjs'

process.umask(0o077)
const [cli, executable] = process.argv.slice(2)
try {
  const root = process.env.CLIWORKER_LOGIN_METADATA_HOME
  if (!root || root !== process.cwd()) throw new Error('Missing isolated metadata home')
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'])
  for (const key of Object.keys(process.env)) if (!allowed.has(key.toUpperCase())) delete process.env[key]
  Object.assign(process.env, { HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'),
    PI_CONFIG_DIR: 'config', XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    APPDATA: join(root, 'config'), LOCALAPPDATA: join(root, 'cache'),
    TMPDIR: root, TMP: root, TEMP: root, PI_OFFLINE: '1', PI_TELEMETRY: '0', ELECTRON_RUN_AS_NODE: '1' })
  let providers
  if (cli === 'pi') {
    const { dist } = inspectPiInstallation(executable)
    const { ModelRuntime } = await import(pathToFileURL(join(dist, 'core/model-runtime.js')).href)
    const { AuthStorage } = await import(pathToFileURL(join(dist, 'core/auth-storage.js')).href)
    const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null,
      refreshOnCreate: false, allowModelNetwork: false })
    providers = runtime.getProviders().filter(p => p.auth?.apiKey || p.auth?.oauth)
      .map(p => ({ id: p.id, name: p.name }))
  } else if (cli === 'omp') {
    // OMP 16 refuses RPC startup without a configured provider, even for this
    // metadata method. This synthetic sentinel exists only in the isolated child;
    // no prompt/login is sent and no user credential or provider is selected.
    process.env.OPENAI_API_KEY = 'SYNTHETIC_CLIWORKER_METADATA_NO_INFERENCE'
    const argv = nativeLaunchArgv([executable, '--mode', 'rpc', '--no-session', '--no-tools',
      '--no-extensions', '--no-skills', '--no-rules', '--no-title', '--no-lsp', '--no-pty',
      '--config', join(process.cwd(), 'config.json')])
    const child = spawnNativeProcess(argv[0], argv.slice(1), {
      cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
    })
    // The Host owns deadlines and process-range cleanup, including descendants.
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
    let pending = '', bytes = 0, response
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 1024 * 1024) { child.stdin.destroy(); return }
      pending += chunk
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        try {
          const value = JSON.parse(line)
          if (value.type === 'response' && value.id === 'login-providers' &&
              value.command === 'get_login_providers' && value.success === true) response = value.data
        } catch { /* Native startup diagnostics are not metadata. */ }
      }
    })
    child.stderr.resume()
    // Native RPC drains commands on EOF and exits itself; no process termination on success.
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ id: 'login-providers', type: 'get_login_providers' }) + '\n')
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve)
    })
    if (code !== 0 || bytes > 1024 * 1024 || !Array.isArray(response?.providers))
      throw new Error('Native login metadata unavailable')
    providers = response.providers.filter(p => p.available !== false)
      .map(p => ({ id: p.id, name: p.name, ...(p.storeCredentialsAs ? { stores: p.storeCredentialsAs } : {}) }))
  } else throw new Error('Unsupported CLI')
  process.stdout.write(JSON.stringify({ providers }) + '\n')
} catch {
  // No raw native errors or credential-related metadata crosses this boundary.
  process.stderr.write('无法读取原生登录选项，请在原生终端中选择服务商。\n')
  process.exitCode = 1
}
