// CoCo Semigraphics-4 colors. Used for character codes 128–255.
export const SEMI_COLORS = [
  '#07ff00', // 0 green
  '#ffff00', // 1 yellow
  '#3b08ff', // 2 blue
  '#cc003b', // 3 red
  '#ffffff', // 4 buff
  '#07e399', // 5 cyan
  '#ff1fcb', // 6 magenta
  '#ff8100', // 7 orange
]

// Decode a CoCo semigraphics character (codes 128-255) into color + lit quadrants.
// Returns null for codes outside the semigraphics range.
//
// Encoding: byte = code - 128 (7 bits)
//   bits 6-4: color index (0-7)
//   bit 3:    top-left quadrant
//   bit 2:    top-right quadrant
//   bit 1:    bottom-left quadrant
//   bit 0:    bottom-right quadrant
export function decodeSemigraphic(code) {
  if (code < 128 || code > 255) return null
  const v = code - 128
  return {
    color: SEMI_COLORS[(v >> 4) & 0x7],
    quadrants: {
      tl: !!(v & 0x8),
      tr: !!(v & 0x4),
      bl: !!(v & 0x2),
      br: !!(v & 0x1),
    },
  }
}

export const FONT_WIDTH = 8
export const FONT_HEIGHT = 12

// 8x12 bitmap font, CoCo-style. Each glyph is 12 bytes; each byte is one row,
// MSB = leftmost pixel. Hand-drawn clean-room shapes inspired by the CoCo character ROM.
const G = (...rows) => Uint8Array.from(rows)

