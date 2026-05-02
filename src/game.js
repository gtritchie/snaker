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
  await setup(screen, audio)

  // playRounds, win, score, etc. — wired up in Task 13-15.
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
