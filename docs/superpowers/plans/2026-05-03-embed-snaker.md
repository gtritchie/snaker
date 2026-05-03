# Embeddable snaker engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the snaker engine so any host page can drop in a `<canvas>`, call `boot(canvas)`, and get a self-contained game that scales to its container, scopes input to the canvas, and tears down cleanly via a returned `destroy()`.

**Architecture:** Surgical patch to existing files (no new modules). `boot()` becomes the lifecycle owner — it resolves the sizing container, snapshots/applies the canvas's three engine-essential inline styles, sets up a `ResizeObserver`, registers the visibility/focus helpers, starts `runGame()` (which now returns a controller), and composes a single `destroy()` that unwinds everything in a documented order. `runGame()` moves its abort plumbing (`tracked`/`sleep`/`fireAbort`) into per-instance closures so two embedded canvases never cross-pollute. Keyboard listeners move from `window` to `canvas`, and `index.html` becomes a thin host page.

**Tech Stack:** Vanilla ES modules, no transpilation, no bundler, no test runner. Verification is in-browser only (open `tests.html` for the existing in-browser harness; open `index.html` and the manual scenarios in `docs/superpowers/specs/2026-05-03-embed-snaker-design.md` Section 6 for end-to-end smoke tests).

**Source spec:** [`docs/superpowers/specs/2026-05-03-embed-snaker-design.md`](../specs/2026-05-03-embed-snaker-design.md)

**Branch:** `embed-snaker-design` (the spec already lives on this branch; continue here).

---

## File map

| File | Touched | Responsibility after the refactor |
| --- | --- | --- |
| `src/screen.js` | modified | Adds an early-return to `setScale` when scale is unchanged. Otherwise unchanged. |
| `src/input.js` | modified | Keyboard listeners attached to the canvas instead of `window`; `destroy()` removes the canvas-scoped listeners. |
| `src/game.js` | modified | `tracked` / `sleep` / `fireAbort` move into `runGame()`'s closure. `runGame()` returns a controller object instead of a bare promise. New `computeScale(container, canvas)` exported. The window `resize` listener is removed. |
| `src/main.js` | modified | `boot(canvas, options?)` becomes the lifecycle owner: container resolution, `ResizeObserver`, `tabindex`, mousedown click-to-focus, inline-style snapshot/restore, `WeakMap` re-entry guard, full `destroy()` composition. |
| `index.html` | modified | Stripped of engine-essential CSS (now applied inline by `boot()`); keeps only host-page styling. |
| `README.md` | modified | Adds an "Embedding" section. |

No new files. No new dependencies. No build step changes.

---

## Manual verification baseline

Two reference points for "didn't break anything" between tasks:

- **Existing tests:** open `http://localhost:8000/tests.html`. All rows must show PASS. Run after every task.
- **Standalone game:** open `http://localhost:8000/`. Game must run through pre-title → title → at least one descent without console errors. Run after every task that touches `game.js`, `input.js`, or `main.js`.

To start the server:

```sh
python3 -m http.server 8000
```

Leave it running through all tasks.

---

## Task 1: Initialize canvas dimensions + `setScale` early-return in `src/screen.js`

**Why:** Two coupled changes per spec Section 2.

1. The width-only fallback (Section 2) causes the `ResizeObserver` to fire on every canvas resize because the canvas resize changes the parent's intrinsic height. Without an early-return in `setScale`, every callback invocation triggers a full `redrawAll()` and may produce "ResizeObserver loop completed with undelivered notifications" browser warnings.
2. The early-return alone introduces a regression: `scale` initializes to `1`, so the very first `setScale(1)` call returns without ever sizing the canvas. Once Task 5 strips the `width="256" height="192"` HTML attrs from `index.html`, the canvas would stay at the browser default `300×150`. Fix by initializing `canvas.width`/`canvas.height` explicitly inside `createScreen` so `scale=1` actually matches the canvas backing store.

**Files:**
- Modify: `src/screen.js:13-19` (initialize canvas dimensions in `createScreen`)
- Modify: `src/screen.js:22-28` (`setScale` early-return)

- [ ] **Step 1: Read the current `createScreen` opening and `setScale`**

```bash
sed -n '13,28p' src/screen.js
```

Expected output:

```js
export function createScreen(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.imageSmoothingEnabled = false

  const vram = new Uint8Array(VRAM_SIZE)
  let scale = 1
  let inverted = false   // global crash-flash flip; SCREEN 0,1 / SCREEN 0,0 in the original

  function setScale(s) {
    scale = Math.max(1, Math.floor(s))
    canvas.width = NATIVE_WIDTH * scale
    canvas.height = NATIVE_HEIGHT * scale
    ctx.imageSmoothingEnabled = false
    redrawAll()
  }
```

- [ ] **Step 2: Initialize canvas dimensions explicitly in `createScreen`**

