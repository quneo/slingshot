import { describe, expect, it } from 'vitest'
import { isBetter, loadSave, SAVE_VERSION, writeSave, freshSave, type AttemptSummary } from '../src/state/persistence'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

describe('save data', () => {
  it('round-trips progress and settings', () => {
    Object.assign(globalThis, { localStorage: new MemoryStorage() })
    const save = freshSave()
    save.settings.showGhost = false
    save.progress.L1 = { completed: true, stars: 2, best: null, attempts: [], lastPlan: null }
    writeSave(save)
    const back = loadSave()
    expect(back.version).toBe(SAVE_VERSION)
    expect(back.settings.showGhost).toBe(false)
    expect(back.progress.L1.stars).toBe(2)
  })

  it('unknown schema versions and broken JSON start fresh instead of crashing', () => {
    const storage = new MemoryStorage()
    Object.assign(globalThis, { localStorage: storage })
    storage.setItem('slingshot:save', JSON.stringify({ version: 999, progress: { L1: 'garbage' } }))
    expect(loadSave().progress).toEqual({})
    storage.setItem('slingshot:save', '{not json')
    expect(loadSave().progress).toEqual({})
  })

  it('fills in settings added after the save was written', () => {
    const storage = new MemoryStorage()
    Object.assign(globalThis, { localStorage: storage })
    storage.setItem('slingshot:save', JSON.stringify({ version: SAVE_VERSION, settings: { enlargePlanets: false }, progress: {} }))
    const s = loadSave()
    expect(s.settings.enlargePlanets).toBe(false)
    expect(s.settings.showGhost).toBe(true)
  })

  it('ranks attempts: success, then stars, then Δv, then time', () => {
    const a = (o: Partial<AttemptSummary>): AttemptSummary => ({ success: true, stars: 1, spentDv: 0.2, flightTime: 5, at: 0, ...o })
    expect(isBetter(a({}), null)).toBe(true)
    expect(isBetter(a({ success: false }), a({}))).toBe(false)
    expect(isBetter(a({ stars: 2 }), a({ stars: 1, spentDv: 0.1 }))).toBe(true)
    expect(isBetter(a({ spentDv: 0.15 }), a({ spentDv: 0.2 }))).toBe(true)
    expect(isBetter(a({ flightTime: 4 }), a({ flightTime: 5 }))).toBe(true)
    expect(isBetter(a({}), a({}))).toBe(false)
  })
})
