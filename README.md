# Snaker

In early 1983 I wrote this game for the TRS-80 Color Computer, and submitted it to [The Rainbow](<https://en.wikipedia.org/wiki/The_Rainbow_(magazine)>) magazine.

Submission was via mailing a cassette tape with the source code. It was accepted and [appeared in the January 1984 issue](https://archive.org/details/rainbowmagazine-1984-01/page/n171/mode/2up). I believe I was paid something on the order of $25. American!

The original source is in [snaker.bas](https://github.com/gtritchie/snaker/blob/main/src/snaker.bas).

[GAMEPLAY.md](https://github.com/gtritchie/snaker/blob/main/GAMEPLAY.md) explains how to play the (ported) game.

## Background

The game relies on the screen scrolling mechanism to move everything up one line. So I draw the "cars" at the bottom and they move along the highway via the entire screen scrolling up. The snake starts at the top and gradually moves down (or back up if it collides with a car). This gives the snake-like appearance as the player moves left and right.

Taking advantage of this allowed more to happen on-screen than would be possible with plain BASIC code. To give an idea of just how slow this interpreted language was on this hardware, pausing for one second was achieved via a no-op `for` loop of 460 iterations. Keeping source code as small as possible (e.g. single-character variable names, avoiding all unnecessary whitespace) was a significant factor in application performance on the CoCo.

I stumbled across this idea while playing with a [Timex Sinclair 1000](https://en.wikipedia.org/wiki/Timex_Sinclair_1000). I was probably trying to write a Pong-style game with a paddle moving left and right at the bottom of the screen when I unintentionally triggered scrolling and saw the snake-like pattern.

## JavaScript Port

As I was building [my website](https://boringbydesign.ca) to list my past and current projects, I knew I'd have to include Snaker. I started by using Preview on the iPhone to capture the pages with the source listing from a physical copy of the magazine, then had Claude Cowork pull out the source from the pages and save it. From there I used Claude Code to create a JavaScript port.

## Other Games

I wrote a few more games on the CoCo after this, mostly in assembly language, but none of them were accepted for publication. I no longer have the source code for these.

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
- Width is required; height optional. With both, scale = `min(max(1, floor(W/256)), max(1, floor(H/192)))`. With width only (no explicit height and no `aspect-ratio`), scale = `max(1, floor(W/256))` and the canvas's content drives the container height. The `max(1, …)` clamp guarantees the canvas always renders at least at native resolution.
- The width-only mode is detected once at `boot()` time by hiding the canvas and reading the container's height in isolation. If the host changes the container's height behavior at runtime (adds/removes `aspect-ratio`, changes flex layout, etc.), call `destroy()` and `boot()` again to re-detect.
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
