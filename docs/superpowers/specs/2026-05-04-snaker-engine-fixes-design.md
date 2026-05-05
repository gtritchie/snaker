# Snaker engine — visibility gate and input preventDefault — design

**Status:** draft — full design written, awaiting user / roborev review
**Date:** 2026-05-04
**Branch:** `visibility-gate-and-input-prevent-default`

## Background

Two issues were flagged by roborev against `gtritchie/boring-astro`'s recent verbatim snapshot of this engine into `src/snaker/`. Both apply to upstream engine behavior, so they will be fixed here and re-snapshotted into the consumer rather than forked downstream.

**Finding 1 (Medium) — game loop and play timing don't pause when the tab is hidden.** The `visibilitychange` handler in `main.js` only suspends audio. The gameplay loop still advances through `setTimeout` sleeps (browsers throttle to ~1 Hz when hidden, but timers still fire), and `playRounds()` still accumulates `performance.now()` wall time while the tab is hidden. A player who tabs away mid-game returns with their score worse than it should be (because hidden time was charged) and the snake further along than it would be if they'd been playing.

**Finding 2 (Low) — `preventDefault()` missing on handled non-directional keys.** During "press any key" prompts and the save-name `lineInput`, handled keys (Space, Enter, Backspace, printable characters) don't call `preventDefault()`. The engine consumes them, but browser-default behavior (page scroll, back-navigation, form submit) still leaks through.

The engine was recently refactored to be embeddable (`boot(canvas, options?) → destroy`, container-aware sizing, canvas-scoped key handlers — see `2026-05-03-embed-snaker-design.md`). Both findings are gaps that survived that refactor. The snaker repo has no other consumers, so the public `boot()` API stays stable but internal mechanics may change freely.

## Constraints

- No build step. ES modules, no transpilation, no bundler.
- No new runtime dependencies.
- Plain JS, not TypeScript — match existing style.
- Public `boot(canvas, options?) → destroy` API unchanged.
- Snapshot-friendly: the downstream consumer copies `src/*.js` verbatim, so any new file under `src/` will flow into the snapshot automatically.

## Non-goals

- A general-purpose pause/resume API (e.g. exposing `pause()`/`resume()` on the engine for host-driven pausing). Visibility-driven pause is the only requirement; explicit pause is not requested.
- Replacing the existing `tracked()` abort plumbing.
- Reworking the touch handlers (already correct on `preventDefault`).
- Reworking the existing `audio.suspend()` / `audio.resume()` semantics — they already correctly drop scheduled oscillators on suspend.

## Open decisions (resolved)

| Decision | Choice | Reason |
| --- | --- | --- |
| Pause granularity for `sleep()` | **Strict** — resume with remaining ms | Same invariant as `visibleNow()` ("hidden time doesn't count"); marginal cost over loose semantics |
| Test strategy | **Both** — fake-clock unit tests + manual recipe | Pause/resume bookkeeping is bug-prone and hard to verify by tabbing away; integration-level coverage from manual recipe |
| Audio coupling | **Gate owns** `audio.suspend()` / `audio.resume()` | Visibility is wholly an engine concern; eliminates `main.js`'s handler entirely |
| Behavior at `boot()` while already hidden | **Initialize hidden** — sleeps don't resolve, audio stays suspended, until first visible event | Same invariant from t=0; one-line implementation |
| Audio.play scope | **Comprehensive** — route `audio.play()`'s internal pacing through the gate too | Avoids asymmetry where awaited `play()` calls advance through hidden time but `sleep()` doesn't |

---

## Section 1 — Architecture

**New module:** `src/visibility.js`, exporting a single factory:

```js
export function createVisibilityGate({ audio, document, now, setTimeout, clearTimeout } = {}) { … }
```

- `audio` — required when used by the engine (so the gate can call `audio.suspend()` / `audio.resume()`).
- `document`, `now`, `setTimeout`, `clearTimeout` — all default to browser globals. Injection seam exists for unit tests; production callers pass nothing extra.

**Public surface (4 methods):**