Find the line `ctx.imageSmoothingEnabled = false` near the top of `createScreen` (line 16). Insert two new lines immediately after it:

```js
  ctx.imageSmoothingEnabled = false

  // Make the backing store match scale=1 explicitly, so a setScale(1) call is
  // correctly a no-op (rather than the canvas staying at the browser default
  // 300x150 after index.html drops its width/height attrs).
  canvas.width = NATIVE_WIDTH
  canvas.height = NATIVE_HEIGHT

  const vram = new Uint8Array(VRAM_SIZE)
```

- [ ] **Step 3: Add the early-return to `setScale`**

Replace the existing `setScale` body (was lines 22-28) with:

```js
  function setScale(s) {
    const next = Math.max(1, Math.floor(s))
    if (next === scale) return
    scale = next
    canvas.width = NATIVE_WIDTH * scale
    canvas.height = NATIVE_HEIGHT * scale
    ctx.imageSmoothingEnabled = false
    redrawAll()
  }
```

- [ ] **Step 4: Verify existing tests pass**

Open `http://localhost:8000/tests.html` in the browser. Confirm every row says PASS.

- [ ] **Step 5: Verify standalone game runs**

Open `http://localhost:8000/`. Click the canvas (browsers may need a click before audio unlock). Confirm pre-title → title music → press-any-key → first descent works without console errors.

- [ ] **Step 6: Commit**

```bash
git add src/screen.js
git commit -m "Init canvas dims in createScreen; early-return setScale on no-change"
```

---

## Task 2: Move keyboard listeners from `window` to `canvas` (paired with `tabindex` + click-to-focus in `boot()`)

**Why:** Spec Section 3. Window-scoped listeners with unconditional `preventDefault` swallow page-level keys (browser shortcuts, theme toggles) when the engine is embedded. Moving the listeners to the canvas, plus making the canvas focusable and click-to-focus, scopes input correctly. **Both halves must land together** — moving listeners alone breaks the standalone game (no path to focus the canvas).

**Files:**
- Modify: `src/input.js:163-164` (window listeners → canvas listeners)
- Modify: `src/input.js:200-209` (`destroy()` removes canvas listeners instead of window)
- Modify: `src/main.js:3-23` (`boot()` adds `tabindex` and `mousedown` focus helper)

- [ ] **Step 1: Switch the keydown/keyup listener target in `src/input.js`**

Find lines 163-164:

```js
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
```

Replace with:

```js
  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('keyup', onKeyUp)
```

- [ ] **Step 2: Update `destroy()` in `src/input.js` to match**

Find lines 200-209:

```js
  function destroy() {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    if (isTouchDevice) {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }
```

Replace with:

```js
  function destroy() {
    canvas.removeEventListener('keydown', onKeyDown)
    canvas.removeEventListener('keyup', onKeyUp)
    if (isTouchDevice) {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }
```

- [ ] **Step 3: Add `tabindex` setup and `mousedown` focus helper in `boot()`**

Find the start of `boot` in `src/main.js:3`:

```js
export function boot(canvas) {
  let audioRef = null

  // Pause audio when the tab is hidden; resume when visible again. Without this,
  // a backgrounded game would keep stepping (via setTimeout) and audio would
  // continue playing — both undesirable.
  const onVisibility = () => {
```

Insert two new blocks immediately after the `let audioRef = null` line, **before** the `onVisibility` declaration. The result should read:

```js
export function boot(canvas) {
  let audioRef = null

  // Make the canvas focusable so keyboard events reach it. Don't override a
  // host that has already set its own tabindex.
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0

  // Canvases don't take focus on click by default. Without this, a desktop
  // player would have to Tab into the canvas before keys register.
  const onMouseDown = () => canvas.focus({ preventScroll: true })
  canvas.addEventListener('mousedown', onMouseDown)

  // Pause audio when the tab is hidden; resume when visible again. Without this,
  // a backgrounded game would keep stepping (via setTimeout) and audio would
  // continue playing — both undesirable.
  const onVisibility = () => {
```

(No teardown for `onMouseDown` yet — it lands in Task 4 along with the rest of `destroy()`.)

- [ ] **Step 4: Verify existing tests pass**

Open `http://localhost:8000/tests.html`. All rows PASS.

- [ ] **Step 5: Verify standalone game still works**

Open `http://localhost:8000/`. **Click the canvas first**, then press any key. Confirm:

- Pre-title accepts keys after click.
- Arrow keys / WASD steer during play.
- Esc aborts to pre-title.
- Click outside the canvas (e.g. the address bar), then press arrow keys — page does not capture them as game input.

- [ ] **Step 6: Commit**

```bash
git add src/input.js src/main.js
git commit -m "Scope keyboard input to canvas with tabindex + click-to-focus"
```

---

