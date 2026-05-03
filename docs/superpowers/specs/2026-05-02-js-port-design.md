# Snaker — JavaScript Browser Port

## Goal

Port the 1983 TRS-80 Color Computer game *Snaker* (originally written in Extended Color BASIC) to a modern browser. Pixel-perfect fidelity to the original visuals, audio, and gameplay. Run as static files with no build step. Eventually embeddable in an Astro-based personal website.

Source material:
- `src/snaker.bas` — original BASIC source
- `src/snaker-readable.bas` — same code with descriptive variable names and commentary

## Non-goals

- New gameplay features
- Online leaderboards or multiplayer
- A general-purpose CoCo BASIC interpreter
- Mobile-first redesign — the port adapts to phones, but the original layout is preserved

## Browser support

Modern Chrome, Safari (macOS and iOS), Firefox. No IE/Edge-legacy. Uses Canvas 2D, Web Audio, and `localStorage`. ES module syntax. No transpilation.

## Design choices

| Question | Decision |
|---|---|
| Fidelity | Pixel-perfect 1983 aesthetic |
| Input | Keyboard + virtual on-screen joystick for touch |
| Display scaling | Responsive integer scaling (largest integer scale that fits viewport) |
| Audio | Web Audio API with a PLAY-string interpreter that consumes the original BASIC PLAY strings verbatim |
| Project structure | Zero-build vanilla JS (ES modules, served as static files) |
| Best-score persistence | `localStorage` |
| Astro consumption | Designed for iframe embed via `public/snaker/`; entry point also callable as a function for direct embedding later |

## File layout

```
/Users/gary/code/snaker/
├── index.html              ← single page, loads main.js as a module
├── src/
│   ├── snaker.bas          ← unchanged original
│   ├── snaker-readable.bas ← unchanged
│   ├── main.js             ← boot(canvas), resize handler, top-level flow
│   ├── game.js             ← phases: title → setup → loop → crash → win → score → again
│   ├── screen.js           ← 32×16 character framebuffer + canvas renderer
│   ├── glyphs.js           ← procedural semigraphics + embedded CoCo-style 8×12 bitmap font
│   ├── audio.js            ← Web Audio PLAY-string interpreter
│   ├── input.js            ← keyboard + virtual touch joystick
│   └── storage.js          ← localStorage best-score wrapper
├── tests.html              ← opens in browser, runs unit tests, prints pass/fail
└── docs/superpowers/specs/
    └── 2026-05-02-js-port-design.md  ← this file
```

No `package.json`, no `node_modules`, no bundler.

## Module dependencies

One-way, no cycles:

```
main.js   → game.js
game.js   → screen.js, audio.js, input.js, storage.js
screen.js → glyphs.js
audio.js  → (Web Audio, no internal deps)
input.js  → (DOM events, no internal deps)
storage.js → (localStorage, no internal deps)
glyphs.js → (no deps; pure data + draw functions)
```

## Game flow

Phases run sequentially as `async` functions, mirroring the top-to-bottom structure of `snaker-readable.bas`. `await sleep(ms)` replaces the original's `FOR PP=1 TO N:NEXT PP` delay loops; `await waitForKey()` replaces `INKEY$` polling.

```js
async function run(canvas) {
  let bestTicks = storage.loadBestTicks() ?? Infinity   // Infinity so first score always registers
  await titleScreen()
  while (true) {
    await setup()
    const elapsed = await playRounds()    // 3 successful descents; returns ticks elapsed
    await winSequence()
    await showScore(elapsed)
    if (elapsed < bestTicks) {
      bestTicks = elapsed
      await captureNewBestScore(elapsed)
    }
    await showBestScore()
    if (!await playAgainPrompt()) return
  }
}
```

Game state (`leftEdge`, `rightEdge`, `playerPos`, `moveDir`, `runs`, `elapsed`, etc.) lives as locals in `game.js`. The original CoCo variables are preserved in comments next to the JS names for cross-reference with the BASIC source.

## Memory model

`screen.js` keeps a 512-element `Uint8Array` mirroring CoCo video RAM at addresses 1024–1535. Game logic uses `screen.poke(addr, char)` and `screen.peek(addr)` — *literally* the same calls as `POKE` and `PEEK` in the BASIC. The collision check `IF PEEK(P)<>96 THEN ...` becomes `if (screen.peek(playerPos) !== 96) ...`. The JS reads line-by-line against the BASIC source.

## Rendering

**Native resolution: 256×192.** 32 columns × 16 rows × 8×12 pixels per character. Canvas size is the largest integer scale of 256×192 that fits the viewport. `imageSmoothingEnabled = false` keeps pixels crisp.

