import { createScreen } from './screen.js'
import { createAudio } from './audio.js'
import { createInput } from './input.js'
import { loadBestScore, saveBestScore } from './storage.js'
import { createVisibilityGate, VisibilityGateDestroyedError } from './visibility.js'

// ─── Tuning knobs ────────────────────────────────────────────────────────────
// Number of full top-to-bottom descents required to win one game.
// Original BASIC value is 3; lower it (e.g. 1) when testing the win/score flow.
const REQUIRED_DESCENTS = 3
// Whether collision detection is active. Set to false to make the snake invincible
// during testing — useful for sanity-checking the win sequence and score screens
// without having to dodge the cars.
const COLLISION_DETECTION = true
// ─────────────────────────────────────────────────────────────────────────────

// Convert elapsed timer ticks (60 Hz) to "MM:SS".
// Mirrors the original BASIC formatting from snaker.bas lines 520-540, including
// its quirks: CoCo BASIC's STR$ prepends a leading space for non-negative integers,
// LEFT$(..., 3) truncates to the first 3 chars BEFORE narrowing to 2, so a 100-minute
// score formats as "10:00" (the first two significant digits), not "00:00". Single-
// digit minutes carry the BASIC leading space (e.g. " 1:00" for 60 seconds).
export function formatScore(ticks) {
  const sec = ticks / 60
  const totalMinutes = Math.floor(sec / 60)
  const remSeconds = Math.floor(sec - totalMinutes * 60)

  const mmRaw = (' ' + totalMinutes).slice(0, 3)
  let mm = parseInt(mmRaw, 10) < 1 ? '00' : mmRaw
  if (mm.length > 2) mm = mm.slice(-2)

  const ssRaw = (' ' + remSeconds).slice(0, 3)
  const ss = ssRaw.length < 3 ? '0' + ssRaw.slice(-1) : ssRaw.slice(-2)

  return mm + ':' + ss
}

// Abort plumbing: ESC key fires fireAbort(), which rejects every in-flight
// `tracked()` Promise with GameAbortedError. The runGame outer loop catches
// this and restarts from the pre-title screen.
class GameAbortedError extends Error {
  constructor() { super('game aborted'); this.name = 'GameAbortedError' }
}

// Original Bublitchki melody — copied verbatim from snaker.bas line 50.
const TITLE_MUSIC = "T4 O3 V25 L8 D G A L4 B L8 A G P8 O4 D C# C O3 L4 B L8 A G P8 D G B O4 L4 D L8 C# L4 D O3 L8 B A G L4... B L8 B O4 E D# L4 E O3 L8 B L4 O4 C L8 O3 B O4 D C L4 O3 B L8 A L4 G L8 B O4 D C O3 B P8 A L4 B L8 A G F# E P8 B P4 O4 E"

const rnd = n => Math.floor(Math.random() * n) + 1

const NATIVE_W = 256
const NATIVE_H = 192

export function computeScale(container, useWidthOnly) {
  const w = container.clientWidth
  const widthScale = Math.max(1, Math.floor(w / NATIVE_W))
  if (useWidthOnly) return widthScale

  const h = container.clientHeight
  if (h === 0) return widthScale   // safety net for runtime layout collapse
  const heightScale = Math.max(1, Math.floor(h / NATIVE_H))
  return Math.min(widthScale, heightScale)
}

