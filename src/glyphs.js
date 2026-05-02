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
