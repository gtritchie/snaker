# Snaker engine — visibility gate and input preventDefault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two roborev findings against the engine: (1) game loop and play timing must pause when the tab is hidden, and (2) `preventDefault()` must be called on handled non-direction keys so browser-default behaviors (page scroll, back-navigation, form submit) don't leak through `waitForKey()` and `lineInput()`.

**Architecture:** New `src/visibility.js` module exports `createVisibilityGate({ audioRef, document?, now?, setTimeout?, clearTimeout? })`. It owns the engine's only `visibilitychange` listener, owns calling `audio.suspend()`/`audio.resume()`, and exposes `sleep(ms)` (resolves after that many ms of *visible* time, paused-and-resumed across hidden intervals with strict remaining-ms semantics) and `visibleNow()` (a monotonic visible-time clock). `runGame` constructs the gate after audio (using a lazy `audioRef` getter to break the construction cycle), routes both its own `sleep` and `audio.play`'s internal pacing through the gate, and uses `visibleNow()` in `playRounds` for score timing. `main.js` deletes its visibility handler entirely. `src/input.js` adds `e.preventDefault()` calls to the four key-consuming branches that lacked them.

**Tech Stack:** Vanilla ES modules. No build step. No bundler. No linter. In-browser test harness via `tests.html` + `tests/harness.js`. Manual smoke tests in a real browser.

**Source spec:** [`docs/superpowers/specs/2026-05-04-snaker-engine-fixes-design.md`](../specs/2026-05-04-snaker-engine-fixes-design.md)

**Branch:** `visibility-gate-and-input-prevent-default` (already created; spec already committed at `0c687c9`)

---

## File map

| File | Touched | Responsibility after the change |
| --- | --- | --- |
| `src/visibility.js` | **new** | Owns the engine's `visibilitychange` listener, `audio.suspend()`/`audio.resume()` lifecycle, and the gated `sleep` + `visibleNow` primitives. Pure JS, accepts injection seam for unit tests. |
| `src/audio.js` | modified | `createAudio()` becomes `createAudio({ sleep } = {})`. Internal wallclock pacing of `play()` (the `setTimeout` at line 364) routes through the injected `sleep`. Default keeps native `setTimeout` for backward compat. |
| `src/game.js` | modified | Constructs `visibility` after `audio` using a lazy `audioRef` getter. Replaces `sleep` definition with `visibility.sleep`. Replaces `performance.now()` capture/diff in `playRounds` with `visibility.visibleNow()`. Adds `VisibilityGateDestroyedError` to the `runGame` outer catch (swallowed iff `destroyed`). Exposes `visibility` on the returned controller for `main.js` teardown. |
| `src/input.js` | modified | Adds `e.preventDefault()` to: (a) the `waitForKey` resolution branch in `onKeyDown`, (b) the Enter / Backspace / printable branches in `handleLineInputKey`. |
| `src/main.js` | modified | Deletes the `onVisibility` handler and its `addEventListener` / `removeEventListener` lines. Adds `game.visibility.destroy()` to `destroy()` after `game.setDestroyed()`. |
| `tests.html` | modified | Adds `import './tests/visibility.test.js'` and `import './tests/input.test.js'`. |
| `tests/visibility.test.js` | **new** | Fake clock + fake document harness, covers all 11 visibility test cases from spec Section 5. |
| `tests/input.test.js` | **new** | Stub-canvas harness for `createInput`, covers cases 12–19 (preventDefault assertions). |

No new runtime dependencies. No build step changes.

---

## Manual verification baseline

Two reference points for "didn't break anything" between tasks:

- **Existing tests:** open `http://localhost:8000/tests.html`. All rows must show PASS. Run after every task that touches code (not after pure spec/doc edits).
- **Standalone game:** open `http://localhost:8000/`. Game must boot to pre-title, accept a key, play title music, reach at least one descent without console errors. Run after every task that touches `game.js`, `audio.js`, `input.js`, or `main.js`.

Start the server once and leave it running:

```sh
cd /Users/gary/code/snaker
python3 -m http.server 8000
```

---

## Task 1: Create `src/visibility.js` skeleton + `visibleNow()` with TDD

