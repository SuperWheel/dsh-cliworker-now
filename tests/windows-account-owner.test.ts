import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 模拟 caller, actual Windows Toolhelp snapshot. No CLI, account or network.
it.skipIf(process.platform !== 'win32')('checks the exact process parent without CIM and rejects an unavailable PID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cwn-parent-SIMULATED-'))
  try {
    const owner = await readFile(new URL('../src/host/windows-account-owner.ps1', import.meta.url), 'utf8')
    const declarations = owner.slice(owner.indexOf('Add-Type -TypeDefinition'), owner.indexOf('\n$job=$null'))
    const script = join(directory, 'parent.ps1')
    await writeFile(script, `${declarations}
$ErrorActionPreference='Stop'
$currentParent=[CwnAccountJob]::ParentProcessId($PID)
$unavailableRejected=$false
try { [void][CwnAccountJob]::ParentProcessId(-1) } catch { $unavailableRejected=$true }
@{parent=$currentParent;unavailableRejected=$unavailableRejected}|ConvertTo-Json -Compress
`)
    const result = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    }))
    expect(result).toEqual({ parent: process.pid, unavailableRejected: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 15000)