## Task 3: Move abort plumbing into per-`runGame()` closures

**Why:** Spec Section 5. Today `abortRejecters` / `fireAbort` / `tracked` / `sleep` live at module scope in `src/game.js`, so two embedded canvases would share a single `Set` of rejecters — destroying one would abort in-flight promises in the other. Moving them inside `runGame()` is a behavior-preserving refactor for the single-instance case but a prerequisite for multi-instance embeds and for the per-instance `destroy()` in Task 4.

**No external API change in this task.** `runGame(canvas, registerAudio)` still has the same signature and the standalone game must keep working identically.

**Files:**
- Modify: `src/game.js:44-90` (delete module-level abort state)
- Modify: `src/game.js:107-136` (declare per-instance abort state inside `runGame`)
- Modify: every helper that closes over module-level `tracked` or `sleep` — thread them via a `ctx` argument

**Implementation strategy:** define `tracked`, `sleep`, `fireAbort`, `abortRejecters` inside `runGame()`. Pass a `ctx = { screen, audio, input, tracked, sleep }` object to the gameplay helpers (`runMainFlow`, `winSequence`, `showScore`, `captureNewBestScore`, `showBestScore`, `playAgainPrompt`, `playRounds`, `singleDescent`, `crashHandler`, `celebrateRun`, `titleScreen`, `setup`). This keeps `runGame()` itself under the 100-line/function limit per `CLAUDE.md`.

- [ ] **Step 1: Delete the module-level abort plumbing**

In `src/game.js`, delete lines 44-90 (the `abortRejecters` set, `fireAbort`, `tracked`, and `sleep` definitions). The `GameAbortedError` class (lines 40-42) **stays** at module scope — it's a marker type with no instance state.

After this delete, the file will be temporarily broken — every helper that calls `tracked(...)` or `sleep(...)` will reference an undefined symbol. The next steps fix that.

- [ ] **Step 2: Define the per-instance versions inside `runGame`**

Find `export async function runGame(canvas, registerAudio = () => {}) {` (was line 107). Immediately after the line `pickInitialScale(screen)`, insert:

```js
  const abortRejecters = new Set()

  const fireAbort = () => {
    const list = [...abortRejecters]
    abortRejecters.clear()
    for (const r of list) {
      try {
        r()
      } catch (err) {
        // A rejecter throwing means a tracked() promise is in an inconsistent state;
        // swallow so one bad rejecter can't prevent others from firing, but log so
        // the underlying bug isn't invisible.
        console.warn('fireAbort: rejecter threw:', err)
      }
    }
  }

  const tracked = (promise) => new Promise((resolve, reject) => {
    let settled = false
    const rejecter = () => {
      if (settled) return
      settled = true
      reject(new GameAbortedError())
    }
    abortRejecters.add(rejecter)
    Promise.resolve(promise).then(
      v => {
        if (settled) return
        settled = true
        abortRejecters.delete(rejecter)
        resolve(v)
      },
      e => {
        if (settled) return
        settled = true
        abortRejecters.delete(rejecter)
        reject(e)
      },
    )
  })

  const sleep = (ms) => tracked(new Promise(r => setTimeout(r, ms)))

  const ctx = { screen, audio, input, tracked, sleep }
```

- [ ] **Step 3: Replace the inline `audio.flush(); fireAbort()` Esc handler call**

The existing block (was around line 117) reads:

```js
  input.onEscape(() => {
    audio.flush()
    fireAbort()
  })
```

After step 2 this still works because `fireAbort` is now a closure variable in scope. **No change needed here**, but verify it still references the new `fireAbort` and not the (now deleted) module-level one.

- [ ] **Step 4: Thread `ctx` through `runMainFlow`**

Find the `runMainFlow` declaration (was around line 138). Change its signature from:

```js
async function runMainFlow(screen, audio, input) {
```

to:

```js
async function runMainFlow(ctx) {
  const { screen, audio, input } = ctx
```

Update its callers inside `runGame` to pass `ctx` instead of three positional args:

```js
      await runMainFlow(ctx)
```

Inside `runMainFlow`, every call to a sub-helper that previously took `(screen, audio, input)` becomes `(ctx)` (or `(ctx, ...extras)` where the helper takes additional args). Specifically rewrite the helper invocations:

```js
    await setup(ctx)
    const elapsed = await playRounds(ctx)
    await winSequence(ctx)
    const displayTime = await showScore(ctx, elapsed)
    if (elapsed < bestTicks) {
      bestTicks = elapsed
      await captureNewBestScore(ctx, elapsed, displayTime)
    }
    await showBestScore(ctx)
    if (!(await playAgainPrompt(ctx))) {
```

And `await titleScreen(ctx)` for the call before the `while (true)` loop.

- [ ] **Step 5: Update each helper to take `ctx`**

Apply the same rewrite to each helper. Concrete signatures after this step:

