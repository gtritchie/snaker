# Embeddable snaker engine — design

**Status:** in progress (sections being added incrementally; not yet user-approved as a whole)
**Date:** 2026-05-03

## Background

`index.html` boots the engine with `boot(document.getElementById('game'))`. The engine assumes it owns the page: it sizes against `window.innerWidth/innerHeight`, attaches keyboard listeners to `window`, and the host HTML applies global CSS (`html, body { overflow: hidden; touch-action: none; height: 100% }`) that would clip a host page's chrome and break parent-page touch-scrolling.

The motivating use case is hosting at `https://boringbydesign.ca/snaker` (an Astro site, `gtritchie/boring-astro`), but the goal is a clean drop-in for any host page:

```html
<div style="width: 768px; aspect-ratio: 4/3;">
  <canvas id="snaker"></canvas>
</div>
<script type="module">
  import { boot } from './snaker/main.js'
  boot(document.getElementById('snaker'))
</script>
```

This is a pure refactor — gameplay, controls, scoring, save format, and internal architecture (`game.js`, `screen.js`, `audio.js`, `input.js`, `storage.js`, `glyphs.js`) are unchanged.

## Constraints

- No build step. ES modules, no transpilation, no bundler.
- No new runtime dependencies.
- Plain JS, not TypeScript — match existing style.
- Snapshot-friendly file layout: the downstream consumer plans to copy `src/` verbatim into `public/snaker-engine/src/`.

## Non-goals

- Event hooks (`scoreChange`, `gameOver`, etc.) — YAGNI; downstream embed doesn't need them.
- `devicePixelRatio` scaling — the pixel-art aesthetic is fine without it.
- Cross-origin iframe embed support beyond a docs note (`allow="autoplay"`).
- Refactoring code that doesn't directly serve embeddability.

## Open decisions (resolved)

| Decision | Choice |
| --- | --- |
| Cleanup API shape | `boot()` returns a `destroy()` function |
| Container source | `canvas.parentElement` by default; `options.container` overrides |
| Parent-height fallback | Width-only scaling when parent height is 0 or matches the canvas's own height |
| Refactor scope | Surgical patch + brief README "Embedding" section. No new modules. |

---

## Section 1 — Public API

```js
// src/main.js
export function boot(canvas, options = {}) { … }
```

**Signature**

- `canvas` — required `HTMLCanvasElement` (unchanged).
- `options.container` — optional `Element` used as the sizing reference. Defaults to `canvas.parentElement`. Throws synchronously if neither is an `Element` (e.g. canvas not in the DOM yet and no container passed).

**Return value**

- Returns a `destroy` function. Calling it tears down everything `boot()` set up: DOM listeners, the `ResizeObserver`, audio (suspend/close), in-flight `tracked()` promises (via `fireAbort()`), and inline styles applied to the canvas.
- `destroy` is idempotent — a second call is a no-op.

**Re-entrancy**

Calling `boot()` twice on the same canvas without first calling `destroy` throws synchronously:

```
Error: snaker: boot() called on a canvas that already has an active instance — call destroy() first
```

Rationale: implicit teardown could mask host bugs (forgotten lifecycle hooks in an SPA router). Explicit beats clever.

Implementation detail: a `WeakMap<HTMLCanvasElement, true>` on the module records active canvases; `destroy()` removes the entry.

**Options object scope**

`options.container` is the only option today. No event hooks, no DPR knob, no audio-pause toggle. The `boot(canvas, options)` shape reserves room for additions without breaking the contract.

**Host usage**

```js
const destroy = boot(document.getElementById('snaker'))
// ...later, e.g. on Astro's astro:before-swap:
destroy()
```

---

## Section 2 — Sizing

Replace `pickInitialScale`'s viewport-based math with container-based math, and replace the `window.resize` listener with a `ResizeObserver` on the container.

**Container resolution**

```js
const container = options.container ?? canvas.parentElement
if (!(container instanceof Element)) {
  throw new Error('snaker: boot(canvas) requires canvas to be in the DOM, or pass options.container')
}
```

**Scale computation**

