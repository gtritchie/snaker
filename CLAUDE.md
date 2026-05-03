# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser port of a 1983 TRS-80 Color Computer BASIC game (originally published in *The Rainbow*, January 1984). Vanilla ES modules — **no package.json, no build system, no bundler, no test runner, no linter config**. Source loads directly into the browser as `<script type="module">`.

The original BASIC source is preserved in `src/snaker.bas` (verbatim) and `src/snaker-readable.bas` (annotated). The JavaScript port is intentionally faithful to that BASIC: comments throughout reference original line numbers (e.g. `BASIC line 510`), and behavioral quirks of CoCo BASIC are reproduced rather than "fixed."

## Running and testing

ES modules cannot load from `file://`, so everything must be served over HTTP.

```sh
# From the repo root:
python3 -m http.server 8000
```

- Game: <http://localhost:8000/>
- Tests: <http://localhost:8000/tests.html> — renders pass/fail counts and per-test rows in the page.

There is no `npm test`, no headless runner, no CI. Tests are registered through a tiny custom harness (`tests/harness.js`) and aggregated by `tests.html`. To **run a single test file** in isolation, edit `tests.html` and comment out the other `import` lines — there is no other selection mechanism. Async tests are awaited inside `report()` so a rejected promise can't silently land as PASS.

## Architecture

`index.html` boots `src/main.js#boot`, which calls `runGame(canvas)` from `src/game.js`. From there:

- **`game.js`** is the orchestrator. `runGame` is a `while (true)` loop wrapped in try/catch for `GameAbortedError`. Every `await` inside the gameplay flow goes through `tracked(promise)`, which registers a rejecter on a module-level `Set`; pressing ESC calls `fireAbort()`, which rejects every in-flight tracked promise with `GameAbortedError`, unwinding the stack back to the outer loop, which then restarts at the pre-title. **When adding new awaitable steps inside the gameplay flow, wrap them in `tracked(...)` or ESC won't interrupt them.**
- **`screen.js`** emulates the CoCo's 32×16 character VRAM (addresses `1024..1535`) on a 256×192 canvas. `poke`/`peek`/`printAt`/`cls`/`scrollUp` mirror their BASIC counterparts. **Cell code `96` is the "blank/safe" sentinel** — the collision check in `singleDescent` is literally `screen.peek(playerPos) !== 96`. `cls(0)` fills with 96 (rendered as solid green); `cls(1..8)` fills with the CoCo's all-quadrants semigraphics block of that color. `scrollUp` reproduces the original's `PRINT@511,CHR$(...)` scroll trick that the gameplay loop relies on to make cars rise.
- **`audio.js`** has two halves: a pure parser (`parsePlayString`) for CoCo PLAY strings, and a Web Audio synth (`createAudio`) that maintains cross-call running state (tempo / octave / length+dots / volume) the same way BASIC's `PLAY` statement does. **CoCo PLAY's octave numbering is shifted up one from MIDI** — `noteFrequency` adds 2 (not 1) when computing the MIDI number; this is calibrated against an emulator recording, not a guess. Whitespace inside PLAY strings is significant only as a separator because BASIC's `STR$(N)` prepends a space for non-negative integers, producing things like `"O 1N 5"`. `flush()` cancels currently-scheduled oscillators (used before a fresh `play()` so the gameplay loop's fire-and-forget step beeps don't pile up).
- **`input.js`** owns keyboard + touch state. Keyboard and touch directions are tracked in **separate** `kbKeys` / `tcKeys` records and OR'd together in `getX`/`getSpeedMs` — releasing a finger must not clear a held arrow key, and vice versa. The touch joystick re-centers on each `touchstart` (not at canvas center) with a 16-px deadzone. `lineInput()` collects characters into a buffer and calls back into the caller's `render(buffer)` so the caller can draw the prompt+cursor on the canvas. ESC clears `keyListeners`, rejects any pending `lineInput`, and fires every registered `onEscape` handler — this is how the abort chain in `game.js` triggers.
- **`glyphs.js`** is a hand-drawn 8×12 bitmap font (codes 32–127) plus a decoder for CoCo semigraphics-4 (codes 128–255: 3 bits color + 4 bits quadrant mask). `screen.js` calls `drawCell` for each VRAM cell.
- **`storage.js`** wraps `localStorage` for best-score persistence. Every call is try/catched because Safari Private Mode throws on `setItem`; failures degrade to "no best score" rather than crashing.

## Conventions worth knowing

- **BASIC fidelity is a deliberate design goal.** When changing gameplay, scoring, or audio/visual sequencing, check `src/snaker.bas` (or the annotated `snaker-readable.bas`) to see what the original did. Many comments include explicit BASIC line numbers; preserve those references when editing nearby code.
- **Two tuning knobs at the top of `game.js`:** `REQUIRED_DESCENTS` (default 3) and `COLLISION_DETECTION` (default `true`). Lower the first or disable the second when manually testing the win/score/best-score flow.
- **No linter, no type checker.** The "verify" loop is: re-read your diff, then load `tests.html` and the game in the browser. UI changes especially need an in-browser smoke test — there is no headless way to catch a regression in the title sequence, the abort flow, or the touch joystick.
- **Audio quirks are calibrated, not arbitrary.** Constants like `WHOLE_NOTE_SEC_AT_T_1 = 4.4` and the 460-iter/sec BASIC-loop reference (used to convert original `FOR PP=1 TO N` delays into ms in `game.js`, e.g. `await sleep(3913)`) come from emulator-recording calibration. Don't "round" them without re-measuring.