```js
async function winSequence(ctx) {
  const { screen, audio, tracked } = ctx
  // ...existing body, replacing bare tracked() calls with ctx-destructured tracked
}

async function showScore(ctx, elapsed) {
  const { screen, audio, tracked, sleep } = ctx
  // ...
}

async function captureNewBestScore(ctx, elapsed, displayTime) {
  const { screen, input, tracked } = ctx
  // ...
}

async function showBestScore(ctx, audio) {
  // signature note: `audio` was already a parameter; keep it. Destructure
  // the rest from ctx:
  const { screen, tracked, sleep } = ctx
  // ...
}
```

Wait — `showBestScore` only took `(screen, audio)` originally. Standardize: every helper takes `(ctx, ...extras)` where `extras` is task-specific data (elapsed, displayTime). Audio comes from `ctx.audio`. Final signatures:

```js
async function titleScreen(ctx)
async function setup(ctx)
async function playRounds(ctx)            // returns total elapsed ticks
async function singleDescent(ctx, init)
async function crashHandler(ctx, state)
async function celebrateRun(ctx)
async function winSequence(ctx)
async function showScore(ctx, elapsed)    // returns displayTime
async function captureNewBestScore(ctx, elapsed, displayTime)
async function showBestScore(ctx)
async function playAgainPrompt(ctx)
```

For each helper body, add a destructure line near the top:

```js
const { screen, audio, input, tracked, sleep } = ctx
```