export function runGame(canvas, registerAudio = () => {}) {
  const screen = createScreen(canvas)
  let audio = null
  // Lazy audioRef: gate is constructed before audio so audio can use gate.sleep,
  // but the gate only needs audio inside its visibilitychange handler — well after
  // both have been wired up. See spec Section 1, "Construction ordering wrinkle".
  const visibility = createVisibilityGate({ audioRef: () => audio })
  // Audio's pacing routes through the gate, but fire-and-forget audio.play()
  // call sites (step beep, playAgainPrompt beeps, celebrateRun, crashHandler)
  // would surface gate-destroy rejections as unhandled if audio.play()'s
  // internal sleep simply rethrew them. Swallow VisibilityGateDestroyedError
  // here so audio.play() resolves cleanly during shutdown. Awaited callers in
  // game.js still get correct shutdown behavior via game.js's own sleep()
  // wrapper (which does NOT swallow), routed through the runGame outer catch.
  const audioSleep = ms => visibility.sleep(ms).catch(err => {
    if (err instanceof VisibilityGateDestroyedError) return
    throw err
  })
  audio = createAudio({ sleep: audioSleep })
  registerAudio(audio)
  // Wire user gestures into audio.resume so the context unlocks during the
  // gesture's event handler — Chrome mobile and iOS Safari don't always honor
  // resume() called from a later microtask.
  const input = createInput(canvas, () => {
    audio.resume().catch(err => console.warn('audio: resume on gesture failed:', err))
  })

  const abortRejecters = new Set()

  const fireAbort = () => {
    const list = [...abortRejecters]
    abortRejecters.clear()
    for (const r of list) {
      try { r() } catch (err) { console.warn('fireAbort: rejecter threw:', err) }
    }
  }

  // Wrap a promise so that fireAbort() rejects it with GameAbortedError. The
  // underlying promise is left to settle on its own; if it resolves after the
  // wrapper has already rejected, the resolution is ignored.
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

  const sleep = (ms) => tracked(visibility.sleep(ms))

  const ctx = { screen, audio, input, visibility, tracked, sleep }

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
        return   // user chose N to quit
      } catch (err) {
        if (err instanceof GameAbortedError) {
          if (destroyed) return
          // Reset transient screen state — crashHandler may have aborted between
          // setInverted(true) and setInverted(false), leaving the playfield flipped.
          screen.setInverted(false)
          continue   // ESC pressed; restart from the pre-title
        }
        if (err instanceof VisibilityGateDestroyedError && destroyed) return
        throw err
      }
    }
  })()

  return { promise, screen, audio, input, visibility, fireAbort, escUnsub, setDestroyed }
}

async function runMainFlow(ctx) {
  const { screen } = ctx
  await titleScreen(ctx)

  let bestTicks = (loadBestScore()?.ticks) ?? Infinity

  while (true) {
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
      // BASIC line 720: print final best score and end.
      const best = loadBestScore()
      screen.cls(0)
      if (best) {
        screen.printAt(0, `BEST SCORE: ${best.name}`)
        screen.printAt(64, best.displayTime)
      }
      return
    }
  }
}

const WIN_PHRASES = [
  "V7  O2 T2 L8 F A O3 B C L4 F L8 C L4. F",
  "V>  O2 T2 L8 A O3 C E L4. G L8 E L4. G",
  // Original BASIC line 450 has O5 L8 A here, which lurches the penultimate note
  // two octaves above the final O4 C resolution. Treating that as a 4-vs-5 typo:
  // dropping to O4 keeps the C-F-A-C-A-C arpeggio cohesive and gives a step-approach
  // lead-in to the final dotted quarter, matching the other two phrases' structure.
  "V>  O3 T2 L8 C F A O4 L4 C O4 L8 A O4 L4. C",
]
const ARPEGGIO = "T255 O1 E F G B C A E D A G F C E D C B G E A D D A B C G E A D G C A E F E B C E D G A E D B C D E D G B C E D C"

async function winSequence(ctx) {
  const { screen, audio, tracked } = ctx
  // Drain any tail of the final fire-and-forget step beep so the awaited
  // win phrases line up wallclock-time with audio-time.
  audio.flush()
  for (const phrase of WIN_PHRASES) {
    screen.cls(rnd(8))
    await tracked(audio.play(phrase))
    await tracked(audio.play(ARPEGGIO))
  }
  await tracked(audio.play("V15"))
}

async function showScore(ctx, elapsed) {
  const { screen, audio, tracked, sleep } = ctx
  // BASIC line 510: CLS RND(4)+1; PRINT@168,"YOU MADE IT IN:"
  screen.cls(rnd(4) + 1)
  screen.printAt(168, 'YOU MADE IT IN:')

  const timeStr = formatScore(elapsed)
  // Decorative bar of "!" at offsets 288-319 (BASIC POKE 1312-1343, lines 550).
  for (let p = 1024 + 288; p <= 1024 + 319; p++) screen.poke(p, 33)
  screen.printAt(301, timeStr)

  // BASIC lines 570-580: ascending chromatic 5 octaves x 12 notes.
  for (let o = 1; o <= 5; o++) {
    for (let n = 1; n <= 12; n++) {
      await tracked(audio.play(`T255 O${o} N${n}`))
    }
  }
  await sleep(3913)  // BASIC FOR PP=1 TO 1800 at slow speed (460 iter/sec):
                     // 1800 / 460 ≈ 3.913 s. High-speed POKE was turned off on
                     // BASIC line 430 before the win sequence.
  return timeStr
}