**Why:** `visibleNow()` is the smaller of the two primitives and has no dependency on `sleep` machinery. Building it first lets us validate the fake-clock test harness and lock in the read-tear fix (roborev #623) and the negative-elapsed fix (roborev #622) before any other code depends on the gate.

**Files:**
- Create: `src/visibility.js`
- Create: `tests/visibility.test.js`
- Modify: `tests.html` (add the import)

- [ ] **Step 1: Stub the new module so the import resolves**

Create `src/visibility.js` with just the export skeleton:

```js
// Owns the engine's visibilitychange listener, audio suspend/resume, and the
// gated sleep + visibleNow primitives. See docs/superpowers/specs/2026-05-04-snaker-engine-fixes-design.md.

export class VisibilityGateDestroyedError extends Error {
  constructor() { super('visibility gate destroyed'); this.name = 'VisibilityGateDestroyedError' }
}

export function createVisibilityGate(opts = {}) {
  const document = opts.document ?? globalThis.document
  const now = opts.now ?? (() => performance.now())
  const setTimeout = opts.setTimeout ?? globalThis.setTimeout
  const clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout
  const audioRef = opts.audioRef ?? (() => null)

  return { /* methods filled in by subsequent tasks */ }
}
```

- [ ] **Step 2: Create the test file with the fake-environment harness**

Create `tests/visibility.test.js`:

```js
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
```

- [ ] **Step 3: Write the failing visibleNow tests (cases 4, 5, 6, 6b from spec Section 5)**

Append to `tests/visibility.test.js`:

```js
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
```

- [ ] **Step 4: Run tests, confirm they fail**

Open `http://localhost:8000/tests.html`. Expected: four FAIL rows for the visibleNow tests with messages like "Cannot read properties of undefined (reading 'visibleNow')" or similar (because the gate returns `{}` so far).

- [ ] **Step 5: Add visibleNow import to tests.html**

If you missed it in step 4 — the four tests won't even register. Modify `tests.html`:

```html
<script type="module">
  import './tests/format.test.js'
  import './tests/glyphs.test.js'
  import './tests/playparser.test.js'
  import './tests/screen.test.js'
  import './tests/storage.test.js'
  import './tests/visibility.test.js'
  import { report } from './tests/harness.js'
  await report()
</script>
```

- [ ] **Step 6: Implement state init and visibleNow()**

Replace the placeholder `return {}` inside `createVisibilityGate` with the state and the method:

```js
  let hidden = (document.visibilityState === 'hidden')
  let hiddenSince = hidden ? now() : null
  let totalHiddenMs = 0

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && !hidden) {
      hidden = true
      hiddenSince = now()
    } else if (document.visibilityState !== 'hidden' && hidden) {
      hidden = false
      if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
      hiddenSince = null
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  // Single now() snapshot — see spec Section 2 "Read tearing" (roborev #623).
  function visibleNow() {
    const t = now()
    let hiddenSoFar = totalHiddenMs
    if (hidden && hiddenSince !== null) hiddenSoFar += t - hiddenSince
    return t - hiddenSoFar
  }

  return { visibleNow }
```

- [ ] **Step 7: Run tests, confirm visibleNow tests PASS, all existing tests still PASS**

Reload `http://localhost:8000/tests.html`. Expected: all rows green.

- [ ] **Step 8: Commit**

```sh
git add src/visibility.js tests/visibility.test.js tests.html
git commit -m "Add visibility gate visibleNow() with read-tear-safe implementation"
```

---

## Task 2: Add `sleep(ms)` to the gate with TDD

**Why:** `sleep(ms)` is the second of the two gated primitives. Strict pause/resume semantics (resume with remaining ms, not full ms) per spec Section 2 / decision (A). Tests must cover normal sleep, parked sleep across a hidden interval, multiple concurrent sleepers, and boot-while-hidden.

**Files:**
- Modify: `src/visibility.js` (add `sleep` and the Sleeper machinery)
- Modify: `tests/visibility.test.js` (add tests 1, 2, 3, 7 from spec Section 5)

- [ ] **Step 1: Write the failing sleep tests**

Append to `tests/visibility.test.js`:

```js
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
```

- [ ] **Step 2: Run tests, confirm they fail**

Reload `http://localhost:8000/tests.html`. Expected: four new FAIL rows ("g.sleep is not a function").

- [ ] **Step 3: Implement Sleeper machinery and sleep()**

In `src/visibility.js`, add the Sleeper sets after the existing state and update `onVisibilityChange` to park/start sleepers. Add `sleep` and the helpers, then export it from the returned object:

```js
  const parked = new Set()
  const active = new Set()
  let destroyed = false

  function start(sleeper) {
    sleeper.startedAt = now()
    active.add(sleeper)
    sleeper.timerId = setTimeout(() => {
      active.delete(sleeper)
      sleeper.timerId = null
      sleeper.resolve()
    }, sleeper.remaining)
  }

  function park(sleeper) {
    clearTimeout(sleeper.timerId)
    sleeper.timerId = null
    sleeper.remaining -= (now() - sleeper.startedAt)
    if (sleeper.remaining < 0) sleeper.remaining = 0
    active.delete(sleeper)
    parked.add(sleeper)
  }

  function sleep(ms) {
    if (destroyed) return Promise.reject(new VisibilityGateDestroyedError())
    return new Promise((resolve, reject) => {
      const sleeper = { remaining: ms, startedAt: now(), timerId: null, resolve, reject }
      if (hidden) parked.add(sleeper)
      else start(sleeper)
    })
  }
```

Then update `onVisibilityChange` to park active sleepers on hide and restart parked sleepers on show. Replace the existing function body with:

```js
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && !hidden) {
      hidden = true
      hiddenSince = now()
      for (const s of [...active]) park(s)
    } else if (document.visibilityState !== 'hidden' && hidden) {
      hidden = false
      if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
      hiddenSince = null
      for (const s of [...parked]) {
        parked.delete(s)
        start(s)
      }
    }
  }
```

Update the returned object to expose `sleep`:

```js
  return { sleep, visibleNow }
```

- [ ] **Step 4: Run tests, confirm sleep tests PASS, all existing tests still PASS**

Reload tests.html. Expected: all rows green.

- [ ] **Step 5: Commit**

```sh
git add src/visibility.js tests/visibility.test.js
git commit -m "Add visibility gate sleep(ms) with strict pause/resume semantics"
```

---

## Task 3: Add `destroy()` and audio suspend/resume coupling with TDD

**Why:** Final piece of the gate's public surface. `destroy()` must reject in-flight sleeps with `VisibilityGateDestroyedError`, remove the listener, and be idempotent. The audio coupling adds two side effects to `onVisibilityChange`: call `audio.suspend()` on hide, `audio.resume()` on show. Per spec Section 3 Sequence E, do NOT suspend at construction — first suspend happens on first hide-after-show.

**Files:**
- Modify: `src/visibility.js` (add `destroy`, `audioRef` calls in `onVisibilityChange`)
- Modify: `tests/visibility.test.js` (add tests 8, 9, 10, 11 from spec Section 5)

- [ ] **Step 1: Write the failing destroy + audio tests**

Append to `tests/visibility.test.js`:

```js
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
  const g = makeGate(env, { audioRef: () => audio })
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
```

- [ ] **Step 2: Run tests, confirm they fail**

Reload tests.html. Expected: six FAIL rows ("g.destroy is not a function" or assertion failures).

- [ ] **Step 3: Implement destroy() and the audio coupling**

In `src/visibility.js`, update `onVisibilityChange` to call audio suspend/resume around the existing transition logic. Wrap each in `Promise.resolve(...).catch(...)` because `audio.suspend()` and `audio.resume()` may return `undefined` (no AudioContext yet) or a Promise that rejects:

```js
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && !hidden) {
      hidden = true
      hiddenSince = now()
      for (const s of [...active]) park(s)
      const a = audioRef()
      if (a) Promise.resolve(a.suspend()).catch(err => console.warn('audio: visibility suspend failed:', err))
    } else if (document.visibilityState !== 'hidden' && hidden) {
      hidden = false
      if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
      hiddenSince = null
      for (const s of [...parked]) {
        parked.delete(s)
        start(s)
      }
      const a = audioRef()
      if (a) Promise.resolve(a.resume()).catch(err => console.warn('audio: visibility resume failed:', err))
    }
  }
```

Add the destroy function:

```js
  function destroy() {
    if (destroyed) return
    destroyed = true
    document.removeEventListener('visibilitychange', onVisibilityChange)
    for (const s of [...active]) {
      clearTimeout(s.timerId)
      s.reject(new VisibilityGateDestroyedError())
    }
    for (const s of [...parked]) {
      s.reject(new VisibilityGateDestroyedError())
    }
    active.clear()
    parked.clear()
  }
```

Update the returned object:

```js
  return { sleep, visibleNow, destroy }
```

- [ ] **Step 4: Run tests, confirm new tests PASS, all existing PASS**

Reload tests.html. Expected: all rows green.

- [ ] **Step 5: Commit**

```sh
git add src/visibility.js tests/visibility.test.js
git commit -m "Add visibility gate destroy() and audio suspend/resume coupling"
```

---

## Task 4: Wire gate into `runGame`; route audio.play pacing through gate

**Why:** Connects the gate to the engine. After this task: every `await sleep(...)` in `game.js` and the wallclock pacing inside `audio.play()` route through `visibility.sleep`; `playRounds` uses `visibility.visibleNow()` for score timing; the engine catches `VisibilityGateDestroyedError` cleanly during shutdown. The construction order needs the lazy `audioRef` getter (spec Section 1).

**Files:**
- Modify: `src/audio.js` (accept injected `sleep` in `createAudio`, use it at line 364)
- Modify: `src/game.js` (construct gate, replace sleep, replace performance.now in playRounds, expose visibility, update catch)

- [ ] **Step 1: Modify `createAudio` to accept an injected `sleep`**

In `src/audio.js`, change the function signature and use the injected sleep for the wallclock pacing:

```js
export function createAudio(opts = {}) {
  const sleep = opts.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)))
  // ...rest unchanged until line 364
```

Find the existing line (currently `audio.js:364`):

```js
  await new Promise(resolve => setTimeout(resolve, elapsedSec * 1000))
```

Replace with:

```js
  await sleep(elapsedSec * 1000)
```

- [ ] **Step 2: Verify existing tests still pass**

Reload tests.html. Expected: all rows green (`playparser.test.js` doesn't construct an `Audio` instance, so the new opts arg has no effect on existing tests).

- [ ] **Step 3: Modify `runGame` in `src/game.js` to construct and use the gate**

At the top of `src/game.js`, add the import:

```js
import { createVisibilityGate, VisibilityGateDestroyedError } from './visibility.js'
```

Inside `runGame`, restructure the `audio` / `visibility` construction. Find the existing block (currently around `game.js:64-72`):

```js
  const screen = createScreen(canvas)
  const audio = createAudio()
  registerAudio(audio)
  const input = createInput(canvas, () => {
    audio.resume().catch(err => console.warn('audio: resume on gesture failed:', err))
  })
```

Replace with:

```js
  const screen = createScreen(canvas)
  let audio = null
  // Lazy audioRef: gate is constructed before audio so audio can use gate.sleep,
  // but the gate only needs audio inside its visibilitychange handler — well after
  // both have been wired up. See spec Section 1, "Construction ordering wrinkle".
  const visibility = createVisibilityGate({ audioRef: () => audio })
  audio = createAudio({ sleep: ms => visibility.sleep(ms) })
  registerAudio(audio)
  const input = createInput(canvas, () => {
    audio.resume().catch(err => console.warn('audio: resume on gesture failed:', err))
  })
```

Replace the existing `sleep` definition (currently `game.js:111`):

```js
  const sleep = (ms) => tracked(new Promise(r => setTimeout(r, ms)))
```

with:

```js
  const sleep = (ms) => tracked(visibility.sleep(ms))
```

Update the `runGame` outer catch (currently `game.js:130-136`) to also swallow `VisibilityGateDestroyedError` during a clean shutdown:

```js
      } catch (err) {
        if (err instanceof GameAbortedError) {
          if (destroyed) return
          screen.setInverted(false)
          continue
        }
        if (err instanceof VisibilityGateDestroyedError && destroyed) return
        throw err
      }
```

Expose `visibility` on the returned controller (currently `game.js:142`):

```js
  return { promise, screen, audio, input, visibility, fireAbort, escUnsub, setDestroyed }
```

- [ ] **Step 4: Replace `performance.now()` in `playRounds` with `visibility.visibleNow()`**

Find `playRounds` (currently `game.js:297-312`). Two lines change. Replace:

```js
  while (true) {
    const runStart = performance.now()
    await singleDescent(ctx, { leftEdge, rightEdge, playerPos })
    accumulatedMs += performance.now() - runStart
```

with:

```js
  while (true) {
    const runStart = ctx.visibility.visibleNow()
    await singleDescent(ctx, { leftEdge, rightEdge, playerPos })
    accumulatedMs += ctx.visibility.visibleNow() - runStart
```

Add `visibility` to the `ctx` object (currently `game.js:113`):

```js
  const ctx = { screen, audio, input, visibility, tracked, sleep }
```

- [ ] **Step 5: Existing tests still pass**

Reload `http://localhost:8000/tests.html`. Expected: all rows green.

- [ ] **Step 6: Manual smoke test of the standalone game**

1. Open `http://localhost:8000/`. Press a key to start.
2. Title music plays without distortion.
3. Reach the first descent; play it through (or crash; either is fine).
4. Open browser devtools → Console. No errors.

If anything fails, do NOT proceed — debug first.

- [ ] **Step 7: Commit**

```sh
git add src/audio.js src/game.js
git commit -m "Wire visibility gate into runGame and audio.play pacing"
```

---

## Task 5: Remove `main.js`'s `onVisibility` handler; call `visibility.destroy()` in teardown

**Why:** Visibility is now wholly an engine concern. The legacy handler in `main.js` (lines 57–65) and its `removeEventListener` (line 78) are redundant — the gate owns this entirely. The new wiring needs `visibility.destroy()` in `destroy()` AFTER `setDestroyed()` so any sleep rejected by gate teardown surfaces with `destroyed === true` and is swallowed by `runGame`'s catch (spec Section 4).

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Delete the `onVisibility` handler and its registration**

In `src/main.js`, find and delete this block (currently lines 54–65):

```js
  // Pause audio when the tab is hidden; resume when visible. Without this,
  // a backgrounded game keeps stepping (via setTimeout) and audio continues —
  // both undesirable.
  const onVisibility = () => {
    const promise = document.visibilityState === 'hidden'
      ? game.audio.suspend()
      : game.audio.resume()
    // audio.suspend()/resume() return undefined when the AudioContext doesn't
    // exist yet (no user interaction). Wrap so .catch() doesn't TypeError.
    Promise.resolve(promise).catch(err => console.warn('audio: visibility toggle failed:', err))
  }
  document.addEventListener('visibilitychange', onVisibility)
```

- [ ] **Step 2: Delete the matching removeEventListener**

In the same file's `destroy()` function, find and delete this line (currently line 78):

```js
    document.removeEventListener('visibilitychange', onVisibility)
```

- [ ] **Step 3: Add `game.visibility.destroy()` to `destroy()` after `setDestroyed()`**

In `destroy()`, find this block (currently lines 86–87):

```js
    game.setDestroyed()
    game.fireAbort()
```

Replace with:

```js
    game.setDestroyed()
    game.visibility.destroy()
    game.fireAbort()
```

Order is load-bearing: `setDestroyed()` first so the destroyed flag is true when the gate's destroy rejects in-flight sleeps; the resulting `VisibilityGateDestroyedError` is swallowed by `runGame`'s catch (added in Task 4). `fireAbort()` follows so any non-sleep tracked promises also unwind.

- [ ] **Step 4: Existing tests still pass**

Reload tests.html. Expected: all rows green.

- [ ] **Step 5: Standalone game still boots and runs**

Open `http://localhost:8000/`. Verify pre-title → title music → first descent works with no console errors.

- [ ] **Step 6: Manual visibility smoke test**

The whole point of the change. Verify:

1. Open `http://localhost:8000/`. Press a key to start. Tab away during the title music. Wait 30 s. Tab back.
   - Expected: no audio glitches; the title sequence continues from a sensible point (current piece may restart silently — acceptable per spec Sequence D).
2. Begin a descent. Tab away mid-descent. Wait 30 s. Tab back.
   - Expected: snake is visually exactly where you left it. No advancement during hidden.
3. Complete a full game (3 descents) without tabbing — note the final score.
4. Repeat, this time tabbing away for ~15 s during one descent — note the final score.
5. The two scores should be similar (within normal play variance). The hidden interval must not have inflated the score.

If any of (1)–(5) fail, do NOT commit — debug.

- [ ] **Step 7: Commit**

```sh
git add src/main.js
git commit -m "Remove main.js visibility handler; gate now owns audio suspend/resume"
```

---

## Task 6: Add `preventDefault()` to handled non-direction keys in `input.js` (with TDD)

**Why:** Roborev Finding 2. Four key-consuming branches in `input.js` lack `preventDefault()`: the `waitForKey` resolution in `onKeyDown`, and the Enter / Backspace / printable branches in `handleLineInputKey`. Without it, Space scrolls the page, Backspace navigates back, Enter submits parent forms in embedded contexts. Spec Section 6.

**Files:**
- Create: `tests/input.test.js`
- Modify: `tests.html` (add the import)
- Modify: `src/input.js` (four `e.preventDefault()` insertions)

- [ ] **Step 1: Stub the input test harness and import it**

Create `tests/input.test.js`:

```js
import { test, assertEquals, assertTrue } from './harness.js'
import { createInput } from '../src/input.js'

// Stub the canvas surface that createInput attaches listeners to.
// captures the registered handlers so tests can synthesize events directly.
function makeStubCanvas() {
  const handlers = {}
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn) },
    removeEventListener(type, fn) {
      const arr = handlers[type]
      if (!arr) return
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 192 }),
    focus() {},
    tabIndex: 0,
  }
}

function makeKeyEvent(key, opts = {}) {
  let prevented = false
  return {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    preventDefault() { prevented = true },
    get prevented() { return prevented },
    wasPrevented() { return prevented },
  }
}

function fireKeyDown(canvas, e) {
  for (const fn of canvas.handlers.keydown ?? []) fn(e)
}
```

Add the import to `tests.html`:

```html
  import './tests/visibility.test.js'
  import './tests/input.test.js'
  import { report } from './tests/harness.js'
```

- [ ] **Step 2: Write the failing waitForKey + lineInput preventDefault tests**

Append to `tests/input.test.js`:

```js
// ── waitForKey path ────────────────────────────────────────────────────

test('Space during waitForKey() resolves the wait AND calls preventDefault', async () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  const p = input.waitForKey()
  const e = makeKeyEvent(' ')
  fireKeyDown(canvas, e)
  await p
  assertTrue(e.wasPrevented(), 'preventDefault should have been called')
})

test('Space with no waiter pending does NOT call preventDefault', () => {
  const canvas = makeStubCanvas()
  createInput(canvas)
  const e = makeKeyEvent(' ')
  fireKeyDown(canvas, e)
  assertEquals(e.wasPrevented(), false, 'no waiter, no preventDefault')
})

// ── lineInput path ─────────────────────────────────────────────────────

test('Enter during lineInput() resolves AND calls preventDefault', async () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  const p = input.lineInput({ render: () => {} })
  const e = makeKeyEvent('Enter')
  fireKeyDown(canvas, e)
  await p
  assertTrue(e.wasPrevented())
})

test('Backspace during lineInput() shrinks buffer AND calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  fireKeyDown(canvas, makeKeyEvent('a'))
  fireKeyDown(canvas, makeKeyEvent('b'))
  const e = makeKeyEvent('Backspace')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'a')
  assertTrue(e.wasPrevented())
})

test('Printable char during lineInput() appends AND calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  const e = makeKeyEvent('x')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'x')
  assertTrue(e.wasPrevented())
})

test('Printable char dropped at maxLength still calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b }, maxLength: 1 })
  fireKeyDown(canvas, makeKeyEvent('a'))
  const e = makeKeyEvent('b')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'a', 'second char dropped')
  assertTrue(e.wasPrevented(), 'still preventDefault — engine swallowed the keystroke')
})

test('Printable char with Ctrl held is NOT consumed and NOT preventDefaulted', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  const e = makeKeyEvent('a', { ctrlKey: true })
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, '', 'modifier means engine does not consume')
  assertEquals(e.wasPrevented(), false)
})

test('Tab key during lineInput is NOT consumed and NOT preventDefaulted', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let renderCount = 0
  input.lineInput({ render: () => { renderCount++ } })
  const initialRender = renderCount
  const e = makeKeyEvent('Tab')
  fireKeyDown(canvas, e)
  assertEquals(e.wasPrevented(), false, 'Tab is not handled by lineInput')
  // render still fires once on the unchanged buffer (existing behavior — Tab
  // falls through to the trailing render call). The point is that the
  // browser default (focus advance) is preserved.
  assertEquals(renderCount, initialRender + 1)
})
```

- [ ] **Step 3: Run tests, confirm they fail**

Reload tests.html. Expected: seven new FAIL rows — all assert `wasPrevented()` returns true but it currently returns false (because preventDefault isn't being called).

- [ ] **Step 4: Add `preventDefault()` to the `waitForKey` resolution branch**

In `src/input.js`, find the existing block (currently lines 87–90):

```js
    if (keyListeners.length > 0) {
      const resolvers = keyListeners.splice(0)
      for (const r of resolvers) r(e.key)
    }
```

Replace with:

```js
    if (keyListeners.length > 0) {
      e.preventDefault()
      const resolvers = keyListeners.splice(0)
      for (const r of resolvers) r(e.key)
    }
```

- [ ] **Step 5: Add `preventDefault()` to the three consuming branches of `handleLineInputKey`**

Find the existing function (currently lines 97–119) and add `e.preventDefault()` to each consuming branch:

```js
  function handleLineInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const result = lineInputState.buffer
      const finish = lineInputState.resolve
      lineInputState = null
      finish(result)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      lineInputState.buffer = lineInputState.buffer.slice(0, -1)
    } else if (
      !e.ctrlKey && !e.metaKey && !e.altKey
      && e.key.length === 1
      && e.key.charCodeAt(0) >= 32 && e.key.charCodeAt(0) < 127
    ) {
      e.preventDefault()
      // Skip when a modifier is held so shortcuts like Ctrl+C / Cmd+R don't
      // pollute the buffer with the underlying character key.
      if (lineInputState.buffer.length < lineInputState.maxLength) {
        lineInputState.buffer += e.key
      }
    }
    lineInputState.render(lineInputState.buffer)
  }
```

The printable-char branch preventDefaults *unconditionally inside the branch*, even when the buffer is at `maxLength` and the character is dropped — "engine swallowed the keystroke" is the right semantic regardless of buffer mutation (spec Section 6).

- [ ] **Step 6: Run tests, confirm new tests PASS, all existing PASS**

Reload tests.html. Expected: all rows green.

- [ ] **Step 7: Manual smoke test of input behavior**

1. Open `http://localhost:8000/`. Reach the save-name prompt (you may want to set `REQUIRED_DESCENTS = 1` and `COLLISION_DETECTION = false` at the top of `game.js` to get there fast — revert before commit!).
2. Type `JOHN`. Press Backspace twice. Buffer shows `JO`. No browser back-navigation.
3. Type `EY`. Press Enter. Saves as `JOEY`.
4. From the title screen "PRESS ANY KEY TO RUN", press Space. Resolves the prompt. No page scroll.
5. From the same prompt, press Tab. The browser default (focus the next element) still works — no preventDefault on unhandled keys.

If you tweaked the tuning constants for testing, revert them before committing.

- [ ] **Step 8: Commit**

```sh
git add src/input.js tests/input.test.js tests.html
git commit -m "preventDefault on handled non-direction keys in input.js"
```

---

## Self-review checklist (run before opening PR)

- [ ] All `tests.html` rows pass.
- [ ] Standalone game (`index.html`) boots, plays the title sequence, completes a full game, accepts a name on the score screen.
- [ ] Manual visibility smoke (Task 5 step 6) re-run: tab-away during play does not advance the snake or inflate the score.
- [ ] Manual input smoke (Task 6 step 7) re-run: Backspace doesn't navigate back; Space doesn't scroll the page; Tab still works for unhandled keys.
- [ ] No console errors during any of the above.
- [ ] `REQUIRED_DESCENTS` and `COLLISION_DETECTION` in `src/game.js` are at their original values (3 and `true`).
- [ ] `git log --oneline visibility-gate-and-input-prevent-default ^main` shows the per-task commits in clear, single-purpose form.
