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

test('sleep(100) resolves after 100 ms of visible time', async () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  let resolved = false
  g.sleep(100).then(() => { resolved = true })
  env.advance(99)
  await Promise.resolve()
  assertEquals(resolved, false, 'should not resolve before 100 ms')
  env.advance(1)
  await Promise.resolve()
  assertEquals(resolved, true, 'should resolve at 100 ms')
})

test('sleep parked at 80/100 resumes with remaining 20 after a hidden interval', async () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  let resolved = false
  g.sleep(100).then(() => { resolved = true })
  env.advance(80)                  // 20 ms remaining when we hide
  env.setVisibility('hidden')
  env.advance(30000)               // 30 s hidden
  await Promise.resolve()
  assertEquals(resolved, false, 'should not resolve while hidden')
  env.setVisibility('visible')
  env.advance(19)
  await Promise.resolve()
  assertEquals(resolved, false, 'should not resolve before remaining 20 ms')
  env.advance(1)
  await Promise.resolve()
  assertEquals(resolved, true, 'should resolve after the remaining 20 ms')
})

test('two concurrent sleeps both park and both resume with their respective remaining ms', async () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  let r50 = false, r150 = false
  g.sleep(50).then(() => { r50 = true })
  g.sleep(150).then(() => { r150 = true })
  env.advance(20)                  // both still in flight; 30/130 remaining
  env.setVisibility('hidden')
  env.advance(1000)
  env.setVisibility('visible')
  env.advance(29)
  await Promise.resolve()
  assertEquals(r50, false)
  env.advance(1)
  await Promise.resolve()
  assertEquals(r50, true, 'first sleep resolves at remaining 30')
  env.advance(99)
  await Promise.resolve()
  assertEquals(r150, false)
  env.advance(1)
  await Promise.resolve()
  assertEquals(r150, true, 'second sleep resolves at remaining 130')
})

test('sleep(100) on a gate constructed while hidden does not resolve until visible', async () => {
  const env = makeFakeEnv(true)    // initiallyHidden = true
  const g = makeGate(env)
  let resolved = false
  g.sleep(100).then(() => { resolved = true })
  env.advance(10000)               // 10 s of hidden time
  await Promise.resolve()
  assertEquals(resolved, false, 'parked sleep must not fire while hidden')
  env.setVisibility('visible')
  env.advance(99)
  await Promise.resolve()
  assertEquals(resolved, false)
  env.advance(1)
  await Promise.resolve()
  assertEquals(resolved, true, 'resolves at full 100 ms after becoming visible')
})

test('destroy() rejects in-flight sleeps with VisibilityGateDestroyedError', async () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  let err = null
  g.sleep(1000).catch(e => { err = e })
  g.destroy()
  await Promise.resolve()
  assertTrue(err instanceof VisibilityGateDestroyedError, 'expected VisibilityGateDestroyedError, got: ' + (err && err.name))
})

test('destroy() rejects parked sleeps too', async () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  let err = null
  g.sleep(1000).catch(e => { err = e })
  env.setVisibility('hidden')      // parks the sleep
  g.destroy()
  await Promise.resolve()
  assertTrue(err instanceof VisibilityGateDestroyedError)
})

test('destroy() removes the visibilitychange listener', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  assertEquals(env.listenerCount(), 1)
  g.destroy()
  assertEquals(env.listenerCount(), 0)
})

test('destroy() is idempotent', () => {
  const env = makeFakeEnv()
  const g = makeGate(env)
  g.destroy()
  g.destroy()                      // must not throw
  assertEquals(env.listenerCount(), 0)
})

test('audio.suspend() called on hide, audio.resume() called on show', () => {
  const env = makeFakeEnv()
  let suspends = 0, resumes = 0
  const audio = { suspend: () => { suspends++ }, resume: () => { resumes++ } }
  makeGate(env, { audioRef: () => audio })
  env.setVisibility('hidden')
  assertEquals(suspends, 1)
  assertEquals(resumes, 0)
  env.setVisibility('visible')
  assertEquals(suspends, 1)
  assertEquals(resumes, 1)
})

test('gate constructed while hidden does NOT call audio.suspend() at construction', () => {
  const env = makeFakeEnv(true)
  let suspends = 0
  const audio = { suspend: () => { suspends++ }, resume: () => {} }
  makeGate(env, { audioRef: () => audio })
  assertEquals(suspends, 0, 'AudioContext may not exist yet at construction')
})

test('onVisibilityChange snapshots time once (regression for roborev #629)', async () => {
  const env = makeFakeEnv()
  // Drifty now mirrors real performance.now: each read sees a slightly later value.
  const driftyNow = () => { const t = env.now(); env.advance(1); return t }
  const g = createVisibilityGate({
    document: env.documentRef,
    now: driftyNow,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
  })
  let r1 = false, r2 = false, r3 = false
  g.sleep(100).then(() => { r1 = true })
  g.sleep(100).then(() => { r2 = true })
  g.sleep(100).then(() => { r3 = true })
  env.advance(50)
  env.setVisibility('hidden')
  env.advance(10000)
  env.setVisibility('visible')
  env.advance(200)
  await Promise.resolve()
  // All three sleepers must resolve. The point of the test is that the gate
  // doesn't malfunction (e.g., negative remaining clamped to 0 because of
  // accumulated drift) when now() advances per-call.
  assertEquals(r1, true)
  assertEquals(r2, true)
  assertEquals(r3, true)
})
