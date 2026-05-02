import { createScreen } from './screen.js'
import { createAudio } from './audio.js'
import { createInput } from './input.js'

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Original Bublitchki melody — copied verbatim from snaker.bas line 50.
const TITLE_MUSIC = "T4 O3 V25 L8 D G A L4 B L8 A G P8 O4 D C# C O3 L4 B L8 A G P8 D G B O4 L4 D L8 C# L4 D O3 L8 B A G L4... B L8 B O4 E D# L4 E O3 L8 B L4 O4 C L8 O3 B O4 D C L4 O3 B L8 A L4 G L8 B O4 D C O3 B P8 A L4 B L8 A G F# E P8 B P4 O4 E"

const rnd = n => Math.floor(Math.random() * n) + 1

const NATIVE_W = 256
const NATIVE_H = 192

function pickInitialScale(screen) {
  const maxW = Math.floor(window.innerWidth / NATIVE_W)
  const maxH = Math.floor(window.innerHeight / NATIVE_H)
  const scale = Math.max(1, Math.min(maxW, maxH))
  screen.setScale(scale)
}

export async function runGame(canvas, registerAudio = () => {}) {
  const screen = createScreen(canvas)
  const audio = createAudio()
  registerAudio(audio)
  const input = createInput(canvas)
  pickInitialScale(screen)

  window.addEventListener('resize', () => pickInitialScale(screen))

  await titleScreen(screen, audio, input)

  while (true) {
    await setup(screen, audio)
    const elapsed = await playRounds(screen, audio, input)
    await winSequence(screen, audio)
    // score, persistence, again — wired up in Task 15.
    void elapsed
    return
  }
}

const WIN_PHRASES = [
  "V7  O2 T2 L8 F A O3 B C L4 F L8 C L4. F",
  "V>  O2 T2 L8 A O3 C E L4. G L8 E L4. G",
  "V>  O3 T2 L8 C F A O4 L4 C O5 L8 A O4 L4. C",
]
const ARPEGGIO = "T255 O1 E F G B C A E D A G F C E D C B G E A D D A B C G E A D G C A E F E B C E D G A E D B C D E D G B C E D C"

async function winSequence(screen, audio) {
  for (const phrase of WIN_PHRASES) {
    screen.cls(rnd(8))
    await audio.play(phrase)
    await audio.play(ARPEGGIO)
  }
  await audio.play("V15")
}

// Color block codes from BASIC line 30 DATA: 159, 191, 207, 239, 255.
const COLOR_BLOCKS = [159, 191, 207, 239, 255]

// Snake body codes used by the inner loop FOR N=148 TO 244 STEP 16.
const SNAKE_CODES = [148, 164, 180, 196, 212, 228, 244]

// Returns total elapsed ticks (60 Hz) once the player completes 3 successful descents.
// Only the active-play time of each descent is counted — inter-run celebration delays
// are excluded, mirroring the original's TIMER=HT save/restore on lines 380-400.
async function playRounds(screen, audio, input) {
  let leftEdge = 1025, rightEdge = 1054, playerPos = 1039
  let runs = 0
  let accumulatedMs = 0

  while (true) {
    const runStart = performance.now()
    await singleDescent(screen, audio, input,
      { leftEdge, rightEdge, playerPos })
    accumulatedMs += performance.now() - runStart
    leftEdge = 1025; rightEdge = 1054; playerPos = 1039

    runs += 1
    if (runs >= 3) return msToTicks(accumulatedMs)
    await celebrateRun(screen, audio)   // not counted toward score
  }
}

function msToTicks(ms) {
  return Math.floor(ms / (1000 / 60))
}

// Runs one row-by-row descent. Crashes back the snake up one row in place
// (matches the original's GOTO 130 from the crash handler) and returns only
// when the snake reaches the bottom row.
async function singleDescent(screen, audio, input, init) {
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

        if (screen.peek(playerPos) !== 96) {
          ;({ leftEdge, rightEdge, playerPos } = await crashHandler(screen, audio,
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

async function crashHandler(screen, audio, { leftEdge, rightEdge, playerPos }) {
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
    await sleep(60)
    audio.flush()
    audio.play("L8 E")
    screen.setInverted(false)
    await sleep(60)
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

async function celebrateRun(screen, audio) {
  // BASIC lines 390-400: 15 quick beeps, then re-seal bottom-row edges.
  for (let i = 0; i < 15; i++) {
    audio.flush()
    audio.play("O4 T255 A B E")
    screen.poke(1504, 175)
    screen.poke(1535, 175)
    await sleep(20)
  }
  screen.poke(1504, 175)
  screen.poke(1535, 175)
}

async function titleScreen(screen, audio, input) {
  // Mirrors snaker.bas line 40:
  //   CLS RND(4)+1
  //   PRINT@192,STRING$(32,"%")
  //   PRINT@224,STRING$(13,255)
  //   PRINT@237,"snaker";STRING$(13,255);STRING$(32,"%")
  screen.cls(rnd(4) + 1)

  for (let i = 0; i < 32; i++) screen.poke(1024 + 192 + i, 37)         // '%' top row
  for (let i = 0; i < 13; i++) screen.poke(1024 + 224 + i, 255)        // orange blocks left of "snaker"
  screen.printAt(237, 'snaker')                                         // PRINT@237 → cols 13-18 of row 7
  for (let i = 0; i < 13; i++) screen.poke(1024 + 243 + i, 255)        // orange blocks right of "snaker"
  for (let i = 0; i < 32; i++) screen.poke(1024 + 256 + i, 37)         // '%' row below

  screen.printAt(480, '<<press ANY key TO START>>')

  // First user gesture resumes audio. Music starts after the gesture so mobile
  // browsers do not block it. A second key press dismisses the title.
  await input.waitForKey()
  await audio.resume()
  audio.play(TITLE_MUSIC)
  await input.waitForKey()
  audio.flush()   // drop any remaining title music so setup beeps don't queue behind it
}

async function setup(screen, audio) {
  // Lines 90-100 of snaker.bas: CLS, then draw left and right walls one row at a time
  // with stepped tones. We await each play() so the visual pacing matches the audio
  // (the original BASIC's PLAY blocks). Without awaiting, fire-and-forget plays
  // queue many seconds of audio behind a sub-second visual loop.
  await audio.resume()
  screen.cls(0)
  for (let p = 1024; p <= 1504; p += 32) {
    screen.poke(p, 175)
    await audio.play("T255 O4 A B")
    screen.poke(p + 31, 175)
    await audio.play("O4 E")
  }
}