async function captureNewBestScore(ctx, elapsed, displayTime) {
  const { screen, input, tracked } = ctx
  // BASIC line 790: PRINT"WHAT IS YOUR NAME";:LINE INPUT">>>>?";N$
  // The trailing semicolon on PRINT suppresses the carriage return, so ">>>>?" and
  // the user's input continue on the same row right after the prompt.
  screen.cls(rnd(8))
  const messageOffset = 0
  const promptOffset = messageOffset + 'WHAT IS YOUR NAME'.length  // 17
  screen.printAt(messageOffset, 'WHAT IS YOUR NAME')

  let name = ''
  await tracked(input.lineInput({
    maxLength: 32 - promptOffset - '>>>>?'.length - 1,  // leave room for cursor
    render(buffer) {
      const prompt = '>>>>?' + buffer
      // Blank the prompt+input region (everything from promptOffset to end of row).
      for (let i = promptOffset; i < 32; i++) screen.poke(1024 + i, 32)
      screen.printAt(promptOffset, prompt)
      const cursorPos = promptOffset + prompt.length
      // Yellow (semigraphic 159 = all-quadrants color 1) so the cursor stands out
      // against the surrounding green text background.
      if (cursorPos < 32) screen.poke(1024 + cursorPos, 159)
      name = buffer
    },
  }))
  saveBestScore({ name: name.toUpperCase(), ticks: elapsed, displayTime })
}

async function showBestScore(ctx) {
  const { screen, audio, tracked, sleep } = ctx
  const best = loadBestScore()
  if (!best) return
  // BASIC lines 620-660.
  screen.cls(0)
  screen.printAt(10, 'BEST SCORE')

  for (let i = 0; i < 32; i++) screen.poke(1024 + 224 + i, 143)
  for (let i = 0; i < 32; i++) screen.poke(1024 + 192 + i, 255)
  for (let i = 0; i < 32; i++) screen.poke(1024 + 256 + i, 255)

  screen.printAt(224, `${best.name}----------${best.displayTime}`.slice(0, 32))

  for (let o = 5; o >= 1; o--) {
    for (let n = 12; n >= 1; n--) {
      await tracked(audio.play(`T255 O${o} N${n}`))
    }
  }
  await sleep(3913)  // BASIC line 660: FOR PP=1 TO 1800 at slow speed (460 iter/sec)
}

async function playAgainPrompt(ctx) {
  const { screen, audio, input, tracked } = ctx
  // BASIC lines 700-730. Y/N at opposite screen edges doubles as touch tap zones:
  // left-half tap resolves as 'y', right-half tap as 'n' (see input.js onTouchStart).
  audio.flush()
  audio.play("V15 O3 N5")
  screen.cls(0)
  screen.printAt(0, 'ANOTHER GAME?')
  screen.printAt(32, '[Y]' + ' '.repeat(26) + '[N]')

  while (true) {
    const k = (await tracked(input.waitForKey())).toUpperCase()
    if (k === 'Y') return true
    if (k === 'N') return false
    audio.flush()
    audio.play("O3 N1")
  }
}

// Color block codes from BASIC line 30 DATA: 159, 191, 207, 239, 255.
const COLOR_BLOCKS = [159, 191, 207, 239, 255]

// Snake body codes used by the inner loop FOR N=148 TO 244 STEP 16.
const SNAKE_CODES = [148, 164, 180, 196, 212, 228, 244]

