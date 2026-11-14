import { describe, expect, it } from 'vitest'
import { NODE_TYPES, offersStateField } from './nodes'

describe('offersStateField', () => {
  it('hides Requires and Effects on condition nodes', () => {
    expect(offersStateField('condition', 'requires')).toBe(false)
    expect(offersStateField('condition', 'effects')).toBe(false)
  })

  it('hides Effects but keeps Requires on instruction nodes', () => {
    expect(offersStateField('instruction', 'requires')).toBe(true)
    expect(offersStateField('instruction', 'effects')).toBe(false)
  })

  it('offers both on every other node type', () => {
    for (const type of NODE_TYPES.filter((t) => t !== 'condition' && t !== 'instruction')) {
      expect(offersStateField(type, 'requires')).toBe(true)
      expect(offersStateField(type, 'effects')).toBe(true)
    }
  })

  it('offers both on unknown node types', () => {
    expect(offersStateField('custom', 'requires')).toBe(true)
    expect(offersStateField('custom', 'effects')).toBe(true)
  })
})
