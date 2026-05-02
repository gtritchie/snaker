import { test, assertEquals, assertDeepEquals } from './harness.js'
import { decodeSemigraphic, SEMI_COLORS } from '../src/glyphs.js'

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