| Method | Purpose |
| --- | --- |
| `sleep(ms) → Promise<void>` | Resolves after `ms` of *visible* time. Pauses mid-flight on hide; resumes with the remaining ms on show. |
| `visibleNow() → number` | Monotonic visible-time clock. Advances at wall rate when visible, frozen while hidden. Two calls subtract to give elapsed visible ms; absolute value has no meaning. |
| `destroy() → void` | Removes the `visibilitychange` listener, clears all parked timers, rejects all in-flight sleeps with a sentinel error. Idempotent. |
| `_debug() → object` | Exposes `{ hidden, parkedCount, totalHiddenMs }` for unit tests only. Underscore-prefixed so it's not a public API contract. |

### Why `visibleNow()` instead of `elapsedSince(t)`

A naive `elapsedSince(t) = now() - t - totalHiddenMs` is buggy when a hidden interval falls *between* gate creation and `t`: the hidden time before `t` is incorrectly subtracted, returning under-counts or negatives. Caught by roborev review #622.

Two viable fixes:

- **(a) Two-arg form:** `elapsedSince(t, hiddenBaseline)`, callers capture `const baseline = visibility.totalHidden()` alongside `t`. Correct, but spreads two synchronized values across each call site — easy to forget the baseline.
- **(b) Monotonic visible-time clock:** `visibleNow()` returns `now() - hiddenSoFar`, where `hiddenSoFar` includes any in-progress hidden interval. Two calls subtract for elapsed visible time. No call-site baseline; the same one-call-and-subtract shape as today's `performance.now() - runStart`.

**Plan:** **(b)**. Smaller surface, naturally composable, structurally impossible to misuse.

**Wire-up in `runGame` (`src/game.js`):**

1. After `const audio = createAudio(...)`, construct: `const visibility = createVisibilityGate({ audio })`.
2. Replace `const sleep = (ms) => tracked(new Promise(r => setTimeout(r, ms)))` with `const sleep = (ms) => tracked(visibility.sleep(ms))`.
3. Pass the gate's sleep into `createAudio` so internal pacing also gates: `createAudio({ sleep: ms => visibility.sleep(ms) })`. (See note in Section 2 about why this is constructed earlier.)
4. In `playRounds`, replace both lines `const runStart = performance.now()` and `accumulatedMs += performance.now() - runStart` with `const runStart = visibility.visibleNow()` and `accumulatedMs += visibility.visibleNow() - runStart`. Same arithmetic shape; the clock just doesn't advance during hidden time.
5. In the returned object, expose `visibility` (or just its `destroy`) so `main.js`'s `destroy()` can call `visibility.destroy()` during teardown.

