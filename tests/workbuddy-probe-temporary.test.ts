import { afterEach, expect, it, vi } from 'vitest'
import { lstat, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readWorkBuddyMetadata } from '../src/host/workbuddy-metadata.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

const state = vi.hoisted(() => ({ root: '', failure: '', observed: undefined as any }))
vi.mock('../src/host/workbuddy-installation.ts', () => ({ resolveWorkBuddyInstallation: async () => ({runtime:'synthetic-node',entry:'synthetic-entry',cliVersion:'1.0.0',configDir:'synthetic-config'}) }))
vi.mock('../src/host/native-workbuddy.mjs', () => ({ probeWorkBuddyMetadata: async (input: any) => {
  state.observed = input.env; state.root = input.env.TEMP
  await writeFile(join(state.root,'.1234567890abcdef-00000000.dll'),'synthetic DLL')
  if (state.failure) throw new Error(state.failure)
  return {models:[{id:'synthetic',label:'Synthetic'}],endpoint:'https://example.test'}
} }))
const original = Object.getOwnPropertyDescriptor(process,'platform')!
afterEach(async () => { Object.defineProperty(process,'platform',original); if (state.root) await rm(state.root,{recursive:true,force:true}); state.root = ''; state.failure = '' })
it.each(['success','query failed','Native process exit is unconfirmed'])('WorkBuddy metadata private TEMP: %s (synthetic)', async result => {
  Object.defineProperty(process,'platform',{...original,value:'win32'})
  state.failure = result === 'success' ? '' : result
  const promise = readWorkBuddyMetadata('workbuddy','synthetic','.',new AbortController().signal)
  if (result === 'success') expect((await promise).models).toHaveLength(1)
  else if (result === 'Native process exit is unconfirmed') await expect(promise).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  else await expect(promise).rejects.toThrow(result)
  expect(state.observed.TMP).toBe(state.root)
  for (const key of Object.keys(process.env).filter(key => /^(?:https?|all|no)_proxy$/i.test(key))) expect(state.observed[key]).toBe(process.env[key])
  if (result === 'Native process exit is unconfirmed') expect(await readdir(state.root)).toContain(`.cliworker-owner-${process.pid}`)
  else await expect(lstat(state.root)).rejects.toMatchObject({code:'ENOENT'})
})
