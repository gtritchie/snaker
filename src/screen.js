import { drawCell, naturalInverse, FONT_WIDTH, FONT_HEIGHT } from './glyphs.js'

const COLS = 32
const ROWS = 16
const VRAM_SIZE = COLS * ROWS // 512
const BASE = 1024             // CoCo video RAM start address

export const NATIVE_WIDTH = COLS * FONT_WIDTH    // 256
export const NATIVE_HEIGHT = ROWS * FONT_HEIGHT  // 192

// Returns a screen object that wraps a canvas at integer scale.
// Resize the underlying canvas with setScale(); the screen redraws automatically.
export function createScreen(canvas) {
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  const vram = new Uint8Array(VRAM_SIZE)
  const inverseFlags = new Uint8Array(VRAM_SIZE)
  let scale = 1
  let inverted = false

  function setScale(s) {
    scale = Math.max(1, Math.floor(s))
    canvas.width = NATIVE_WIDTH * scale
    canvas.height = NATIVE_HEIGHT * scale
    ctx.imageSmoothingEnabled = false
    redrawAll()
  }

  function redrawAll() {
    for (let i = 0; i < VRAM_SIZE; i++) renderCell(i)
  }

  function renderCell(offset) {
    const col = offset % COLS
    const row = Math.floor(offset / COLS)
    const x = col * FONT_WIDTH * scale
    const y = row * FONT_HEIGHT * scale
    const code = vram[offset]
    // Compose: per-cell force flag OR intrinsic VDG inverse, then XOR global crash flash.
    const natural = naturalInverse(code, !!inverseFlags[offset])
    const effective = natural !== inverted
    drawCell(ctx, code === 0 ? 32 : code, x, y, scale, effective)
  }

  function offsetOf(addr) {
    const off = addr - BASE
    if (off < 0 || off >= VRAM_SIZE) return -1
    return off
  }

  function poke(addr, code) {
    const off = offsetOf(addr)
    if (off < 0) return
    vram[off] = code & 0xff
    inverseFlags[off] = 0
    renderCell(off)
  }

  function peek(addr) {
    const off = offsetOf(addr)
    return off < 0 ? 0 : vram[off]
  }

  // Print a string at video-RAM offset (0..511) — equivalent to BASIC PRINT@offset.
  // Lowercase letters always render in inverse video (CoCo convention).
  // Pass { inverse: true } to force every cell into inverse mode, which simulates the
  // CoCo BASIC "command line" black-on-green look (uppercase letters, spaces, and
  // symbols all render as black-on-green).
  function printAt(offset, str, options = {}) {
    const forceInverse = options.inverse === true
    for (let i = 0; i < str.length; i++) {
      const idx = offset + i
      if (idx < 0 || idx >= VRAM_SIZE) continue
      const ch = str.charCodeAt(i)
      const isLower = ch >= 97 && ch <= 122
      vram[idx] = isLower ? ch - 32 : ch
      inverseFlags[idx] = (isLower || forceInverse) ? 1 : 0
      renderCell(idx)
    }
  }

  // Equivalent to CoCo CLS [color]. Fills vram with the appropriate sentinel:
  //   colorIndex 0 (default): code 96, the "blank playable cell" sentinel that
  //                           collision logic checks against (PEEK(P) === 96).
  //                           On the VDG, code 96 falls into the semigraphics-6
  //                           range and renders as a solid green block — which is
  //                           why CoCo BASIC's CLS produces a green screen.
  //   colorIndex 1-8:         all-quadrants semigraphic of the requested color (CoCo CLS arg).
  function cls(colorIndex = 0) {
    const code = colorIndex === 0 ? 96 : 128 + (((colorIndex - 1) & 0x7) << 4) + 15
    vram.fill(code)
    inverseFlags.fill(0)
    redrawAll()
  }

  function setInverted(on) {
    if (inverted === on) return
    inverted = on
    redrawAll()
  }

  // Scroll the entire screen up by one row. Original CoCo behavior triggered when
  // PRINT@511 wraps the cursor past the screen end. Used by the gameplay loop to
  // make rows of cars rise visually as new cars are added at the bottom row.
  function scrollUp() {
    vram.copyWithin(0, 32, VRAM_SIZE)
    inverseFlags.copyWithin(0, 32, VRAM_SIZE)
    const lastRow = VRAM_SIZE - COLS
    for (let i = lastRow; i < VRAM_SIZE; i++) {
      vram[i] = 96
      inverseFlags[i] = 0
    }
    redrawAll()
  }

  return {
    setScale, poke, peek, printAt, cls, redrawAll, setInverted, scrollUp,
    get scale() { return scale },
  }
}
