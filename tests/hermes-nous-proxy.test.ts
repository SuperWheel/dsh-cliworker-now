import { EventEmitter } from 'node:events'
import { request } from 'node:https'
import { Readable } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { hostFetch, setHostProxy } from '../src/host/host-fetch.mjs'
import { fetchHermesNousModels, hermesNousEfforts, type HermesNousSource } from '../src/host/hermes-nous.ts'

// 合成 HTTP transport：只模拟服务器按 User-Agent 接受/拒绝请求，不访问网络、账号文件或原生 CLI。
vi.mock('node:https', async (original) => ({ ...await original<typeof import('node:https')>(), request: vi.fn() }))

afterEach(() => {
  setHostProxy(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function transport() {
  const seen: Headers[] = []
  vi.mocked(request).mockImplementation(((url: URL, options: any, callback: (incoming: any) => void) => {
    const headers = new Headers(options.headers)
    seen.push(headers)
    const catalog = url.pathname === '/v1/models'
    const blocked = catalog && !headers.get('user-agent')
    const body = blocked ? '<html>synthetic blocked</html>' : JSON.stringify(catalog ? {
      data: [{ id: 'synthetic/free', pricing: { prompt: 0, completion: 0 }, supported_parameters: ['tools', 'reasoning'], reasoning: { supported_efforts: ['low', 'high'] } }],
    } : { organisation: { id: 'synthetic-org' }, paid_service_access: { allowed: false } })
    const incoming = Object.assign(Readable.from([Buffer.from(body)]), {
      statusCode: blocked ? 403 : 200,
      statusMessage: blocked ? 'Forbidden' : 'OK',
      headers: { 'content-type': blocked ? 'text/html' : 'application/json' },
    })
    return Object.assign(new EventEmitter(), { end: () => queueMicrotask(() => callback(incoming)) })
  }) as typeof request)
  setHostProxy(async () => 'http://127.0.0.1:9')
  return seen
}

it('模拟 Windows Nous 代理目录：缺省客户端标识仍能读取账号模型与强度，不回退直连', async () => {
  const seen = transport(), direct = vi.fn()
  vi.stubGlobal('fetch', direct)
  const source: HermesNousSource = {
    access: 'synthetic-access', agentKey: 'synthetic-agent', expires: 4e12,
    principal: { kind: 'oauth', subject: 'synthetic-user', organization: 'synthetic-org', issuer: 'synthetic-issuer' },
    route: { portal: 'https://portal.nousresearch.com', inference: 'https://inference-api.nousresearch.com/v1' },
    modelCooldowns: [],
  }
  const result = await fetchHermesNousModels('synthetic-home', source)
  expect(result.models).toEqual([{ id: 'synthetic/free', cost: 'free' }])
  expect(hermesNousEfforts('synthetic-home', source, 'synthetic/free')).toEqual(['default', 'low', 'high'])
  expect(seen.map((headers) => headers.get('user-agent'))).toEqual(['node', 'node'])
  expect(seen.map((headers) => headers.get('authorization'))).toEqual(['Bearer synthetic-access', 'Bearer synthetic-agent'])
  expect(direct).not.toHaveBeenCalled()
})

it.each(['synthetic-client/1', ''])('模拟显式 User-Agent %j：代理保留调用方值和原始 Headers', async (value) => {
  const seen = transport()
  const headers = new Headers({ 'User-Agent': value, Authorization: 'Bearer synthetic-access' })
  const response = await hostFetch('https://portal.nousresearch.com/api/oauth/account', { headers })
  await response.text()
  expect(seen[0]!.get('user-agent')).toBe(value)
  expect(headers.get('user-agent')).toBe(value)
})
