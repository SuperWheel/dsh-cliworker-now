import { expect, it } from 'vitest'
import { readNativeColdSessionState } from '../src/host/native-cold-session-state.ts'

const inbox = { 'next-turn': [], 'next-step': [] }
const turn = { openTurnStartSeq: null }
const plan = { active: false, wanted: null, running: null }

it.each([{}, { entered: true }])('accepts the consumed rc.5/rc.1 host state fields (%j)', extra => {
  expect(readNativeColdSessionState(inbox, turn, { ...plan, ...extra }).plan).toEqual(plan)
})

it.each([
  [undefined, turn, plan],
  [{ 'next-turn': { length: 0 }, 'next-step': [] }, turn, plan],
  [inbox, {}, plan],
  [inbox, { openTurnStartSeq: -1 }, plan],
  [inbox, turn, { active: false, pending: false }],
  [inbox, turn, { ...plan, running: false }],
  [inbox, turn, { ...plan, wanted: 'false' }],
])('refuses missing, wire-only or malformed state before any permission change', (i, t, p) => {
  expect(() => readNativeColdSessionState(i, t, p)).toThrow('未修改权限')
})
