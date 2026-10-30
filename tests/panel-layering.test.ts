import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as sheets from '../src/client/styles.ts'

// Every sheet the client mounts, joined as the page sees them.
const styles = Object.values(sheets).join('\n')

// Highest z-index among the rules written for exactly this selector.
const zIndex = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const values = [...css.matchAll(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((rule) => /z-index:\s*(-?\d+)/.exec(rule[1])?.[1])
    .filter((value) => value !== undefined)
    .map(Number)
  if (!values.length) throw new Error(`no z-index for ${selector}`)
  return Math.max(...values)
}

it('keeps the task menu above native code-block banners and the jump button', () => {
  const codeBlock = readFileSync(
    new URL('../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/markdown/CodeBlock.module.css', import.meta.url),
    'utf8',
  )
  const menu = zIndex(styles, '.cwn-action-menu')
  expect(menu).toBeGreaterThan(zIndex(codeBlock, '.bannerWrap'))
  expect(menu).toBeGreaterThan(zIndex(styles, '.cwn-jump'))
})
