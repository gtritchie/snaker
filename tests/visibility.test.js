import { test, assertEquals, assertTrue } from './harness.js'
import { createVisibilityGate, VisibilityGateDestroyedError } from '../src/visibility.js'

// Fake browser environment for deterministic timing tests.
// - currentTime is mutated only by advance(); now() is a pure read of it.
// - timers fire in their armed order during advance(), with currentTime set
//   to each timer's fireAt before its callback runs (mirrors browser semantics).
// - setVisibility() flips visibilityState and fires visibilitychange listeners.
function makeFakeEnv(initiallyHidden = false) {
  let currentTime = 0
  const timers = []
  let nextId = 1
  const listeners = new Set()
  const fakeDocument = {
    visibilityState: initiallyHidden ? 'hidden' : 'visible',
    addEventListener(type, fn) { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener(type, fn) { if (type === 'visibilitychange') listeners.delete(fn) },
  }
  return {
    now: () => currentTime,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, fireAt: currentTime + ms, fn }); return id },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) },
    documentRef: fakeDocument,
    listenerCount: () => listeners.size,
    advance(ms) {
      const target = currentTime + ms
      while (true) {
        const due = timers.filter(t => t.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)
        if (due.length === 0) break
        const next = due[0]
        currentTime = next.fireAt
        timers.splice(timers.indexOf(next), 1)
        next.fn()
      }
      currentTime = target
    },
    setVisibility(state) {
      fakeDocument.visibilityState = state
      for (const fn of [...listeners]) fn()
    },
  }
}

function makeGate(env, opts = {}) {
  return createVisibilityGate({
    document: env.documentRef,
    now: env.now,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
    ...opts,
  })
}

test('visibleNow advances at wall rate while visible', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  const t0 = g.visibleNow()
  env.advance(100)
  assertEquals(g.visibleNow() - t0, 100)
})

test('visibleNow excludes hidden time from the delta', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  const t0 = g.visibleNow()
  env.advance(5000)              // 5 s visible
  env.setVisibility('hidden')
  env.advance(30000)             // 30 s hidden — must NOT count
  env.setVisibility('visible')
  env.advance(4000)              // 4 s visible
  assertEquals(g.visibleNow() - t0, 9000)
})

test('visibleNow stays frozen during a hidden interval (no read tearing)', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  env.advance(1000)
  env.setVisibility('hidden')
  const atHide = g.visibleNow()
  env.advance(500)
  const midHidden = g.visibleNow()
  env.advance(500)
  const stillHidden = g.visibleNow()
  assertEquals(midHidden, atHide)
  assertEquals(stillHidden, atHide)
})

// Roborev #622 regression: hidden interval BEFORE the measurement start.
// Old buggy elapsedSince(t) returned negative; visibleNow() returns correct delta.
test('visibleNow handles a hidden interval that precedes runStart', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  env.advance(1000)
  env.setVisibility('hidden')
  env.advance(9000)              // 9 s hidden BEFORE runStart
  env.setVisibility('visible')
  env.advance(1000)
  const runStart = g.visibleNow()
  env.advance(5000)              // 5 s visible play
  assertEquals(g.visibleNow() - runStart, 5000)
})
