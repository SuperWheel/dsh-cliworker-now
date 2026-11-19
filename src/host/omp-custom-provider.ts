import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isMap, parseDocument } from 'yaml'
import { captureCatalogMetadata } from './adapters.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'
import {
  markTemporaryTreeActive,
  prepareOmpNativesDirectory,
  removeTemporaryTree,
} from './temporary-tree.mjs'

/** API values OMP 18.22.0 accepted for a minimal custom provider (models.yml), each verified against a local endpoint. */
export const OMP_API_TYPES = [
  ['openai-completions', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
  ['google-generative-ai', 'Google Generative AI'],
] as const

/** Discovery-only native providers have no bundled catalog, so the catalog probe cannot see them. */
export const OMP_RESERVED_PROVIDER_IDS = ['ollama', 'lm-studio', 'lmstudio', 'vllm', 'llama-cpp']

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new Error('Invalid OMP models.yml')

/**
 * OMP first resolves every plain `apiKey` as an environment variable name (process env and the
 * `.env` files it autoloads) and only falls back to the literal string. `!` runs a command.
 * Reject the values for which the literal cannot be guaranteed. Never echo the value.
 */
export function ompLiteralKeyIssue(
  secret: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (secret.trimStart().startsWith('!')) return '以 ! 开头的值会被 OMP 当作命令执行，请在原生终端中配置'
  if (/^\$\{?[A-Za-z_]/.test(secret)) return '请直接填写密钥本身，不要填写环境变量引用'
  if (/^(?:<.*>|x+|\*+|sk-x+|(?:your[-_]?)?api[-_]?key(?:[-_]?here)?|placeholder|changeme)$/i.test(secret))
    return '请填写真实的 API Key，而不是占位符'
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(secret))
    return 'OMP 会把这种形式的值当作环境变量名读取，请在原生终端中配置'
  const names = Object.keys(env)
  if (
    platform === 'win32'
      ? names.some((name) => name.toLowerCase() === secret.toLowerCase())
      : Object.hasOwn(env, secret)
  )
    return 'OMP 会把这个值当作同名环境变量读取，请在原生终端中配置'
  return undefined
}

export interface OmpProviderValue {
  baseUrl: string
  api: string
  apiKey: string
  models: string[]
}

/** The exact node written to `providers.<id>`; also the receipt fingerprint input. */
export const ompProviderNode = (value: OmpProviderValue) => ({
  baseUrl: value.baseUrl,
  api: value.api,
  auth: 'apiKey',
  apiKey: value.apiKey,
  models: value.models.map((id) => ({ id, name: id })),
})

/** Parse the plugin models.yml strictly: no duplicate keys, aliases, or non-mapping providers. */
export function parseOmpModels(text: string | undefined) {
  const doc = parseDocument(text ?? '', { uniqueKeys: true })
  if (doc.errors.length || doc.warnings.length) throw invalid()
  if (doc.contents && !isMap(doc.contents)) throw invalid()
  const value: unknown = doc.toJS({ maxAliasCount: 0 }) ?? {}
  if (!object(value) || (value.providers != null && !object(value.providers))) throw invalid()
  return { doc, value, providers: (value.providers ?? {}) as Record<string, unknown> }
}

/** Add one provider; every other node, comment and the file's line ending are kept. */
export function addOmpProvider(
  text: string | undefined,
  id: string,
  node: ReturnType<typeof ompProviderNode>,
): string {
  const { doc, value, providers } = parseOmpModels(text)
  if (Object.hasOwn(providers, id)) throw invalid()
  if (value.providers == null) doc.set('providers', doc.createNode({}))
  doc.setIn(['providers', id], doc.createNode(node))
  const indent = /(?:^|\n)( +)\S/.exec(text ?? '')?.[1]?.length ?? 2
  let next = doc.toString({ lineWidth: 0, indent })
  if (text?.includes('\r\n')) next = next.replace(/\r?\n/g, '\r\n')
  // Readback: only this provider was added, and the key reads back literally.
  const after = parseOmpModels(next)
  const expected = { ...value, providers: { ...providers, [id]: node } }
  if (!isDeepStrictEqual(after.value, expected)) throw invalid()
  return next
}

/**
 * Whether OMP's own catalog already defines `provider`: a custom provider with a built-in id
 * merges into the native one and would shadow its logins. Runs only in an empty private HOME
 * with a synthetic, non-secret placeholder value; no account, prompt or model request.
 */
export async function ompCatalogDefinesProvider(
  backend: ProcessBackend,
  config: RuntimeConfig,
  executable: string,
  provider: string,
  signal: AbortSignal,
): Promise<boolean> {
  const probeModel = 'cliworker-probe-model'
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-omp-provider-')))
  markTemporaryTreeActive(root)
  try {
    const agent = join(root, 'agent')
    await mkdir(agent, { mode: 0o700 })
    await writeFile(
      join(agent, 'models.yml'),
      JSON.stringify({
        providers: {
          [provider]: {
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            auth: 'apiKey',
            apiKey: 'cliworker-synthetic-placeholder-not-a-key',
            models: [{ id: probeModel }],
          },
        },
      }),
      { mode: 0o600 },
    )
    // Host proxy settings stay as they are; credentials and profiles are not inherited.
    const env: Record<string, string> = Object.fromEntries(
      Object.keys(process.env)
        .filter(
          (key) =>
            ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase()) ||
            /^(?:https?|all|no)_proxy$/i.test(key),
        )
        .map((key) => [key, process.env[key]!]),
    )
    Object.assign(env, {
      PI_NATIVES_DIR: await prepareOmpNativesDirectory(config.stateDirectory),
      HOME: root,
      USERPROFILE: root,
      PI_CODING_AGENT_DIR: agent,
      PI_CONFIG_DIR: 'config',
      OMP_PROFILE: '',
      PI_PROFILE: '',
      TMPDIR: root,
      TMP: root,
      TEMP: root,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      NO_COLOR: '1',
    })
    const raw = await captureCatalogMetadata(
      backend,
      config,
      [executable, 'models', '--json', '--no-extensions'],
      root,
      signal,
      env,
    )
    const models: unknown = (JSON.parse(raw) as { models?: unknown })?.models
    if (!Array.isArray(models)) throw new Error('Invalid OMP model catalog')
    const own = models.filter((model) => object(model) && model.provider === provider)
    // The synthetic model must be listed, otherwise this probe proves nothing.
    if (!own.some((model) => model.id === probeModel)) throw new Error('Invalid OMP model catalog')
    return own.some((model) => model.id !== probeModel)
  } finally {
    await removeTemporaryTree(root)
  }
}