**Two glyph categories:**

1. **Semigraphics blocks (codes 128–255)** — rendered procedurally. Each character is an 8×12 cell divided into 4 quadrants. The high 3 bits of `(code - 128)` select one of 8 colors; the low 4 bits are a bitmap of which quadrants are lit. Covers snake body (148, 164, 180, 196, 212, 228, 244), wall blocks (175), and obstacle blocks (159, 191, 207, 239, 255).
2. **ASCII text (codes 32–127)** — embedded clean-room CoCo-style 8×12 bitmap font as a compact `Uint8Array`. Only includes characters the game uses (uppercase A–Z, digits, space, colon, hyphen, `?`, `>`, `<`, `%`, `!`). ~50 glyphs, well under 1 KB.

**Color palette** (CoCo Semigraphics-4):

| Index | Color  | RGB        | Used for |
|-------|--------|------------|----------|
| 0     | Green  | `#07FF00`  | snake body color set |
| 1     | Yellow | `#FFFF00`  | obstacle |
| 2     | Blue   | `#3B08FF`  | obstacle |
| 3     | Red    | `#CC003B`  | obstacle |
| 4     | Buff   | `#FFFFFF`  | obstacle |
| 5     | Cyan   | `#07E399`  | — |
| 6     | Magenta| `#FF1FCB`  | — |
| 7     | Orange | `#FF8100`  | walls |

