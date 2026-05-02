import { test, assertEquals, assertDeepEquals } from './harness.js'
import { decodeSemigraphic, SEMI_COLORS, getCharGlyph, FONT_HEIGHT, FONT_WIDTH } from '../src/glyphs.js'

// CoCo Semigraphics-4 encoding: byte = code - 128 (7 bits)
//   bits 6-4: color index (0-7)
//   bit 3:    top-left
//   bit 2:    top-right
//   bit 1:    bottom-left
//   bit 0:    bottom-right

test('decodeSemigraphic(128): color 0, no quadrants', () => {
  assertDeepEquals(decodeSemigraphic(128), {
    color: SEMI_COLORS[0],
    quadrants: { tl: false, tr: false, bl: false, br: false },
  })
})

test('decodeSemigraphic(143): color 0, all quadrants', () => {
  assertDeepEquals(decodeSemigraphic(143), {
    color: SEMI_COLORS[0],
    quadrants: { tl: true, tr: true, bl: true, br: true },
  })
})

test('decodeSemigraphic(175): color 2, all quadrants (orange wall block)', () => {
  const r = decodeSemigraphic(175)
  assertEquals(r.color, SEMI_COLORS[2])
  assertDeepEquals(r.quadrants, { tl: true, tr: true, bl: true, br: true })
})

test('decodeSemigraphic(148): color 1, top-right only (snake first segment)', () => {
  const r = decodeSemigraphic(148)
  assertEquals(r.color, SEMI_COLORS[1])
  assertDeepEquals(r.quadrants, { tl: false, tr: true, bl: false, br: false })
})

test('decodeSemigraphic(159): color 1, all quadrants (yellow obstacle)', () => {
  const r = decodeSemigraphic(159)
  assertEquals(r.color, SEMI_COLORS[1])
  assertDeepEquals(r.quadrants, { tl: true, tr: true, bl: true, br: true })
})

test('decodeSemigraphic(255): color 7, all quadrants (orange obstacle)', () => {
  const r = decodeSemigraphic(255)
  assertEquals(r.color, SEMI_COLORS[7])
  assertDeepEquals(r.quadrants, { tl: true, tr: true, bl: true, br: true })
})

test('decodeSemigraphic returns null for codes outside 128-255', () => {
  assertEquals(decodeSemigraphic(0), null)
  assertEquals(decodeSemigraphic(96), null)
  assertEquals(decodeSemigraphic(127), null)
  assertEquals(decodeSemigraphic(256), null)
})

test('SEMI_COLORS has 8 entries', () => {
  assertEquals(SEMI_COLORS.length, 8)
})

test('FONT_WIDTH is 8 and FONT_HEIGHT is 12', () => {
  assertEquals(FONT_WIDTH, 8)
  assertEquals(FONT_HEIGHT, 12)
})

test('getCharGlyph returns 12-byte Uint8Array for known char', () => {
  const g = getCharGlyph('A')
  assertEquals(g.length, 12)
  assertEquals(g instanceof Uint8Array, true)
})

test('getCharGlyph returns all-zero bytes for space', () => {
  const g = getCharGlyph(' ')
  for (let i = 0; i < g.length; i++) assertEquals(g[i], 0, `row ${i}`)
})

test('getCharGlyph for unknown char returns all-zero (treated as space)', () => {
  const g = getCharGlyph('~')
  for (let i = 0; i < g.length; i++) assertEquals(g[i], 0)
})

test('getCharGlyph for lowercase letter returns same bytes as uppercase', () => {
  // CoCo has no lowercase glyphs; we reuse uppercase. Inversion is a separate flag.
  assertDeepEquals(Array.from(getCharGlyph('a')), Array.from(getCharGlyph('A')))
})
