// Run-scoped Pi extension: Pi has no native approval mode, so its documented
// `tool_call` hook asks through RPC `confirm` before a call the Worker level
// does not run directly. The bridge relays that confirm to the Host.
import { randomBytes } from 'node:crypto'
import { writeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPiInstallation } from './pi-installation.mjs'

export const PI_GATE_ENV = 'CWN_PI_PERMISSION_GATE'
export const PI_GATE_TITLE = 'cliworker-gate:'
const PI_READ_TOOLS = ['read', 'grep', 'find', 'ls']
const text = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : undefined)

/**
 * Tools a level runs without asking. 询问 runs reads only; 自动批准编辑 adds
 * file edits. DSH fallback tools ask the Host themselves and are never asked twice.
 */
export function piGateAllowedTools(access, harnessTools = []) {
  return [...PI_READ_TOOLS, ...(access === 'workspace-write' ? ['write', 'edit'] : []), ...harnessTools]
}

/** The bounded facts a confirm carries; never file contents. */
export function piToolCallFacts(event) {
  const input = event?.input && typeof event.input === 'object' ? event.input : {}
  return {
    tool: text(event?.toolName, 200) ?? '',
    ...(text(input.command, 4000) !== undefined ? { command: text(input.command, 4000) } : {}),
    ...(text(input.path, 2000) !== undefined ? { path: text(input.path, 2000) } : {}),
    ...(Array.isArray(input.edits) ? { edits: input.edits.length } : {}),
    ...(typeof input.content === 'string' ? { bytes: Buffer.byteLength(input.content) } : {}),
  }
}

/**
 * Pi 1.0.4 documents a blocking `tool_call` result and an RPC `confirm`
 * request; without both the gate cannot ask, so the caller runs read-only.
 */
export async function preparePiPermissionGate(executable, access, harnessTools = []) {
  try {
    const { dist } = inspectPiInstallation(executable)
    const [types, rpc] = await Promise.all([
      readFile(join(dist, 'core/extensions/types.d.ts'), 'utf8'),
      readFile(join(dist, 'modes/rpc/rpc-mode.js'), 'utf8'),
    ])
    if (!/interface ToolCallEventResult \{[^}]*block\?: boolean/.test(types) || !rpc.includes('method: "confirm"')) return
    const nonce = randomBytes(24).toString('hex')
    return {
      nonce,
      argv: ['--extension', fileURLToPath(import.meta.url)],
      env: { [PI_GATE_ENV]: JSON.stringify({ nonce, outputFd: 3, allowed: piGateAllowedTools(access, harnessTools) }) },
    }
  } catch { return undefined }
}

/** Reads the gate's confirm as a Host approval request; anything else is not the gate's. */
export function readPiGateConfirm(value, nonce) {
  if (!nonce || value?.method !== 'confirm' || value.title !== `${PI_GATE_TITLE}${nonce}` || typeof value.message !== 'string') return
  let facts
  try { facts = JSON.parse(value.message) } catch { return }
  if (!facts || typeof facts.tool !== 'string' || !facts.tool) return
  const shell = facts.tool === 'bash' || facts.tool === 'powershell'
  const file = facts.tool === 'write' || facts.tool === 'edit'
  const summary = shell && typeof facts.command === 'string'
    ? `执行命令：${facts.command}`
    : file && typeof facts.path === 'string'
      ? `${facts.tool === 'write' ? '写入文件' : '编辑文件'}：${facts.path}`
      : `调用工具：${facts.tool}`
  const detail = [
    Number.isSafeInteger(facts.edits) ? `${facts.edits} 处编辑` : '',
    Number.isSafeInteger(facts.bytes) ? `${facts.bytes} 字节` : '',
  ].filter(Boolean).join('，')
  return {
    kind: shell ? 'command' : file ? 'file' : 'tool',
    summary: summary.slice(0, 500),
    ...(detail ? { detail } : {}),
    allowSession: false,
  }
}

export function registerPiPermissionGate(api, { nonce, allowed }, emit) {
  const direct = new Set(allowed)
  api.on('tool_call', async (event, context) => {
    if (direct.has(event.toolName)) return
    // A throw here makes Pi block the call, so a broken relay never runs it.
    const approved = await context.ui.confirm(`${PI_GATE_TITLE}${nonce}`, JSON.stringify(piToolCallFacts(event)))
    if (approved !== true) return { block: true, reason: `The user denied ${event.toolName}; it was not run. Do not retry it another way.` }
  })
  emit({ type: 'cliworker.pi_permission_gate', nonce, ready: true })
}

export default function piPermissionGate(api) {
  // The ready record goes to the Host pipe only after the hook is registered;
  // the bridge starts no turn without it.
  const config = JSON.parse(process.env[PI_GATE_ENV] ?? 'null')
  if (!config || config.outputFd !== 3 || !/^[a-f0-9]{48}$/.test(config.nonce) ||
    !Array.isArray(config.allowed) || config.allowed.some(name => typeof name !== 'string')) return
  registerPiPermissionGate(api, config, record => writeSync(config.outputFd, JSON.stringify(record) + '\n'))
}
