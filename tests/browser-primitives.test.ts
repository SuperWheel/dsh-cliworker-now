import { expect, it } from 'vitest'
import { browserPrimitiveExports, comparePrimitiveExports, requiredPrimitiveExports } from '../scripts/check-browser-primitives.mjs'

const frontend = `const renamed = Object.freeze(Object.defineProperty({__proto__:null, Button: component, usePopover: hook}, Symbol.toStringTag, {value:'Module'}));
const seeds = {'@deepseek-ai/dsh-client-ui-primitives':renamed};`

it('reports the missing hook that can crash the composer even though the module itself exists', () => {
  const stale = `const ui = require('@deepseek-ai/dsh-client-ui-primitives');
    function ContextMeter() { return (0, ui.useAnchoredPosition)({}); }`
  expect(comparePrimitiveExports([frontend], { 'ui-conversation': stale })).toEqual({
    references: 1, missing: [{ id: 'ui-conversation', names: ['useAnchoredPosition'] }],
  })
})

it('accepts named exports without depending on minified symbol or asset filenames', () => {
  const client = `let primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    primitives.Button(); primitives['usePopover']();`
  expect([...browserPrimitiveExports(['const unrelated = 1;', frontend])].sort()).toEqual(['Button', 'usePopover'])
  expect(comparePrimitiveExports([frontend], { 'ui-chat': client }).missing).toEqual([])
})

it('checks renamed destructured and direct require references', () => {
  const client = `const { Button: LocalButton } = require('@deepseek-ai/dsh-client-ui-primitives');
    require('@deepseek-ai/dsh-client-ui-primitives').usePopover();`
  expect([...requiredPrimitiveExports(client)].sort()).toEqual(['Button', 'usePopover'])
})

it('refuses an absent, ambiguous or unreadable frontend export table', () => {
  expect(() => browserPrimitiveExports(['const unrelated = 1;'])).toThrow('唯一')
  expect(() => browserPrimitiveExports([frontend, frontend])).toThrow('唯一')
  expect(() => browserPrimitiveExports([`const seeds = {'@deepseek-ai/dsh-client-ui-primitives': unknown};`])).toThrow('无法识别')
  expect(() => browserPrimitiveExports([`const seeds = {'@deepseek-ai/dsh-client-ui-primitives': {...unknown}};`])).toThrow('静态检查')
})

it('refuses dynamic accesses and empty scans instead of claiming compatibility', () => {
  expect(() => requiredPrimitiveExports(`const ui = require('@deepseek-ai/dsh-client-ui-primitives'); ui[key]();`)).toThrow('动态')
  expect(() => comparePrimitiveExports([frontend], { 'ui-chat': 'const unrelated = 1;' })).toThrow('空检查')
})

it('does not execute code found in the inspected bundles', () => {
  const source = `throw new Error('must not run'); ${frontend}`
  expect([...browserPrimitiveExports([source])]).toContain('Button')
})