const FONT = {
  ' ': G(0,0,0,0,0,0,0,0,0,0,0,0),

  'A': G(0,0, 0b00011000, 0b00100100, 0b01000010, 0b01000010, 0b01111110, 0b01000010, 0b01000010, 0b01000010, 0,0),
  'B': G(0,0, 0b01111100, 0b01000010, 0b01000010, 0b01111100, 0b01000010, 0b01000010, 0b01000010, 0b01111100, 0,0),
  'C': G(0,0, 0b00111100, 0b01000010, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0b01000010, 0b00111100, 0,0),
  'D': G(0,0, 0b01111000, 0b01000100, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000100, 0b01111000, 0,0),
  'E': G(0,0, 0b01111110, 0b01000000, 0b01000000, 0b01111100, 0b01000000, 0b01000000, 0b01000000, 0b01111110, 0,0),
  'F': G(0,0, 0b01111110, 0b01000000, 0b01000000, 0b01111100, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0,0),
  'G': G(0,0, 0b00111100, 0b01000010, 0b01000000, 0b01000000, 0b01001110, 0b01000010, 0b01000010, 0b00111100, 0,0),
  'H': G(0,0, 0b01000010, 0b01000010, 0b01000010, 0b01111110, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0,0),
  'I': G(0,0, 0b00111100, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00111100, 0,0),
  'J': G(0,0, 0b00000110, 0b00000010, 0b00000010, 0b00000010, 0b00000010, 0b00000010, 0b01000010, 0b00111100, 0,0),
  'K': G(0,0, 0b01000010, 0b01000100, 0b01001000, 0b01110000, 0b01001000, 0b01000100, 0b01000010, 0b01000010, 0,0),
  'L': G(0,0, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0b01111110, 0,0),
  'M': G(0,0, 0b01000010, 0b01100110, 0b01011010, 0b01011010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0,0),
  'N': G(0,0, 0b01000010, 0b01100010, 0b01010010, 0b01001010, 0b01000110, 0b01000010, 0b01000010, 0b01000010, 0,0),
  'O': G(0,0, 0b00111100, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b00111100, 0,0),
  'P': G(0,0, 0b01111100, 0b01000010, 0b01000010, 0b01111100, 0b01000000, 0b01000000, 0b01000000, 0b01000000, 0,0),
  'Q': G(0,0, 0b00111100, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01001010, 0b01000100, 0b00111010, 0,0),
  'R': G(0,0, 0b01111100, 0b01000010, 0b01000010, 0b01111100, 0b01001000, 0b01000100, 0b01000010, 0b01000010, 0,0),
  'S': G(0,0, 0b00111100, 0b01000010, 0b01000000, 0b00111100, 0b00000010, 0b00000010, 0b01000010, 0b00111100, 0,0),
  'T': G(0,0, 0b01111110, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0,0),
  'U': G(0,0, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b00111100, 0,0),
  'V': G(0,0, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b00100100, 0b00100100, 0b00011000, 0,0),
  'W': G(0,0, 0b01000010, 0b01000010, 0b01000010, 0b01000010, 0b01011010, 0b01011010, 0b01100110, 0b01000010, 0,0),
  'X': G(0,0, 0b01000010, 0b01000010, 0b00100100, 0b00011000, 0b00011000, 0b00100100, 0b01000010, 0b01000010, 0,0),
  'Y': G(0,0, 0b01000010, 0b01000010, 0b00100100, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0,0),
  'Z': G(0,0, 0b01111110, 0b00000010, 0b00000100, 0b00001000, 0b00010000, 0b00100000, 0b01000000, 0b01111110, 0,0),

  '0': G(0,0, 0b00111100, 0b01000010, 0b01000110, 0b01001010, 0b01010010, 0b01100010, 0b01000010, 0b00111100, 0,0),
  '1': G(0,0, 0b00011000, 0b00111000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b01111110, 0,0),
  '2': G(0,0, 0b00111100, 0b01000010, 0b00000010, 0b00000100, 0b00011000, 0b00100000, 0b01000000, 0b01111110, 0,0),
  '3': G(0,0, 0b00111100, 0b01000010, 0b00000010, 0b00011100, 0b00000010, 0b00000010, 0b01000010, 0b00111100, 0,0),
  '4': G(0,0, 0b00000100, 0b00001100, 0b00010100, 0b00100100, 0b01000100, 0b01111110, 0b00000100, 0b00000100, 0,0),
  '5': G(0,0, 0b01111110, 0b01000000, 0b01000000, 0b01111100, 0b00000010, 0b00000010, 0b01000010, 0b00111100, 0,0),
  '6': G(0,0, 0b00111100, 0b01000010, 0b01000000, 0b01111100, 0b01000010, 0b01000010, 0b01000010, 0b00111100, 0,0),
  '7': G(0,0, 0b01111110, 0b00000010, 0b00000100, 0b00001000, 0b00010000, 0b00010000, 0b00010000, 0b00010000, 0,0),
  '8': G(0,0, 0b00111100, 0b01000010, 0b01000010, 0b00111100, 0b01000010, 0b01000010, 0b01000010, 0b00111100, 0,0),
  '9': G(0,0, 0b00111100, 0b01000010, 0b01000010, 0b01000010, 0b00111110, 0b00000010, 0b01000010, 0b00111100, 0,0),

  ':': G(0,0, 0,            0b00011000, 0b00011000, 0,            0,            0b00011000, 0b00011000, 0,            0,0),
  '?': G(0,0, 0b00111100, 0b01000010, 0b00000010, 0b00000100, 0b00011000, 0b00011000, 0,            0b00011000, 0,0),
  '<': G(0,0, 0b00000110, 0b00011000, 0b01100000, 0b10000000, 0b01100000, 0b00011000, 0b00000110, 0,            0,0),
  '>': G(0,0, 0b01100000, 0b00011000, 0b00000110, 0b00000001, 0b00000110, 0b00011000, 0b01100000, 0,            0,0),
  '(': G(0,0, 0b00001100, 0b00010000, 0b00100000, 0b00100000, 0b00100000, 0b00100000, 0b00010000, 0b00001100, 0,0),
  ')': G(0,0, 0b00110000, 0b00001000, 0b00000100, 0b00000100, 0b00000100, 0b00000100, 0b00001000, 0b00110000, 0,0),
  '/': G(0,0, 0b00000010, 0b00000100, 0b00001000, 0b00010000, 0b00100000, 0b01000000, 0,            0,            0,0),
  '-': G(0,0, 0,            0,            0,            0b01111110, 0,            0,            0,            0,            0,0),
  '!': G(0,0, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0b00011000, 0,            0b00011000, 0b00011000, 0,0),
  '%': G(0,0, 0b11000010, 0b11000100, 0b00001000, 0b00010000, 0b00100000, 0b01000110, 0b10000110, 0,            0,0),
}