Background black. Text glyphs render in green (CoCo's standard text color). Code 96 ("blank space") renders as a filled black 8×12 rect. Code 33 (`!`) is used for the score-screen decorative bar.

**Per-cell rendering.** `screen.poke(addr, code)` updates the framebuffer Uint8Array and immediately repaints just that one 8×12 cell. No full-frame redraws during gameplay. On window resize, the entire framebuffer is re-blitted at the new scale.

**Screen flash effect.** Original uses `SCREEN 0,1` / `SCREEN 0,0` to invert during crash — replicated by redrawing inverted for ~50 ms.

## Audio (PLAY-string interpreter)

`audio.js` parses BASIC PLAY strings verbatim and schedules them on Web Audio. Grammar covers every token used in `snaker.bas`:

| Token         | Meaning |
|---------------|---------|
| `Tnnn`        | Tempo, 1–255 |
| `Onnn`        | Octave, 1–5 |
| `Vnnn`        | Volume, 1–31 |
| `V>` / `V<`   | Volume up/down by 1 step |
| `Lnnn`        | Default note length (1, 2, 4, 8, 16, 32) |
| `A`–`G`       | Note in current octave; optional `#`/`+` (sharp), `-` (flat); optional length digits; optional `.` (dotted = 1.5×) |
| `Pnnn`        | Pause/rest |
| `Nnnn`        | Note by number (1–12 = chromatic scale within octave) |

**Synthesis:** square-wave oscillator through a gain node, with ~5 ms attack/release envelope to avoid clicks. Closest single-oscillator approximation of the CoCo's 6-bit DAC sound.

**Tempo math:** CoCo `T` value calibrated by ear against a CoCo emulator recording so Bublitchki plays at the right tempo. Constant documented inline.

**API:**

```js
const audio = createAudio()              // creates AudioContext lazily on first user gesture
audio.play("T255 O3 V25 L8 D G A...")    // returns a Promise that resolves when done
audio.stop()                             // for cancelling on page hide / new game
```

`play()` returns a Promise so `game.js` can `await` long sequences (title music, win fanfare, chromatic scales) but fire-and-forget short ones (step beep, crash sound).

**Concurrency:** Web Audio handles overlap natively. Where the game `await`s, behaviour matches the original's blocking PLAY; where it doesn't, sounds layer naturally.

**Autoplay policy:** AudioContext is created on first user gesture (the "press any key to start" prompt provides it).

## Input

**Keyboard mapping:**

| Original (joystick)      | JS keys     | Notes |
|--------------------------|-------------|-------|
| Right-stick X (left)     | `←`, `A`    | Snake moves left while held |
| Right-stick X (right)    | `→`, `D`    | Snake moves right while held |
| Right-stick Y (up)       | `↑`, `W`    | Faster (smaller delay) |
| Right-stick Y (down)     | `↓`, `S`    | Slower (longer delay) |
| `INKEY$` (any key)       | any key     | Title screen advance, "press any key" prompts |
| `Y`/`N` for play again   | `Y`/`N`     | Same letters |

Movement and speed keys are independent — hold `↑` and `→` together to dart sideways at full speed.

**Speed mapping.** Original `JOYSTK(3)` returns 0–63 used as a delay loop bound. Keyboard maps to three discrete speeds:

- No key held → moderate (default delay)
- `↑` / `W` held → fast (small delay)
- `↓` / `S` held → slow (large delay)

Calibrated against gameplay feel.

**Touch controls.** Virtual stick overlaid in the lower-right corner on touch-capable devices (`'ontouchstart' in window`). Touch and drag determines (x, y) offset from the stick center, mapped to the same `getX()` / `getSpeed()` interface the keyboard updates. Drawn in CoCo aesthetic (circles with semigraphics-color outlines).

**`INKEY$` and `LINE INPUT`.** `input.js` exposes:

- `waitForKey()` → Promise that resolves with the next keypress
- `lineInput(prompt)` → renders a CoCo-style on-canvas input field with a blinking cursor block, resolves when Enter is pressed (not a DOM `<input>` — preserves aesthetic)

**Pause on tab hidden.** When `document.visibilityState === 'hidden'`, suspend audio and freeze the game loop. Resume on visible.

## Timing

Original ran on 0.89 MHz CoCo (or 1.78 MHz with `POKE 65495,0`). Replacements:

- `FOR PP=1 TO SP:NEXT PP` → `await sleep(speedToMs(SP))` with calibrated conversion
- `TIMER` (60 Hz tick counter) → tracked via `performance.now()`, converted to ticks for the score formatter that uses `TIMER/60` to get seconds

## Astro embedding

Designed for iframe embed via `public/snaker/`. `main.js` is a side-effect-free module that only *exports* `boot(canvas, options?)`. Standalone-page boot lives in a separate inline script in `index.html` so importing `main.js` from anywhere else is safe.

```js
// main.js — no top-level side effects
export function boot(canvas, options = {}) { /* ... */ }
```

```html
<!-- index.html -->
<canvas id="game"></canvas>
<script type="module">
  import { boot } from './src/main.js'
  boot(document.getElementById('game'))
</script>
```

For Astro path A (iframe), the Astro page just embeds `<iframe src="/snaker/">` and `index.html` boots itself.

For Astro path B (direct embed, future), the Astro page imports `boot` from the module and calls it with its own canvas — no autoboot guard needed because `main.js` has no top-level execution.

(Note: `document.currentScript` is `null` for ES modules, so an autoboot guard based on it would be unreliable. Keeping the autoboot out of `main.js` entirely avoids the problem.)

## Testing

**Unit tests** in `tests.html` (open in browser, see pass/fail on the page). One small `assert` helper, no framework. Covers pure logic worth covering:

- **PLAY parser** — feed each of the 9 distinct PLAY strings from `snaker.bas`. Assert event count and note sequence match expectations. Edge cases: `V>`/`V<` adjustment, dotted notes (`L4...` triple-dotted from line 50), runtime-built `"+STR$(O)+"N"+STR$(N)` strings (we test the parser against the *result* of substitution).
- **Score formatter** — `ticks → "MM:SS"`. Cases: 0 ticks, 59 sec, 60 sec (1:00), 600 sec (10:00), MM truncation edge, the original's `LEFT$/RIGHT$/STR$` quirks.
- **Storage wrapper** — read when nothing stored (returns null), read when corrupted JSON (returns null + clears), round-trip write/read.
- **Semigraphics decoder** — given character code 175, returns the correct quadrant pattern and color. Spot-check codes against the documented CoCo formula.

Rendering and game flow are not unit tested — those are verified by playing the game.

**Manual playtest checklist:**

- Title screen renders with `%` border, "snaker" centered, plays Bublitchki, advances on any key
- Walls draw left-to-right with stepped tones
- Movement: arrows + WASD both work, snake clamps at walls
- Speed: ↑ faster, ↓ slower, default in between
- Crash: backs up one row, screen flashes, scatter blocks placed
- Three successful descents → win fanfare plays
- Score screen: time displays as MM:SS, decorative bar of `!`, ascending chromatic scale
- New best score: prompts for name, stores in localStorage, persists across reload
- Best score screen: descending scale, name + time displayed
- Play again: Y restarts, N ends, anything else beeps
- Touch: virtual stick works on iPhone/iPad
- Resize: integer scaling adapts to window changes, stays pixel-crisp
- Audio resumes after first user gesture
- Tab-hidden pauses game and audio, resumes on tab visible

**Browser smoke-test** before declaring done: latest Chrome, Safari macOS, Safari iOS, Firefox.

## Open implementation questions (to resolve during build)

- Exact tempo constant for PLAY-string interpreter (calibrate by ear against a CoCo emulator recording)
- Three concrete delay values (in ms) for the three keyboard speeds
- Exact RGB tweaks for semigraphics colors (the table above is a starting point — may adjust to match a CoCo emulator screenshot side-by-side)
