import { createElement } from 'react'
import { create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { BrandIcon } from '../src/client/icons.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ IconSettingsOutlineRegular: () => null, IconCopyOutlineRegular: () => null }))

const images = (cli: Parameters<typeof BrandIcon>[0]['cli']) =>
  create(createElement(BrandIcon, { cli })).root.findAllByType('img').map(img => ({
    className: img.props.className as string | undefined,
    src: String(img.props.src),
  }))

it('TRAE 浅色用黑线标识、深色用绿色标识，两张都不带底板且不反色', () => {
  const traecn = images('traecn')
  expect(traecn.map(img => img.className)).toEqual(['cwn-icon-light', 'cwn-icon-dark'])
  expect(traecn[0].src).toContain('traecn-light')
  expect(traecn[1].src).toContain('traecn-dark')
  expect(traecn.some(img => img.className?.includes('cwn-icon-mono'))).toBe(false)
})

it('Kimi 仍按明暗各用一张官方图', () => {
  expect(images('kimi').map(img => img.className)).toEqual(['cwn-icon-light', 'cwn-icon-dark'])
})