(Destructure only the keys the helper actually uses; the others can stay omitted to keep the no-warnings-policy clean — though there's no linter, the CLAUDE.md "Zero warnings policy" applies to whatever tools you do run.)

- [ ] **Step 6: Verify existing tests pass**

Open `http://localhost:8000/tests.html`. All rows PASS.

If a test references `tracked` or `sleep` from `game.js`, it will fail (those exports no longer exist at module level). The current tests do not import them — `formatScore` is the only export tests touch — but verify by searching:

```bash
grep -rn "from.*game\.js" tests/
```

Expected: only references to `formatScore` (or no references at all).

- [ ] **Step 7: Verify standalone game runs end-to-end**

Open `http://localhost:8000/`. Play through:

- Pre-title (click + key).
- Title music + press-any-key.
- At least one full descent.
- Press Esc mid-descent — confirm it aborts to pre-title (this exercises the new per-instance `fireAbort`).
- Crash into a car — confirm the crash flash + reset works (this exercises `crashHandler` via the new `ctx` plumbing).

- [ ] **Step 8: Commit**

```bash
git add src/game.js
git commit -m "Move abort plumbing into per-runGame closures"
```

---

## Task 4: `runGame` returns a controller; full `boot()` rewrite with `destroy()`

**Why:** Spec Sections 1, 2, 4, 5. This is the largest task — it lands the public API (`boot(canvas, options?) → destroy`), the `ResizeObserver`, the inline-style snapshot/restore, the re-entry guard, and the orchestrated teardown. After this commit the engine is fully embeddable.

**Files:**
- Modify: `src/game.js` — `runGame` returns a controller; expose `computeScale`; remove the window resize listener; add `destroyed` flag wiring; capture `escUnsub`
- Modify: `src/main.js` — full `boot()` rewrite

- [ ] **Step 1: Add `computeScale` to `src/game.js` and remove `pickInitialScale`**

Find the existing `pickInitialScale` (was lines 100-105):

```js
function pickInitialScale(screen) {
  const maxW = Math.floor(window.innerWidth / NATIVE_W)
  const maxH = Math.floor(window.innerHeight / NATIVE_H)
  const scale = Math.max(1, Math.min(maxW, maxH))
  screen.setScale(scale)
}
```

Replace with the pure scale formula. The boolean `useWidthOnly` is determined once at boot time (see Step 6) and threaded in:

```js
export function computeScale(container, useWidthOnly) {
  const w = container.clientWidth
  const widthScale = Math.max(1, Math.floor(w / NATIVE_W))
  if (useWidthOnly) return widthScale

  const h = container.clientHeight
  if (h === 0) return widthScale   // safety net for runtime layout collapse
  const heightScale = Math.max(1, Math.floor(h / NATIVE_H))
  return Math.min(widthScale, heightScale)
}
```

- [ ] **Step 2: Remove the window `resize` listener and the `pickInitialScale(screen)` call from `runGame`**

In `runGame`, delete the line `pickInitialScale(screen)` and the `window.addEventListener('resize', () => pickInitialScale(screen))` line. Initial sizing now happens in `boot()` (Step 6 below).

- [ ] **Step 3: Add the `destroyed` flag and convert the outer loop in `runGame`**

The existing outer loop (was lines 122-135):

```js
  while (true) {
    try {
      await runMainFlow(screen, audio, input)
      return   // user chose N to quit
    } catch (err) {
      if (err instanceof GameAbortedError) {
        screen.setInverted(false)
        continue   // ESC pressed; restart from the pre-title
      }
      throw err
    }
  }
```

Becomes:

```js
  let destroyed = false

  while (!destroyed) {
    try {
      await runMainFlow(ctx)
      return   // user chose N to quit
    } catch (err) {
      if (err instanceof GameAbortedError) {
        if (destroyed) return
        screen.setInverted(false)
        continue   // ESC pressed; restart from the pre-title
      }
      throw err
    }
  }
```

- [ ] **Step 4: Capture the `onEscape` unsubscribe and convert `runGame` to return a controller**

Today `runGame` is `async function` — its callers await its promise. We need it to *also* synchronously hand back the abort/destroy hooks so `boot()` can install the `ResizeObserver` and compose `destroy()`.

Restructure `runGame` so it returns a controller object with `{ promise, screen, audio, input, fireAbort, escUnsub, setDestroyed }`. The async work is wrapped in an IIFE so the function itself can return synchronously. Final shape:

```js
export function runGame(canvas, registerAudio = () => {}) {
  const screen = createScreen(canvas)
  const audio = createAudio()
  registerAudio(audio)
  const input = createInput(canvas)

  const abortRejecters = new Set()

  const fireAbort = () => {
    const list = [...abortRejecters]
    abortRejecters.clear()
    for (const r of list) {
      try { r() } catch (err) { console.warn('fireAbort: rejecter threw:', err) }
    }
  }

  const tracked = (promise) => new Promise((resolve, reject) => {
    let settled = false
    const rejecter = () => {
      if (settled) return
      settled = true
      reject(new GameAbortedError())
    }
    abortRejecters.add(rejecter)
    Promise.resolve(promise).then(
      v => {
        if (settled) return
        settled = true
        abortRejecters.delete(rejecter)
        resolve(v)
      },
      e => {
        if (settled) return
        settled = true
        abortRejecters.delete(rejecter)
        reject(e)
      },
    )
  })

  const sleep = (ms) => tracked(new Promise(r => setTimeout(r, ms)))

  const ctx = { screen, audio, input, tracked, sleep }

  let destroyed = false
  const setDestroyed = () => { destroyed = true }

  // ESC during play aborts whatever's awaiting and returns to the pre-title.
  const escUnsub = input.onEscape(() => {
    audio.flush()
    fireAbort()
  })

  const promise = (async () => {
    while (!destroyed) {
      try {
        await runMainFlow(ctx)
        return
      } catch (err) {
        if (err instanceof GameAbortedError) {
          if (destroyed) return
          screen.setInverted(false)
          continue
        }
        throw err
      }
    }
  })()

  return { promise, screen, audio, input, fireAbort, escUnsub, setDestroyed }
}
```

Note the function is no longer `async` — it returns a controller synchronously, and the long-running work is held in `controller.promise`.

- [ ] **Step 5: Verify `src/game.js` still compiles in the browser**

Open `http://localhost:8000/tests.html` — the harness loads `game.js` indirectly via test modules; if there's a SyntaxError it will surface here. All rows PASS.

(Don't try to run the full game yet — `main.js` still uses the old `runGame(...).catch(...)` shape, and the controller change broke that. Step 6 fixes it.)

- [ ] **Step 6: Rewrite `boot()` in `src/main.js`**

Replace the entire contents of `src/main.js` with:

```js
import { runGame, computeScale } from './game.js'

const activeCanvases = new WeakSet()

export function boot(canvas, options = {}) {
  if (activeCanvases.has(canvas)) {
    throw new Error('snaker: boot() called on a canvas that already has an active instance — call destroy() first')
  }

  const container = options.container ?? canvas.parentElement
  if (!(container instanceof Element)) {
    throw new Error('snaker: boot(canvas) requires canvas to be in the DOM, or pass options.container')
  }

  activeCanvases.add(canvas)

  // Snapshot the inline style values we're about to overwrite so destroy()
  // can restore the host's pre-boot state exactly. An empty snapshot is fine
  // — assigning '' removes the property, matching the unset case.
  const priorStyles = {
    imageRendering: canvas.style.imageRendering,
    display:        canvas.style.display,
    touchAction:    canvas.style.touchAction,
  }

  // Width-only-mode detection: hide the canvas, see if the container's height
  // collapses to 0. If so, the container has no height of its own (no explicit
  // height, no aspect-ratio) and we must use width-only scaling forever.
  // Synchronous — the next assignment overwrites display anyway, so no flicker.
  canvas.style.display = 'none'
  const useWidthOnly = container.clientHeight === 0

  canvas.style.imageRendering = 'pixelated'
  canvas.style.display = 'block'   // also undoes the 'none' set during detection
  canvas.style.touchAction = 'none'

  const priorTabindex = canvas.hasAttribute('tabindex')
  if (!priorTabindex) canvas.tabIndex = 0

  const onMouseDown = () => canvas.focus({ preventScroll: true })
  canvas.addEventListener('mousedown', onMouseDown)

  const game = runGame(canvas)

  // Initial scale before the observer fires, so the canvas isn't briefly
  // visible at native 256x192.
  game.screen.setScale(computeScale(container, useWidthOnly))

  const ro = new ResizeObserver(() => {
    game.screen.setScale(computeScale(container, useWidthOnly))
  })
  ro.observe(container)

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

  game.promise.catch(err => {
    console.error('snaker crashed:', err)
    renderCrashOverlay(canvas, err)
  })

  let destroyed = false
  function destroy() {
    if (destroyed) return
    destroyed = true

    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    canvas.removeEventListener('mousedown', onMouseDown)
    game.escUnsub()
    game.input.destroy()
    game.audio.flush()
    // Wrap because audio.suspend() returns undefined if no AudioContext was
    // created (e.g. destroy() called before the user ever pressed a key).
    Promise.resolve(game.audio.suspend()).catch(err => console.warn('audio: suspend on destroy failed:', err))
    game.setDestroyed()
    game.fireAbort()

    canvas.style.imageRendering = priorStyles.imageRendering
    canvas.style.display        = priorStyles.display
    canvas.style.touchAction    = priorStyles.touchAction
    if (!priorTabindex) canvas.removeAttribute('tabindex')

    activeCanvases.delete(canvas)
  }

  return destroy
}

// Without this, an unhandled error inside runGame just freezes the canvas with
// no signal to the user that anything is wrong — devtools is the only feedback.
function renderCrashOverlay(canvas, err) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f00'
  ctx.textBaseline = 'top'
  ctx.font = '16px monospace'
  ctx.fillText('GAME CRASHED — RELOAD TO RESTART', 8, 8)
  ctx.fillStyle = '#888'
  ctx.font = '12px monospace'
  const detail = (err && (err.message || String(err))) || 'unknown error'
  ctx.fillText(detail.slice(0, 80), 8, 32)
}
```

Note the old `boot(canvas)` signature is preserved — `options` is optional and defaults to `{}`.

- [ ] **Step 7: Verify existing tests pass**

Open `http://localhost:8000/tests.html`. All rows PASS.

- [ ] **Step 8: Verify standalone game still works**

Open `http://localhost:8000/`. Click canvas → press key → confirm full pre-title → title → descent loop runs.

- [ ] **Step 9: Verify embedding works (one ad-hoc smoke test)**

Create a temporary file at the repo root called `embed-test.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Embed test</title></head>
<body style="margin: 40px; background: #ccc;">
  <h1>Page above the game</h1>
  <p>Page text. Should remain scrollable. Arrow keys when focused here should NOT be captured by the game.</p>
  <div style="width: 768px; aspect-ratio: 4/3; outline: 2px solid red;">
    <canvas id="snaker"></canvas>
  </div>
  <p>Page below the game.</p>
  <script type="module">
    import { boot } from './src/main.js'
    window.__snakerDestroy = boot(document.getElementById('snaker'))
  </script>
</body>
</html>
```

Open `http://localhost:8000/embed-test.html`. Confirm:

- Canvas fits inside the red outline at 3× scale (768/256).
- Click on the page text outside the canvas, then press arrow keys — page does not capture them as game input.
- Click on the canvas, then press arrow keys — game responds.
- In DevTools console: `window.__snakerDestroy()` — game stops, canvas freezes on last frame, no errors. `window.__snakerDestroy()` again is a no-op (no error).

**Delete `embed-test.html` before committing** — it's a smoke-test artifact, not a real file in the repo:

```bash
rm embed-test.html
```

- [ ] **Step 10: Commit**

```bash
git add src/game.js src/main.js
git commit -m "Embeddable boot(): options.container, ResizeObserver, destroy()"
```

---

## Task 5: Slim `index.html`

**Why:** Spec Section 4. With the engine applying its own essential CSS inline via `boot()`, `index.html` no longer needs the engine-essential styles or the canvas dimension attributes. It keeps host-page styling (full-viewport, dark backdrop, flex centering) and nothing more.

**Files:**
- Modify: `index.html` (overwrite)

- [ ] **Step 1: Replace `index.html` contents**

Replace the entire file with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Snaker</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; }
    body { display: flex; align-items: center; justify-content: center; }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script type="module">
    import { boot } from './src/main.js'
    boot(document.getElementById('game'))
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify standalone game still works**

Open `http://localhost:8000/`. Confirm:

- Game fills the viewport at the largest integer scale that fits.
- Canvas is centered.
- Play through pre-title → title → first descent.
- Resize the browser window — canvas re-scales (this exercises the new `ResizeObserver` on the wrapping body via viewport-unit propagation).

- [ ] **Step 3: Verify existing tests pass**

Open `http://localhost:8000/tests.html`. All rows PASS.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Slim index.html: drop engine-essential CSS now applied by boot()"
```

---

## Task 6: Add the "Embedding" section to `README.md`

**Why:** Spec Section 6. Downstream consumers (the Astro site, future hosts) need a single place to read the API contract, container rules, SPA cleanup pattern, and the cross-origin iframe note.

**Files:**
- Modify: `README.md` (append a new top-level section)

- [ ] **Step 1: Read the current README to find the insertion point**

```bash
cat README.md
```

The new "Embedding" section should be a peer of existing top-level sections, placed before any "License" or "Acknowledgements" tail content if present. If the README has no obvious tail, append at the end.

- [ ] **Step 2: Append the Embedding section**

Insert the content below at the chosen location. The outer fence in this plan uses **four** backticks so the inner triple-backtick code blocks render correctly; copy only the content between the four-backtick fences when editing the README:

````markdown
## Embedding

Snaker is built as a self-contained engine — drop it into any host page.

### Quick start

```html
<div style="width: 768px; aspect-ratio: 4/3;">
  <canvas id="snaker"></canvas>
</div>
<script type="module">
  import { boot } from './snaker/main.js'
  boot(document.getElementById('snaker'))
</script>
```

### API

`boot(canvas, options?) → destroy`

- `canvas` — required `HTMLCanvasElement`. Must be in the DOM, or supply `options.container`.
- `options.container` — `Element` to size against. Defaults to `canvas.parentElement`.
- Returns a `destroy()` function. Idempotent. Tears down listeners, the `ResizeObserver`, audio, and restores the canvas's pre-`boot()` style state.
- Throws on re-entry: calling `boot()` on the same canvas without `destroy()` first throws with a clear message.

### Container sizing

- The engine renders at integer scale only.
- Width is required; height optional. With both, scale = `min(max(1, floor(W/256)), max(1, floor(H/192)))`. With width only (or a parent whose height is contributed by the canvas itself), scale = `max(1, floor(W/256))`. The `max(1, …)` clamp guarantees the canvas always renders at least at native resolution.
- Resize the container freely — a `ResizeObserver` re-scales the canvas. Browser viewport resize propagates if the container's size depends on viewport units.

### SPA cleanup

For routers that re-render the page, call `destroy()` on view unmount:

```js
const destroy = boot(canvas)
document.addEventListener('astro:before-swap', destroy, { once: true })
```

Equivalent patterns work for any framework that fires a "view will unmount" event.

### Cross-origin iframe hosts

Cross-origin iframe hosts must set `allow="autoplay"` on the `<iframe>` for the title music to play. Same-origin embeds (script/module imports from the same origin) are unaffected.

### Browser support

Requires `ResizeObserver` and Web Audio — modern evergreen browsers.
````

- [ ] **Step 3: Render-check**

Open `README.md` in a markdown previewer (or push to a temporary branch and view on GitHub). Confirm the section renders cleanly with code blocks intact.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add Embedding section to README"
```

---

## Task 7: Run the full manual verification matrix

**Why:** Spec Section 6. The 17 scenarios are the project's only verification surface for this refactor. They must all pass before the branch is mergeable.

**Files:** None modified. This task is execution + reporting.

**Setup:** Server must be running (`python3 -m http.server 8000`).

- [ ] **Step 1: Re-create the embed test page**

Create `embed-test.html` at the repo root again (same content as Task 4, Step 9). It will be deleted at the end of this task.

For Scenarios 4, 9, 10, 16, and 17, you'll need additional test fixtures. Add the following to `embed-test.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Snaker embed test</title></head>
<body style="margin: 40px; background: #ccc; font-family: sans-serif;">

  <h2>Scenario 3: width 768px, aspect-ratio 4/3</h2>
  <div id="wrap-3" style="width: 768px; aspect-ratio: 4/3; outline: 2px solid red;">
    <canvas id="canvas-3"></canvas>
  </div>

  <h2>Scenario 4: width 600px, no height</h2>
  <div id="wrap-4" style="width: 600px; outline: 2px solid blue;">
    <canvas id="canvas-4"></canvas>
  </div>

  <h2>Scenario 16: two canvases</h2>
  <div style="display: flex; gap: 20px;">
    <div style="width: 384px; aspect-ratio: 4/3; outline: 2px solid green;">
      <canvas id="canvas-16a"></canvas>
    </div>
    <div style="width: 384px; aspect-ratio: 4/3; outline: 2px solid orange;">
      <canvas id="canvas-16b"></canvas>
    </div>
  </div>

  <h2>Scenario 17: explicit options.container</h2>
  <section id="sized-section" style="width: 512px; aspect-ratio: 4/3; outline: 2px solid purple;">
    <figure style="margin: 0; padding: 0;">
      <canvas id="canvas-17"></canvas>
    </figure>
  </section>

  <h2>Scenario 18: explicit width 1024px, height 192px (no overflow)</h2>
  <div id="wrap-18" style="width: 1024px; height: 192px; outline: 2px solid magenta;">
    <canvas id="canvas-18"></canvas>
  </div>

  <script type="module">
    import { boot } from './src/main.js'
    window.__destroys = {
      s3:  boot(document.getElementById('canvas-3')),
      s4:  boot(document.getElementById('canvas-4')),
      s16a: boot(document.getElementById('canvas-16a')),
      s16b: boot(document.getElementById('canvas-16b')),
      s17: boot(document.getElementById('canvas-17'), {
        container: document.getElementById('sized-section'),
      }),
      s18: boot(document.getElementById('canvas-18')),
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Run scenarios 1-17 from the spec**

Open `http://localhost:8000/embed-test.html` (and `http://localhost:8000/` for the standalone scenarios). For each row in the table below, confirm the expected outcome and tick the checkbox. Use DevTools console for any explicit JS calls.

| # | Scenario | Where | How to verify |
| --- | --- | --- | --- |
| 1 | Standalone runs | `index.html` | Pre-title → title → first descent without console errors |
| 2 | Existing tests pass | `tests.html` | All rows PASS |
| 3 | 768×aspect-4/3 div | `embed-test.html` #wrap-3 | Canvas at 3× scale, fills wrapper |
| 4 | 600px wide, no height | `embed-test.html` #wrap-4 | Canvas at 2× scale via width-only fallback; wrapper grows to 384px tall |
| 5 | Resize wrapper | DevTools: change `#wrap-3` width to 1024px | Canvas re-scales to 4× within ~1 frame |
| 6 | Out-of-canvas keys | `embed-test.html` body | Click background, press arrows — page handles, not game |
| 7 | In-canvas keys | `embed-test.html` #canvas-3 | Click canvas, press arrows — game responds, page does not scroll |
| 8 | Tab away | After scenario 7, press Tab | Game ignores subsequent keys |
| 9 | Touch joystick | mobile device or DevTools touch emulation | Drag inside canvas — joystick responds; page below canvas can still scroll |
| 10 | Page-touch outside canvas | mobile/touch emulation | Drag outside canvas — page scrolls normally |
| 11 | Esc during play | any embed | Esc aborts to pre-title |
| 12 | Tab visibility | switch tabs during play | Audio pauses, resumes on return |
| 13 | destroy() then re-boot | console: `__destroys.s3()` then `boot(document.getElementById('canvas-3'))` | New game starts cleanly; no console errors |
| 14 | Double boot | console: `boot(document.getElementById('canvas-3'))` again without destroy | Throws "already has an active instance" |
| 15 | Double destroy | console: `__destroys.s4()` then `__destroys.s4()` | Second call no-op, no error |
| 16 | Two-canvas isolation | `embed-test.html` #canvas-16a + #canvas-16b | Run both. Console: `__destroys.s16a()` — surviving canvas keeps playing; destroyed one stops |
| 17 | options.container override | `embed-test.html` #canvas-17 | Sizing tracks `<section>` not `<figure>`. Resize section in DevTools — canvas re-scales |
| 18 | Explicit width 1024px, height 192px — no vertical overflow | `embed-test.html` #wrap-18 | Canvas at scale=1 (height-constrained). Canvas does NOT exceed 192px tall and stays within the magenta outline. Validates the boot-time width-only-mode detection rejects this case correctly. |

- [ ] **Step 3: Document any failures**

If any scenario fails, do **not** commit. Fix the underlying issue (likely in `src/main.js` or `src/game.js`), re-run the full matrix, and only then proceed.

- [ ] **Step 4: Delete the embed test page**

```bash
rm embed-test.html
```

- [ ] **Step 5: Final verification — clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. If `embed-test.html` still appears, delete it again.

- [ ] **Step 6: No commit (this task is verification only)**

This task produces no code changes. The completion signal is "all 17 scenarios passed and `embed-test.html` is deleted." Report scenario results in the PR description when opening the merge.

---

## Done

After Task 7, the branch contains 6 implementation commits:

1. `Early-return in setScale when scale unchanged`
2. `Scope keyboard input to canvas with tabindex + click-to-focus`
3. `Move abort plumbing into per-runGame closures`
4. `Embeddable boot(): options.container, ResizeObserver, destroy()`
5. `Slim index.html: drop engine-essential CSS now applied by boot()`
6. `Add Embedding section to README`

Plus the 8 design-doc commits already on the branch.

The engine is embeddable. The standalone game still works. No new files, no new dependencies, no build step. Ready to open a PR.