```js
function computeScale(container, canvas) {
  const w = container.clientWidth
  const h = container.clientHeight
  const widthScale = Math.max(1, Math.floor(w / NATIVE_W))

  // Width-only fallback: parent has no useful height (h===0) or its height
  // is being contributed by the canvas itself (h===canvas.clientHeight),
  // which would otherwise lock us at scale=1 forever.
  if (h === 0 || h === canvas.clientHeight) return widthScale

  const heightScale = Math.max(1, Math.floor(h / NATIVE_H))
  return Math.min(widthScale, heightScale)
}
```

The `h === canvas.clientHeight` check is what breaks the chicken-and-egg with parents that have no explicit height: without it, the parent's intrinsic height tracks the canvas's height, so `min(widthScale, heightScale)` never exceeds 1.

**ResizeObserver lifecycle**

`boot()` creates one `ResizeObserver` watching the container. The callback recomputes scale and calls `screen.setScale(newScale)`. `destroy()` disconnects it.

```js
const ro = new ResizeObserver(() => {
  screen.setScale(computeScale(container, canvas))
})
ro.observe(container)
```

The window `resize` listener in `runGame()` (`src/game.js:114`) is removed entirely — `ResizeObserver` fires on viewport resize too when the container's size depends on viewport units.

**Initial scale**

Call `screen.setScale(computeScale(...))` once synchronously inside `boot()` before observing, so the canvas isn't briefly displayed at 256×192 native before the first observer callback fires.

**Required change in `screen.js`**