**Construction ordering wrinkle:** the gate needs `audio` (to suspend/resume on transitions), but `audio` needs `sleep` (which is the gate's). Two clean options:

- **(a) Two-phase construction:** `const visibility = createVisibilityGate({ audio: null })` first, then `const audio = createAudio({ sleep: visibility.sleep })`, then `visibility.attachAudio(audio)`. Adds an `attachAudio` method.
- **(b) Lazy audio reference:** the gate accepts a getter `audioRef: () => audio` instead of `audio` directly. Construct gate with the getter, then construct audio. The gate's visibility handler reads `audioRef()` lazily.

Either works. **Plan:** use **(b)** — one fewer method on the public surface. The getter is invoked only inside `visibilitychange` handlers (rare events), so any cost is negligible.

**Wire-up in `main.js`:**

- Delete the `onVisibility` function (lines 57–64).
- Delete the `document.addEventListener('visibilitychange', onVisibility)` (line 65).
- Delete the matching `removeEventListener` from `destroy()` (line 78).
- In `destroy()`, add `game.visibility.destroy()` **after** `game.setDestroyed()` so that any sleep rejected by gate teardown surfaces with `destroyed === true` and is swallowed by `runGame`'s catch (see Section 4).

**`audio.js` change:** `createAudio()` becomes `createAudio(opts = {})` accepting an optional `sleep` function. The internal `await new Promise(resolve => setTimeout(resolve, elapsedSec * 1000))` at line 364 becomes `await sleep(elapsedSec * 1000)`. The default value of `sleep` is `(ms) => new Promise(r => setTimeout(r, ms))` so the function works without injection (preserves the existing `playparser.test.js` and any future direct unit tests of `createAudio`).

**Files touched:**

- New: `src/visibility.js`
- Modified: `src/game.js`, `src/audio.js`, `src/main.js`, `src/input.js`, `tests.html`
- New tests: `tests/visibility.test.js`

---

## Section 2 — Visibility gate internals

### State

```js
let hidden = (document.visibilityState === 'hidden')   // current visibility
let hiddenSince = hidden ? now() : null                // start of current hidden interval, or null
let totalHiddenMs = 0                                  // accumulated hidden time since gate creation
const parked = new Set()                               // sleeps currently paused (each entry is a Sleeper)
const active = new Set()                               // sleeps currently running on a real timer
let destroyed = false                                  // post-destroy() guard
```

### Sleeper object

Each `sleep(ms)` call creates one `Sleeper`:

```js
{
  remaining: number,      // ms still owed when last started/resumed
  startedAt: number,      // now() at most recent start (used to compute elapsed when parking)
  timerId: number | null, // setTimeout id while running, null while parked
  resolve: () => void,    // resolves the user's awaited promise
  reject: (err) => void,  // rejects with VisibilityGateDestroyedError on destroy()
}
```

### `sleep(ms)`

```js
function sleep(ms) {
  if (destroyed) return Promise.reject(new VisibilityGateDestroyedError())
  return new Promise((resolve, reject) => {
    const sleeper = { remaining: ms, startedAt: now(), timerId: null, resolve, reject }
    if (hidden) {
      parked.add(sleeper)
    } else {
      start(sleeper)
    }
  })
}

function start(sleeper) {
  sleeper.startedAt = now()
  active.add(sleeper)
  sleeper.timerId = setTimeout(() => {
    active.delete(sleeper)
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
```

### `visibleNow()`

```js
function visibleNow() {
  let hiddenSoFar = totalHiddenMs
  if (hidden && hiddenSince !== null) hiddenSoFar += now() - hiddenSince
  return now() - hiddenSoFar
}
```

**Correctness.** Monotonic non-decreasing: `now()` only grows, `hiddenSoFar` only grows, and `hiddenSoFar` grows at most as fast as `now()` (it grows at the same rate while hidden, doesn't grow at all while visible). Difference of two calls equals the wall-clock time between them minus any hidden interval that lies inside that window — correct for any pair of calls regardless of when each was made, including pairs that bracket multiple hidden intervals.

**Hidden time before gate creation is fine.** `totalHiddenMs` starts at 0 at gate construction. Pre-construction visibility events don't exist for the gate. Two `visibleNow()` calls made after construction subtract correctly; absolute values are not exposed to callers.

### Visibility transitions

```js
function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && !hidden) {
    hidden = true
    hiddenSince = now()
    for (const sleeper of [...active]) park(sleeper)
    // audio.suspend() returns undefined when AudioContext doesn't exist yet
    Promise.resolve(audioRef()?.suspend()).catch(err =>
      console.warn('audio: visibility suspend failed:', err))
  } else if (document.visibilityState !== 'hidden' && hidden) {
    hidden = false
    if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
    hiddenSince = null
    for (const sleeper of [...parked]) {
      parked.delete(sleeper)
      start(sleeper)
    }
    Promise.resolve(audioRef()?.resume()).catch(err =>
      console.warn('audio: visibility resume failed:', err))
  }
}
document.addEventListener('visibilitychange', onVisibilityChange)
```

### `destroy()`

```js
function destroy() {
  if (destroyed) return
  destroyed = true
  document.removeEventListener('visibilitychange', onVisibilityChange)
  for (const sleeper of [...active]) {
    clearTimeout(sleeper.timerId)
    sleeper.reject(new VisibilityGateDestroyedError())
  }
  for (const sleeper of [...parked]) {
    sleeper.reject(new VisibilityGateDestroyedError())
  }
  active.clear()
  parked.clear()
}
```

`VisibilityGateDestroyedError` is a small named-error class so callers can distinguish it from `GameAbortedError`. The interaction with `tracked()` is intentional: by the time `destroy()` runs, `setDestroyed()` has already flipped the engine into "shutting down" mode, so `tracked()` rejection of these promises with `VisibilityGateDestroyedError` is harmless — the outer `runGame` loop checks `destroyed` and returns. (It catches only `GameAbortedError`; any other error propagates out to `game.promise.catch(...)` in `main.js`, which is fine since the page is being torn down.)

---

## Section 3 — Data flow

### Sequence A: normal sleep, no visibility change

1. `singleDescent` calls `await sleep(150)`.
2. `sleep(150)` creates a Sleeper, sees `hidden === false`, calls `start(sleeper)`.
3. `setTimeout` fires after 150 ms; `sleeper.resolve()` runs; the promise resolves; `singleDescent` continues.

No interaction with the visibility machinery. Identical observable behavior to today.

### Sequence B: tab hides during a sleep, returns later

1. `singleDescent` calls `await sleep(150)` at t=0.
2. Sleeper starts; `setTimeout` armed.
3. At t=80 ms, `visibilitychange → hidden` fires.
   - `hidden = true`, `hiddenSince = 80`.
   - `park(sleeper)`: `clearTimeout`, `remaining = 150 - 80 = 70`, moved to `parked` set.
   - `audio.suspend()` invoked.
4. At t=30000 ms (29.9 s later), `visibilitychange → visible` fires.
   - `totalHiddenMs += 30000 - 80 = 29920`.
   - `hiddenSince = null`, `hidden = false`.
   - For each parked sleeper: `start(sleeper)` — re-arms `setTimeout(70 ms)`.
   - `audio.resume()` invoked.
5. At t=30070 ms, the new `setTimeout` fires; `singleDescent` continues.

Total elapsed wall time: 30070 ms. Total *visible* time the sleeper waited: 150 ms. Snake advanced exactly one step, as if the player had just held still for 150 ms.

### Sequence C: `playRounds` score timing during a hidden interval

1. At wall t=1000, `runStart = visibility.visibleNow() = 1000` (no hidden time accumulated yet).
2. Player plays for 5 s (visible) — snake advances normally.
3. At wall t=6000, tab hides. `hiddenSince = 6000`.
4. Player tabs back at wall t=36000 (30 s later). `totalHiddenMs += 30000 = 30000`, `hiddenSince = null`.
5. Player finishes the descent at wall t=40000.
6. `accumulatedMs += visibility.visibleNow() - runStart`.
   - `visibility.visibleNow() = 40000 - 30000 = 10000`.
   - Delta: `10000 - 1000 = 9000`.
7. Score gets 9 s — exactly what was visibly played (5 s before hide + 4 s after show).

### Sequence C2: hidden interval *before* `runStart` (the roborev case)

1. Gate created at wall t=0. `totalHiddenMs = 0`.
2. Tab hides at t=1000. Tab returns at t=10000. `totalHiddenMs = 9000`.
3. At wall t=11000, `runStart = visibility.visibleNow() = 11000 - 9000 = 2000`.
4. Player plays for 5 s (visible).
5. At wall t=16000, `visibility.visibleNow() = 16000 - 9000 = 7000`.
6. Delta: `7000 - 2000 = 5000` ✓ — exactly the visible 5 s, despite 9 s of hidden time before `runStart`.

(The previous-spec `elapsedSince(11000)` returned `16000 - 11000 - 9000 = -4000` here. Bug fixed by construction.)

### Sequence D: awaited audio.play() spans a visibility transition

1. Title music starts: `await tracked(audio.play(TITLE_MUSIC))`.
2. Internally `audio.play()` schedules oscillators, then `await sleep(elapsedSec * 1000)` (the gate's sleep, after refactor).
3. Tab hides mid-music.
   - Gate parks the audio sleep.
   - Gate calls `audio.suspend()`, which drops the scheduled oscillators.
4. Tab returns 30 s later.
   - Gate calls `audio.resume()` — but `audio.suspend()` already dropped oscillators, so no audio plays for the parked-music remainder.
   - Gate restarts the audio sleep with its remaining ms.
5. After the remaining ms elapses (in silence), `audio.play()` resolves; the next sequencing step (e.g. the second WIN_PHRASE) runs.

Caveat: the second-half audio of an interrupted phrase is *silent* because the suspend dropped the queued oscillators. This matches today's behavior already — `audio.suspend()` drops oscillators today too — but with the gate, sequencing also pauses, so the user doesn't see a partial title screen advance during hidden time.

### Sequence E: `boot()` while tab is already hidden

1. `boot(canvas)` runs while tab is hidden.
2. `runGame` constructs gate; `hidden = true`, `hiddenSince = now()`, `audio.suspend()` called immediately on first transition (or on construction — see below).
3. `titleScreen` calls `await tracked(input.waitForKey())`. This isn't a sleep, so it isn't gated — but it requires user interaction which can't happen while the tab is hidden, so it naturally blocks.
4. If `boot()` proceeds further (e.g. setup music via `await tracked(audio.play(...))`), the audio sleep is parked until visible. The visible "RUN" prompt isn't drawn until the engine reaches the corresponding `screen.poke` calls — which run synchronously, so the prompt *is* drawn even while hidden. That's fine; it'll be the first thing the user sees on tab return.

**Implementation refinement for E:** if `hidden === true` at gate construction, the gate does NOT call `audio.suspend()` proactively, because `audio` may not yet have an `AudioContext` and there's nothing to suspend. The first `visibilitychange → visible` event will fire `audio.resume()` (a no-op until the user interacts), and the first `visibilitychange → hidden` event after that will suspend correctly.

---

## Section 4 — Error handling

### Abort coupling

Today, `tracked(promise)` wraps any promise so that `fireAbort()` can reject it with `GameAbortedError`. The gate's `sleep()` is wrapped via `tracked(visibility.sleep(ms))` (same call site as today), so ESC mid-sleep behaves identically: the wrapper rejects, the underlying timer continues to its natural end, and the timer's eventual `resolve()` is ignored by the wrapper.

Net new behavior on ESC: nothing — the underlying `Sleeper` (whether parked or active) still tries to resolve. Once it does, `resolve()` is a no-op because `tracked` has already rejected. Memory: one `Sleeper` lingers in `active`/`parked` until its remaining ms elapses. This is identical to today's "the underlying Promise is left to settle on its own" comment in `tracked()` (game.js line 86) and acceptable.

If there's concern about stale parked sleepers piling up (e.g. ESC pressed many times during long hidden intervals), a future enhancement could expose `visibility.cancelAll()` for `fireAbort()` to call. **Not in scope** for this change — current usage doesn't accumulate.

### Audio failure

`audio.suspend()` and `audio.resume()` may return `undefined` (no AudioContext yet) or a Promise that rejects (rare, but possible in odd browser states). The gate's transition handler wraps both in `Promise.resolve().catch()` — same defensive shape as today's handler in `main.js`.

### Document not present

The gate accepts an injected `document` (defaults to global). Unit tests pass a fake. If somehow the global `document` is missing in a non-browser context (Node, worker), the gate will throw on construction — that's correct; the engine doesn't run outside the browser.

### Gate destroyed mid-sleep

A `sleep()` in flight when `destroy()` is called rejects with `VisibilityGateDestroyedError`. Through `tracked()`, this surfaces in the `runGame` outer loop's catch. The catch only swallows `GameAbortedError`; `VisibilityGateDestroyedError` propagates to `game.promise.catch(...)` in `main.js`, which logs it and renders the crash overlay.

For a clean shutdown (`destroy()` was called intentionally), `setDestroyed()` is called *before* `visibility.destroy()`, and `runGame` checks `destroyed` after the catch. We update the catch to also swallow `VisibilityGateDestroyedError` *iff* `destroyed === true`, mirroring the existing `GameAbortedError` handling. This keeps intentional shutdown clean while still surfacing unexpected gate destruction as a crash.

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

---

## Section 5 — Testing

### Unit tests (new file: `tests/visibility.test.js`)

Use the existing harness (`tests/harness.js`). Construct the gate with a fake clock and fake `document`:

```js
function makeFakeEnv(initiallyHidden = false) {
  let currentTime = 0
  const timers = []  // { id, fireAt, fn }
  let nextId = 1
  const listeners = new Set()
  const fakeDocument = {
    visibilityState: initiallyHidden ? 'hidden' : 'visible',
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.delete(fn) },
  }
  return {
    now: () => currentTime,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, fireAt: currentTime + ms, fn }); return id },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) },
    documentRef: fakeDocument,
    advance(ms) {
      const target = currentTime + ms
      while (true) {
        const due = timers.filter(t => t.fireAt <= target).sort((a,b) => a.fireAt - b.fireAt)
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
      for (const fn of listeners) fn()
    },
  }
}
```

**Test cases:**

1. `sleep(100)` resolves after the fake clock advances 100 ms with no visibility change.
2. `sleep(100)` parked at t=80 resumes after `visible` fires at t=30000 and resolves at t=30020.
3. Two concurrent `sleep(50)` and `sleep(150)` both park on hide at t=20, both resume on show at t=1000, resolve at t=1030 and t=1130 respectively.
4. `visibleNow()` advances at wall rate while visible: two calls 100 ms apart differ by 100.
5. After a 5-s visible run, 30-s hidden run, 4-s visible run, the difference of `visibleNow()` between start and end is 9000.
6. `visibleNow()` does NOT advance while hidden: the value is identical at hide-time and at any later moment before show.
6b. **Roborev regression case:** gate created, hidden 1000–10000, `t1 = visibleNow()` at wall 11000, advance 5000 wall ms (visible), `t2 = visibleNow()`. Assert `t2 - t1 === 5000` (not negative).
7. `boot()` while hidden: `sleep(100)` doesn't resolve until `visible` fires.
8. `destroy()` rejects all in-flight sleeps with `VisibilityGateDestroyedError`.
9. `destroy()` removes the `visibilitychange` listener (verify via fake document's listener set is empty).
10. `audio.suspend()` is called on hide and `audio.resume()` is called on show (mock audio, assert call counts).
11. Gate constructed when `document.visibilityState === 'hidden'` does NOT call `audio.suspend()` (audio context may not exist; first hide-after-show suspends correctly).

### Integration tests (extend or add to existing files)

Out of scope. The current harness has no integration coverage of `runGame` (only unit tests for `formatScore`, `parsePlayString`, etc.), and adding one would require a fake DOM. The manual recipe (below) covers integration.

### Tests for Finding 2

Add to `tests/visibility.test.js` or a new `tests/input.test.js`. Construct an input via `createInput(fakeCanvas)` where `fakeCanvas` is a stub with `addEventListener`/`removeEventListener` capture. Synthesize keydown events with `preventDefault` spies and assert:

12. Space key during `waitForKey()` resolves the wait AND `preventDefault` was called.
13. Space key with no waiter pending does NOT call `preventDefault`.
14. Enter during `lineInput()` resolves the input AND `preventDefault` was called.
15. Backspace during `lineInput()` shrinks buffer AND `preventDefault` was called.
16. Printable char (`'a'`) during `lineInput()` appends AND `preventDefault` was called.
17. Printable char during `lineInput()` when buffer is at `maxLength` is dropped AND `preventDefault` was called.
18. Printable char during `lineInput()` with `Ctrl` held is NOT consumed AND `preventDefault` was NOT called.
19. Tab key (no handler) during any state does NOT call `preventDefault`.

### Manual smoke recipe (document in `README.md` or PR description)

1. Open `index.html` in a browser. Press a key to start.
2. During the title music: tab away, count to 30, tab back. Title music should resume from where it was (or the current piece restarts depending on browser autoplay policy); no oscillator burst.
3. Begin a descent. Tab away mid-descent for 30 s. Tab back. Snake should be exactly where you left it.
4. Complete three descents using tab-away mid-game; record the score.
5. Repeat three descents without tabbing away; record the score.
6. The two scores should be within normal play variance — hidden time should NOT have inflated the first.
7. Reach the save-name prompt. Type `JOHN` and press Backspace twice — buffer should show `JO`, no browser back-navigation. Type `EY` and press Enter — name should save as `JOEY`, no parent-form submission.
8. From the title screen, press Space — should resolve the prompt with no page scroll.

Add the recipe to a new `## Manual test recipes` section in `README.md`, or include it in the PR body. **Plan:** include in PR body only — keeping `README.md` focused on usage, not test plans.

---

## Section 6 — Finding 2: `preventDefault` on handled non-direction keys

### `src/input.js` changes

**`onKeyDown` (`waitForKey` resolution path) — add `preventDefault` before resolving:**

```js
if (keyListeners.length > 0) {
  e.preventDefault()
  const resolvers = keyListeners.splice(0)
  for (const r of resolvers) r(e.key)
}
```

This is gated on `keyListeners.length > 0` — i.e., we only `preventDefault` when the engine is actually consuming the key. Bare keystrokes (no waiter, no line input) keep their default behavior so Tab, Cmd+R, etc. still work.

Order matters: call `preventDefault()` *before* invoking resolvers, so even if a resolver throws, the default is still suppressed.

**`handleLineInputKey` — add `preventDefault` to each consuming branch:**

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
    if (lineInputState.buffer.length < lineInputState.maxLength) {
      lineInputState.buffer += e.key
    }
  }
  lineInputState.render(lineInputState.buffer)
}
```

Three branches that consume keys; `preventDefault` is called in each. The ctrl/meta/alt-modifier branch still falls through to `render()` without consuming, so its keys keep default behavior (e.g. Ctrl+R reloads, Cmd+C copies).

The **printable-char branch** preventDefaults *unconditionally inside the branch*, even when the buffer is at `maxLength` and the character is dropped. Rationale: "the engine swallowed the keystroke" is the right semantic, regardless of whether the buffer mutated. Otherwise typing past max would let the `M` key trigger Find-in-Page or whatever the user has bound.

### Direction keys and ESC

Already correct. `setKbKeyFromEvent` calls `preventDefault` on any direction key it handles (`input.js:56`); ESC has its own `preventDefault` (`input.js:62`). No changes.

### Anti-double-handling sanity check

`setKbKeyFromEvent` runs unconditionally before the line-input / `waitForKey` branches. If a direction key arrives during line input:

- `setKbKeyFromEvent` sets the kbKey and calls `preventDefault` (handled = direction).
- Falls through to `handleLineInputKey`.
- Doesn't match Enter, Backspace, or printable-1-char (arrow keys are multi-char strings like `'ArrowLeft'`).
- Reaches `lineInputState.render()` with unchanged buffer — visually a no-op.

Behavior is correct; the double `preventDefault` would not be called (only `setKbKeyFromEvent`'s fires). No code change for this case.

If a direction key arrives during a `waitForKey()` (e.g. on the title screen):

- `setKbKeyFromEvent` sets the kbKey and calls `preventDefault`.
- Falls through to the `keyListeners.length > 0` branch, calls our new `preventDefault` (already prevented — second call is a harmless no-op per HTML spec).
- Resolves the waiter with `e.key` (e.g. `'ArrowLeft'`).
- The caller (`titleScreen`) treats any key as "press any key to continue" — fine.

### Files touched

- Modified: `src/input.js` (one new `preventDefault` in `onKeyDown`, three in `handleLineInputKey`).

---

## What stays the same

- `boot(canvas, options?) → destroy` public API.
- `destroy()` behavior — gains the gate's cleanup, otherwise unchanged.
- The `tracked()` abort plumbing.
- All gameplay constants, sleep durations, scoring formula.
- Touch handling.
- Direction key mappings, ESC handling.
- Line-input character set and length cap.
- All audio sequencing constants.
- BASIC-fidelity comments and line references throughout `game.js`.

## Suggested commit shape

Per the original brief: two commits on this one branch.

1. **"Pause game loop and play timing while tab is hidden"** — adds `src/visibility.js`, modifies `game.js` (sleep replacement, playRounds visible-time clock, audio wiring), modifies `audio.js` (sleep injection), removes visibility handler from `main.js`, adds `tests/visibility.test.js` (cases 1–11), registers it in `tests.html`.
2. **"preventDefault on handled non-direction keys"** — modifies `src/input.js`, adds input tests (cases 12–19) — either appended to the visibility test file or in a new `tests/input.test.js`. **Plan:** new `tests/input.test.js` to keep file boundaries clean.

## Verification

- `tests.html` should pass with all new test cases.
- Manual recipe (Section 5) — execute end-to-end in a real browser before opening the PR.
- After merge: `cp /Users/gary/code/snaker/src/*.js /Users/gary/code/boring-astro/src/snaker/` and re-run roborev there. Both findings should clear.