// Returns total elapsed ticks (60 Hz) once the player completes 3 successful descents.
// Only the active-play time of each descent is counted — inter-run celebration delays
// are excluded, mirroring the original's TIMER=HT save/restore on lines 380-400.
async function playRounds(ctx) {
  let leftEdge = 1025, rightEdge = 1054, playerPos = 1039
  let runs = 0
  let accumulatedMs = 0

  while (true) {
    const runStart = ctx.visibility.visibleNow()
    await singleDescent(ctx, { leftEdge, rightEdge, playerPos })
    accumulatedMs += ctx.visibility.visibleNow() - runStart
    leftEdge = 1025; rightEdge = 1054; playerPos = 1039

    runs += 1
    if (runs >= REQUIRED_DESCENTS) return msToTicks(accumulatedMs)
    await celebrateRun(ctx)   // not counted toward score
  }
}

function msToTicks(ms) {
  return Math.floor(ms / (1000 / 60))
}

// Runs one row-by-row descent. Crashes back the snake up one row in place
// (matches the original's GOTO 130 from the crash handler) and returns only
// when the snake reaches the bottom row.
async function singleDescent(ctx, init) {
  const { screen, audio, input, sleep } = ctx
  let { leftEdge, rightEdge, playerPos } = init

  while (true) {
    let crashed = false

    // Inner two-pass loop placing 14 segments per row (QQ=1..2, N=148..244 STEP 16).
    for (let pass = 0; pass < 2 && !crashed; pass++) {
      for (let i = 0; i < SNAKE_CODES.length; i++) {
        const snakeChar = SNAKE_CODES[i]
        const moveDir = input.getX()
        const speedMs = input.getSpeedMs()

        playerPos = playerPos + moveDir
        if (playerPos < leftEdge) playerPos = leftEdge
        else if (playerPos > rightEdge) playerPos = rightEdge

        if (COLLISION_DETECTION && screen.peek(playerPos) !== 96) {
          ;({ leftEdge, rightEdge, playerPos } = await crashHandler(ctx,
            { leftEdge, rightEdge, playerPos }))
          crashed = true
          break
        }

        screen.poke(playerPos, snakeChar)
        // Step beep is fire-and-forget but flush first so a slow tempo can't
        // pile audio up behind the real-time gameplay loop.
        audio.flush()
        audio.play("O2 T255 G O3 C")

        await sleep(speedMs)

        // Scatter random color blocks on bottom row (lines 210-230).
        // BASIC RND(30) yields 1..30, so target offsets 1505..1534.
        // BASIC RND(5) yields 1..5; here we map to a 0..4 array index.
        screen.poke(1504 + rnd(30), COLOR_BLOCKS[rnd(5) - 1])
        screen.poke(1504 + rnd(30), COLOR_BLOCKS[rnd(5) - 1])
        screen.poke(1504, 175)
        screen.poke(1535, 175)

        // Scroll the whole screen up by one row, matching the original BASIC's
        // PRINT@511,CHR$(175); trick. Cars and walls just placed on row 15 rise
        // visually each iteration; the snake byte placed at playerPos rolls
        // off the top, leaving playerPos as a fresh empty cell next iteration.
        screen.scrollUp()
      }
    }

    if (!crashed) {
      // Advance row (BASIC lines 270-290).
      leftEdge += 32
      rightEdge += 32
      if (leftEdge === 1441) {
        // Reached bottom row.
        screen.poke(playerPos, 148)
        playerPos += 32
        screen.poke(playerPos, 244)
        return
      }
      screen.poke(playerPos, 148)
      playerPos += 32
    }
    // If crashed, crashHandler already shifted the state back; outer loop continues.
  }
}

async function crashHandler(ctx, { leftEdge, rightEdge, playerPos }) {
  const { screen, audio, sleep } = ctx
  // BASIC lines 320-350.
  leftEdge -= 32
  rightEdge -= 32
  if (leftEdge < 1025) {
    leftEdge = 1025
    rightEdge += 32
  }

  for (let pl = 0; pl < 2; pl++) {
    audio.flush()
    audio.play("O2 T2 L8 B")
    screen.setInverted(true)
    await sleep(120)
    audio.flush()
    audio.play("L8 E")
    screen.setInverted(false)
    await sleep(120)
  }

  // BASIC RND(29)+1505 → 1506..1534.
  screen.poke(1505 + rnd(29), COLOR_BLOCKS[rnd(5) - 1])
  screen.poke(1504, 175)
  screen.poke(1535, 175)
  screen.poke(playerPos, 96)
  playerPos -= 32
  screen.poke(playerPos, 96)
  screen.poke(playerPos + 1, 96)
  screen.poke(playerPos - 1, 96)
  if (playerPos < 1025) playerPos += 32

  return { leftEdge, rightEdge, playerPos }
}