`setScale(s)` (`src/screen.js:22-28`) currently always reassigns `canvas.width/height` and calls `redrawAll()`, even when `s` matches the current scale. In width-only fallback mode the observer fires on every canvas resize (because the canvas resize changes the parent's intrinsic height, which re-fires the observer). Add an early return when the new scale equals the current scale — this is what keeps the fallback from triggering unnecessary redraws and ResizeObserver-loop browser warnings.

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

**What stays unchanged**

- Integer scale only (no fractional zoom).
- Minimum scale 1 (canvas always renders at native or larger).
- `screen.setScale` remains the only sizing entry point.
- `NATIVE_W = 256`, `NATIVE_H = 192` constants in `game.js`.

## Section 3 — Keyboard, focus, and touch scope

The current engine attaches `keydown`/`keyup` to `window` (`src/input.js:163-164`) and `preventDefault`s arrow keys, WASD, and Esc on every event. Embedded, this swallows page-level keystrokes (browser shortcuts, theme toggles, Esc-to-close-modal) even when the player isn't focused on the game.

**Make the canvas focusable**

In `boot()`, set `canvas.tabIndex = 0` if it isn't already set by the host. This makes the canvas a focusable element and a keyboard-focus stop, without overriding a host that wants a different tab order.

```js
if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0
```

**Move keyboard listeners from `window` to `canvas`**

In `createInput(canvas)` (`src/input.js`):

```js
canvas.addEventListener('keydown', onKeyDown)
canvas.addEventListener('keyup', onKeyUp)
```

(The matching `removeEventListener` calls in `destroy()` change too.)

Because keyboard events only reach the canvas when it has focus, `preventDefault()` calls inside `onKeyDown` (and the Esc handler) only fire during gameplay focus. Page-level shortcuts and browser scroll keep working when the player isn't playing.

**Click-to-focus**

Canvases don't take focus on mouse click by default, even with `tabindex`. Without click-to-focus, a desktop player would have to Tab into the canvas before keys register — non-obvious. Add a single listener in `boot()`:

```js
canvas.addEventListener('mousedown', () => canvas.focus({ preventScroll: true }))
```

`preventScroll: true` keeps the page from scrolling the canvas into view if it happens to be off-screen.

(Touchstart already resolves any pending `waitForKey` and triggers a focus side-effect via the canvas being the touch target on iOS Safari; no change needed for touch.)

**Touch-action scope**

Move `touch-action: none` from `body` (in `index.html`) to the canvas itself, applied as an inline style by `boot()` (see Section 4 for the full inline-style set). Hosts can still scroll/pan-zoom the page outside the canvas.

**What about the "PRESS ANY KEY TO RUN THE PROGRAM" prompt?**

Slight UX shift: a desktop player landing on a host page must click the canvas once before the prompt accepts keys. Acceptable trade-off — the alternative (auto-focusing on mount) would steal focus from the host page, which is worse for an embed. The pre-title text could optionally be amended to "CLICK THEN PRESS ANY KEY" but is not in scope for this refactor.

**Tab key**

Not intercepted. Letting Tab move focus away from the canvas is the right accessible behavior for an embed.

**`destroy()` removes**

- `keydown`/`keyup` from canvas
- `mousedown` (focus helper) from canvas
- `touchstart`/`touchmove`/`touchend`/`touchcancel` from canvas (already in `createInput.destroy`)

**What stays unchanged**

- Touch joystick logic and listener targets (`canvas`).
- Key bindings (arrows, WASD, Esc).
- `lineInput` and `waitForKey` semantics.
- The Esc-fires-fireAbort chain.

## Section 4 — CSS the engine applies + index.html slimming

The current `index.html` puts engine-essential CSS (`touch-action: none`, `image-rendering: pixelated`, `display: block`) and host-page styling (`overflow: hidden`, full-viewport sizing, dark background, flex centering) in the same global stylesheet. A host page that copies the wrong half — or none of it — will see broken behavior.

**Engine-applied inline styles**

`boot()` snapshots the canvas's existing inline values for the three properties it manages, then sets its own values, before the first `setScale()` call:

```js
const priorStyles = {
  imageRendering: canvas.style.imageRendering,
  display:        canvas.style.display,
  touchAction:    canvas.style.touchAction,
}
canvas.style.imageRendering = 'pixelated'
canvas.style.display = 'block'
canvas.style.touchAction = 'none'
```

Inline styles win against host stylesheets without `!important`, so behavior is predictable. Hosts that genuinely want to override (e.g. a stylized `display: inline-block` debug variant) can still do so with `!important`.

We deliberately **do not** set:
- `outline: none` — browser focus rings are accessibility-relevant; let them render. Hosts can suppress per their own design.
- `cursor` — host's call.
- `background` — canvas surface is fully opaque during render (`cls(0)` fills VRAM with code 96 = solid green). No backdrop expectation.
- `width` / `height` CSS — `setScale()` sets the canvas's intrinsic `width`/`height` attributes, which determine the rendered CSS box without an explicit CSS rule.

`destroy()` restores the snapshot rather than clearing the properties:

```js
canvas.style.imageRendering = priorStyles.imageRendering
canvas.style.display        = priorStyles.display
canvas.style.touchAction    = priorStyles.touchAction
```

If the host had no prior inline value, the snapshot is `''` and the assignment removes the property (matching pre-`boot()` state). If the host had set one explicitly (e.g. `canvas.style.display = 'inline-block'` for some debug overlay), `destroy()` restores it. The canvas returns to its true pre-`boot()` style state in both cases.

**Slimmed `index.html`**

The standalone host page becomes:

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

What was dropped from the original `index.html` and why:

| Removed | Why |
| --- | --- |
| `body { overflow: hidden; touch-action: none }` | Engine no longer needs page-level scroll suppression; `touch-action` is now per-canvas. |
| `body { color: #07ff00; font-family: monospace }` | Only affected non-canvas text; standalone has none. |
| `<canvas>` `width="256" height="192"` attributes | `setScale()` overwrites them on first call. |
| `<canvas>` `image-rendering`/`display: block` rules | Now applied inline by `boot()`. |

What stays in `index.html`:

- `html, body { margin: 0; height: 100%; background: #000 }` — host-page styling for the standalone view (full-viewport, dark backdrop).
- `body { display: flex; ... }` — centers the canvas in the viewport, since the canvas size after scaling is smaller than the viewport in most cases. This is host-page concern, not engine concern.

**The success-criteria snippet now works verbatim**

```html
<div style="width: 768px; aspect-ratio: 4/3;">
  <canvas id="snaker"></canvas>
</div>
<script type="module">
  import { boot } from './snaker/main.js'
  boot(document.getElementById('snaker'))
</script>
```

The host div sizes the canvas; `boot()` applies the three inline styles; the engine fills the canvas surface; page scroll and out-of-canvas keystrokes are unaffected.

## Section 5 — Cleanup (full `destroy()` inventory)

`destroy()` must unwind everything `boot()` (and its callees) established. The contract per Section 1: idempotent, synchronous, returns nothing.

**State `boot()` establishes**

| Established by | Owned by | Cleaned up by `destroy()` how |
| --- | --- | --- |
| `document.addEventListener('visibilitychange', …)` (`src/main.js:16`) | `boot` closure | `removeEventListener` |
| Canvas `mousedown` focus helper (Section 3) | `boot` closure | `removeEventListener` |
| Canvas `keydown`/`keyup`/`touch*` listeners (`src/input.js`) | `createInput` closure | call existing `input.destroy()` |
| `ResizeObserver` on container (Section 2) | `boot` closure | `ro.disconnect()` |
| `input.onEscape(...)` registration (`src/game.js:117`) | `createInput` Set | call the unsubscribe returned by `onEscape` |
| Pending `tracked()` rejecters in `game.js`'s module-level `Set` | `tracked` | `fireAbort()` rejects them all |
| `runGame()`'s `while (true)` loop | `runGame` | needs a destroy flag — see below |
| Audio scheduling state + `AudioContext` running state | `createAudio` | `audio.flush(); audio.suspend()` |
| Inline styles on canvas (3 properties, Section 4) | `boot` closure | restore from snapshot |
| `canvas.tabIndex = 0` (Section 3, only if we set it) | `boot` closure | restore prior `hasAttribute('tabindex')` state |
| Active-canvas entry in module-level `WeakMap` (Section 1) | `boot` module | `weakMap.delete(canvas)` |

**Stopping the `while (true)` loop**

`runGame()`'s outer loop currently catches `GameAbortedError` and `continue`s — fine for Esc-restart, wrong for destroy. Add a `destroyed` flag in the closure that the catch block consults:

```js
let destroyed = false

while (!destroyed) {
  try {
    await runMainFlow(screen, audio, input)
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
```

`destroy()` sets `destroyed = true`, then calls `fireAbort()`. The currently-awaited `tracked()` promise rejects with `GameAbortedError`, the catch block sees `destroyed`, and the loop returns. The runGame promise then settles (resolves), and any `.catch` chained in `boot()` is a no-op since destroy is the legitimate exit.

**Order of operations in `destroy()`**

1. If already destroyed, return (idempotency).
2. Mark `destroyed = true`.
3. Disconnect `ResizeObserver` (no more scale recomputes).
4. Remove `document` `visibilitychange` listener.
5. Remove canvas `mousedown` focus helper.
6. Call `input.destroy()` (removes canvas key/touch listeners).
7. `audio.flush()` then `audio.suspend()` (cancel scheduled oscillators, then suspend context).
8. `fireAbort()` (rejects in-flight `tracked()` promises; runGame loop returns).
9. Restore inline styles from snapshot.
10. Restore `tabindex` attribute state.
11. `activeCanvases.delete(canvas)`.

Listener removal precedes the abort so no new events can land mid-teardown. Audio teardown precedes abort so no fresh `audio.play()` can fire from a still-running iteration.

**What `destroy()` does NOT do**

- Does not clear the canvas pixel buffer. The host page may want to display a "game ended" backdrop, render a thumbnail, or just leave the last frame visible. Hosts who want a blank canvas can do `canvas.getContext('2d').clearRect(...)` themselves.
- Does not remove the `<canvas>` from the DOM. The host owns the element.
- Does not close the `AudioContext`. `suspend()` is reversible if the host re-boots; `close()` is permanent and would prevent a fresh `boot()` on the same page from getting audio (browsers limit one `AudioContext` per page in some cases).

**`createInput.destroy()` change**

Currently (`src/input.js:200-209`) it removes window-scoped listeners. Per Section 3 those move to canvas, so this updates accordingly. No new public surface.

## Section 6 — *(pending)*
