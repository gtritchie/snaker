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

## Section 2 — *(pending)*

## Section 3 — *(pending)*

## Section 4 — *(pending)*

## Section 5 — *(pending)*

## Section 6 — *(pending)*