const EMPTY_GLYPH = G(0,0,0,0,0,0,0,0,0,0,0,0)

// Look up the 12-byte glyph for an ASCII character. Lowercase maps to uppercase
// (CoCo has no lowercase letterforms — visual differentiation comes from inverse video,
// which is applied separately). Unknown characters render as blank.
export function getCharGlyph(ch) {
  const upper = ch.toUpperCase()
  return FONT[upper] ?? EMPTY_GLYPH
}

// Returns the list of characters with explicit glyph definitions. Used by tests to
// assert every glyph has the expected row count.
export function getDefinedChars() {
  return Object.keys(FONT)
}

// Draw one 8x12 character cell on a canvas 2D context, scaled by `scale`.
// `x` and `y` are top-left coordinates in canvas pixels (already multiplied by scale).
//
// Character code semantics:
//   0-127:    alphanumeric (text). CoCo BASIC default is BLACK CHARACTER on GREEN
//             BACKGROUND. Spaces and other unprinted bits leave the cell as solid
//             green (continuous with the screen background filled by CLS).
//   96:       "blank playable cell" sentinel. Same green appearance as a space; also
//             the value the gameplay collision check looks for ("IF PEEK(P)<>96").
//   128-255:  semigraphics color block (see decodeSemigraphic).
//
// `inverse` is the global crash-flash flip — when true, every cell renders inverted
// (green character on black background, solid black for spaces). Used only by
// SCREEN 0,1 / SCREEN 0,0 in the original; reproduced here via screen.setInverted.
export function drawCell(ctx, code, x, y, scale, inverse = false) {
  const w = FONT_WIDTH * scale
  const h = FONT_HEIGHT * scale

  if (code >= 128) {
    drawSemigraphic(ctx, code, x, y, scale)
    return
  }

  const bg = inverse ? '#000000' : '#07ff00'
  const fg = inverse ? '#07ff00' : '#000000'
  ctx.fillStyle = bg
  ctx.fillRect(x, y, w, h)

  // Code 96 (SG6 blank) and code 32 (space) both render as solid bg with no glyph.
  if (code === 96 || code === 32) return

  const glyph = getCharGlyph(String.fromCharCode(code))
  ctx.fillStyle = fg
  for (let row = 0; row < FONT_HEIGHT; row++) {
    const bits = glyph[row]
    if (bits === 0) continue
    for (let col = 0; col < FONT_WIDTH; col++) {
      if (bits & (0x80 >> col)) {
        ctx.fillRect(x + col * scale, y + row * scale, scale, scale)
      }
    }
  }
}


function drawSemigraphic(ctx, code, x, y, scale) {
  const decoded = decodeSemigraphic(code)
  if (!decoded) return
  const w = FONT_WIDTH * scale
  const h = FONT_HEIGHT * scale
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = decoded.color
  const halfW = (FONT_WIDTH / 2) * scale
  const halfH = (FONT_HEIGHT / 2) * scale
  if (decoded.quadrants.tl) ctx.fillRect(x,         y,         halfW, halfH)
  if (decoded.quadrants.tr) ctx.fillRect(x + halfW, y,         halfW, halfH)
  if (decoded.quadrants.bl) ctx.fillRect(x,         y + halfH, halfW, halfH)
  if (decoded.quadrants.br) ctx.fillRect(x + halfW, y + halfH, halfW, halfH)
}
