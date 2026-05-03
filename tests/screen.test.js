import { test, assertEquals } from './harness.js'
import { createScreen } from '../src/screen.js'

const BASE = 1024
const COLS = 32
const VRAM_SIZE = 512

// createScreen wants a real-ish canvas. Tests don't render, so any 2D API call
// is a no-op and any property assignment (e.g. fillStyle) is silently absorbed.
function makeStubCanvas() {
  const ctxStub = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return () => {}
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
  return {
    width: 256,
    height: 192,
    getContext() { return ctxStub },
  }
}

function fresh() {
  return createScreen(makeStubCanvas())
}

// ---- peek / poke ----

test('peek returns 0 for addresses below BASE', () => {
  const s = fresh()
  assertEquals(s.peek(0), 0)
  assertEquals(s.peek(1023), 0)
  assertEquals(s.peek(-1), 0)
})

test('peek returns 0 for addresses at or above BASE + VRAM_SIZE', () => {
  const s = fresh()
  assertEquals(s.peek(BASE + VRAM_SIZE), 0)       // 1536
  assertEquals(s.peek(BASE + VRAM_SIZE + 100), 0) // 1636
})

test('poke + peek round-trips a byte at the bounds of VRAM', () => {
  const s = fresh()
  s.poke(BASE, 175)
  s.poke(BASE + VRAM_SIZE - 1, 96)
  assertEquals(s.peek(BASE), 175)
  assertEquals(s.peek(BASE + VRAM_SIZE - 1), 96)
})

test('poke masks code to 8 bits', () => {
  const s = fresh()
  s.poke(BASE + 100, 0x1ff)  // bit 8 set; should be stripped
  assertEquals(s.peek(BASE + 100), 0xff)
})

test('poke is a no-op for out-of-range addresses', () => {
  const s = fresh()
  // Below and above; nothing should land in the visible address range.
  s.poke(BASE - 1, 200)
  s.poke(BASE + VRAM_SIZE, 200)
  s.poke(BASE + VRAM_SIZE + 50, 200)
  for (let i = 0; i < VRAM_SIZE; i++) {
    assertEquals(s.peek(BASE + i), 0, `cell ${i} should still be 0`)
  }
})

// ---- cls ----

test('cls(0) fills VRAM with 96 — the collision sentinel', () => {
  const s = fresh()
  // Pre-poke a few cells to non-default so we can prove cls overwrote them.
  s.poke(BASE + 0, 175)
  s.poke(BASE + 100, 244)
  s.poke(BASE + 511, 33)
  s.cls(0)
  for (let i = 0; i < VRAM_SIZE; i++) {
    assertEquals(s.peek(BASE + i), 96, `cell ${i}`)
  }
})

test('cls(1) fills with 143 — color 0 all-quadrants (green)', () => {
  const s = fresh()
  s.cls(1)
  assertEquals(s.peek(BASE), 143)
  assertEquals(s.peek(BASE + VRAM_SIZE - 1), 143)
})

test('cls(2) fills with 159 — color 1 all-quadrants (yellow)', () => {
  const s = fresh()
  s.cls(2)
  assertEquals(s.peek(BASE + 256), 159)
})

test('cls(8) fills with 255 — color 7 all-quadrants (orange)', () => {
  const s = fresh()
  s.cls(8)
  assertEquals(s.peek(BASE), 255)
})

test('cls(9) wraps via & 0x7 back to color 0 (143)', () => {
  // Preserves the historical "out-of-range CLS arg silently wraps" CoCo behavior.
  const s = fresh()
  s.cls(9)
  assertEquals(s.peek(BASE), 143)
})

test('cls() with no arg defaults to 0 → 96', () => {
  const s = fresh()
  s.cls()
  assertEquals(s.peek(BASE), 96)
})

// ---- scrollUp ----

test('scrollUp shifts every row up by one and fills the last row with 96', () => {
  const s = fresh()
  // Tag the first cell of every row with a unique value so we can track movement.
  for (let row = 0; row < 16; row++) s.poke(BASE + row * COLS, 200 + row)
  s.scrollUp()
  // Row r's tag should now be at row r-1 (rows 1..15 → rows 0..14). Row 15 is filled with 96.
  for (let row = 0; row < 15; row++) {
    assertEquals(s.peek(BASE + row * COLS), 200 + row + 1, `row ${row} first-cell tag`)
  }
  // Last row entirely filled with 96.
  for (let col = 0; col < COLS; col++) {
    assertEquals(s.peek(BASE + 15 * COLS + col), 96, `last-row col ${col}`)
  }
})

test('scrollUp preserves byte values exactly (no transformation)', () => {
  const s = fresh()
  // Mix of semigraphic, alphanumeric, and the 96 sentinel.
  s.poke(BASE + COLS + 0, 175)   // row 1, col 0
  s.poke(BASE + COLS + 5, 33)    // row 1, col 5 (ASCII '!')
  s.poke(BASE + COLS + 31, 244)  // row 1, col 31
  s.scrollUp()
  // After scroll, those bytes are at row 0.
  assertEquals(s.peek(BASE + 0), 175)
  assertEquals(s.peek(BASE + 5), 33)
  assertEquals(s.peek(BASE + 31), 244)
})

// ---- printAt ----

test('printAt translates lowercase letters to their uppercase code', () => {
  const s = fresh()
  s.printAt(0, 'abc')
  assertEquals(s.peek(BASE + 0), 65)  // 'A'
  assertEquals(s.peek(BASE + 1), 66)  // 'B'
  assertEquals(s.peek(BASE + 2), 67)  // 'C'
})

test('printAt leaves uppercase letters and digits unchanged', () => {
  const s = fresh()
  s.printAt(0, 'XY7')
  assertEquals(s.peek(BASE + 0), 88)  // 'X'
  assertEquals(s.peek(BASE + 1), 89)  // 'Y'
  assertEquals(s.peek(BASE + 2), 55)  // '7'
})

test('printAt leaves punctuation unchanged', () => {
  const s = fresh()
  s.printAt(0, '!?:')
  assertEquals(s.peek(BASE + 0), 33)  // '!'
  assertEquals(s.peek(BASE + 1), 63)  // '?'
  assertEquals(s.peek(BASE + 2), 58)  // ':'
})

test('printAt clips at end of VRAM rather than writing out of bounds', () => {
  const s = fresh()
  s.printAt(VRAM_SIZE - 2, 'ABCD')
  // Only the first two chars land in VRAM; the rest are dropped silently.
  assertEquals(s.peek(BASE + VRAM_SIZE - 2), 65)  // 'A'
  assertEquals(s.peek(BASE + VRAM_SIZE - 1), 66)  // 'B'
  // Peeking beyond the end is 0.
  assertEquals(s.peek(BASE + VRAM_SIZE), 0)
  assertEquals(s.peek(BASE + VRAM_SIZE + 1), 0)
})

test('printAt does not crash on negative offset and clips low end', () => {
  const s = fresh()
  s.printAt(-2, 'ABCD')
  // Offsets -2 and -1 are dropped; 'C' lands at offset 0, 'D' at offset 1.
  assertEquals(s.peek(BASE + 0), 67)  // 'C'
  assertEquals(s.peek(BASE + 1), 68)  // 'D'
})

// ---- setScale ----

test('setScale clamps below 1 and floors fractional input', () => {
  const s = fresh()
  s.setScale(0)
  assertEquals(s.scale, 1)
  s.setScale(-5)
  assertEquals(s.scale, 1)
  s.setScale(2.7)
  assertEquals(s.scale, 2)
})