async function celebrateRun(ctx) {
  const { screen, audio, sleep } = ctx
  // BASIC lines 390-400: 15 quick beeps with the same POKE 1504,175 + PRINT@511
  // pattern as the descent loop. The PRINT@511 scrolls the screen up each
  // iteration, so the playfield is wiped clean by the end of the celebration
  // and the next descent starts on a freshly scrolled wall field rather than
  // the stale snake/obstacle state from the previous run.
  for (let i = 0; i < 15; i++) {
    audio.flush()
    audio.play("O4 T255 A B E")
    screen.poke(1504, 175)
    screen.poke(1535, 175)
    screen.scrollUp()
    await sleep(40)
  }
  screen.poke(1504, 175)
  screen.poke(1535, 175)
}

async function titleScreen(ctx) {
  const { screen, audio, input, tracked } = ctx
  // Pre-title gateway. Browsers block audio autoplay until the user has interacted
  // with the page, so we show a plain "RUN" prompt first and use that key press
  // to resume the AudioContext. Styled to match the CoCo BASIC command-line look:
  // black text on a uniform green background.
  for (let i = 0; i < 512; i++) screen.poke(1024 + i, 32) // code 32 = solid green block
  screen.printAt(224, 'PRESS ANY KEY TO RUN THE PROGRAM')
  screen.printAt(294, 'MOVE: ARROWS / WASD')
  screen.printAt(321, 'SPEED: UP/W=FAST  DOWN/S=SLOW')
  screen.printAt(360, 'ABORT GAME: ESC')
  screen.printAt(417, 'TOUCH SCREEN: VIRTUAL JOYSTICK')
  await tracked(input.waitForKey())
  // Audio unlock is handled by createInput's onUserGesture callback (wired in
  // runGame), which calls audio.resume() synchronously inside the touch/click/
  // key handler — that placement is what Chrome mobile and iOS Safari require.

  // Title screen artwork — mirrors snaker.bas line 40:
  //   CLS RND(4)+1
  //   PRINT@192,STRING$(32,"%")
  //   PRINT@224,STRING$(13,255)
  //   PRINT@237,"snaker";STRING$(13,255);STRING$(32,"%")
  screen.cls(rnd(4) + 1)
  for (let i = 0; i < 32; i++) screen.poke(1024 + 192 + i, 37)   // '%' top row
  for (let i = 0; i < 13; i++) screen.poke(1024 + 224 + i, 255)  // orange blocks left of "snaker"
  screen.printAt(237, 'snaker')                                  // cols 13-18 of row 7
  for (let i = 0; i < 13; i++) screen.poke(1024 + 243 + i, 255)  // orange blocks right of "snaker"
  for (let i = 0; i < 32; i++) screen.poke(1024 + 256 + i, 37)   // '%' row below

  // Play the Bublitchki melody in full, like the original BASIC's blocking PLAY
  // on line 50. Then show the start prompt and wait for the player.
  await tracked(audio.play(TITLE_MUSIC))

  screen.printAt(480, '<<press ANY key TO START>>')
  await tracked(input.waitForKey())
}

async function setup(ctx) {
  const { screen, audio, tracked } = ctx
  // Lines 90-100 of snaker.bas: CLS, then draw left and right walls one row at a time
  // with stepped tones. We await each play() so the visual pacing matches the audio
  // (the original BASIC's PLAY blocks). Without awaiting, fire-and-forget plays
  // queue many seconds of audio behind a sub-second visual loop.
  screen.cls(0)
  for (let p = 1024; p <= 1504; p += 32) {
    screen.poke(p, 175)
    await tracked(audio.play("T255 O4 A B"))
    screen.poke(p + 31, 175)
    await tracked(audio.play("O4 E"))
  }
}
