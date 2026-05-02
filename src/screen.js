import { drawCell, FONT_WIDTH, FONT_HEIGHT } from './glyphs.js'

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
    const inv = !!inverseFlags[offset] !== inverted
    drawCell(ctx, code === 0 ? 32 : code, x, y, scale, inv)
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
  // Lowercase letters render in inverse video (CoCo convention: BASIC stores them as
  // their uppercase code with the inverse-video bit set).
  function printAt(offset, str) {
    for (let i = 0; i < str.length; i++) {
      const idx = offset + i
      if (idx < 0 || idx >= VRAM_SIZE) continue
      const ch = str.charCodeAt(i)
      const isLower = ch >= 97 && ch <= 122
      vram[idx] = isLower ? ch - 32 : ch
      inverseFlags[idx] = isLower ? 1 : 0
      renderCell(idx)
    }
  }

  // Equivalent to CoCo CLS [color]. Fills vram with the appropriate sentinel:
  //   colorIndex 0 (default): code 96, the "blank playable cell" sentinel that
  //                           collision logic checks against (PEEK(P) === 96).
  //                           Code 96 is in the VDG's "alphanumeric normal" range
  //                           with no glyph bits set, so it renders solid black —
  //                           distinct from code 32, which is in the 32-63 inverse
  //                           range and would render as a solid green block.
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

  return {
    setScale, poke, peek, printAt, cls, redrawAll, setInverted,
    get scale() { return scale },
  }
}
