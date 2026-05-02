import { test, assertEquals, assertDeepEquals } from './harness.js'
import { parsePlayString } from '../src/audio.js'

test('empty string yields no events', () => {
  assertDeepEquals(parsePlayString(''), [])
})

test('whitespace is ignored', () => {
  assertEquals(parsePlayString('   ').length, 0)
})

test('single note C uses default octave 2 length 4', () => {
  const events = parsePlayString('C')
  assertEquals(events.length, 1)
  assertEquals(events[0].type, 'note')
  assertEquals(events[0].name, 'C')
  assertEquals(events[0].octave, 2)
  assertEquals(events[0].length, 4)
})

test('tempo, octave, default length, volume tokens are state changes', () => {
  const events = parsePlayString('T120 O3 L8 V20 C')
  assertEquals(events.length, 5)
  assertDeepEquals(events[0], { type: 'tempo', value: 120 })
  assertDeepEquals(events[1], { type: 'octave', value: 3 })
  assertDeepEquals(events[2], { type: 'length', value: 8 })
  assertDeepEquals(events[3], { type: 'volume', value: 20 })
  assertEquals(events[4].type, 'note')
  assertEquals(events[4].octave, 3)
  assertEquals(events[4].length, 8)
})

test('relative volume V> increments and V< decrements', () => {
  const events = parsePlayString('V10 V> V> V<')
  assertDeepEquals(
    events,
    [
      { type: 'volume', value: 10 },
      { type: 'volume', value: 11 },
      { type: 'volume', value: 12 },
      { type: 'volume', value: 11 },
    ],
  )
})

test('sharp # and + and flat - on notes', () => {
  const events = parsePlayString('C# D+ E-')
  assertEquals(events[0].accidental, 1)
  assertEquals(events[1].accidental, 1)
  assertEquals(events[2].accidental, -1)
})

test('per-note length overrides default', () => {
  const events = parsePlayString('L4 C8 D')
  assertEquals(events[0].value, 4)
  assertEquals(events[1].length, 8)
  assertEquals(events[2].length, 4)
})

test('dotted note multiplies duration by 1.5', () => {
  const events = parsePlayString('L4 C.')
  assertEquals(events[1].dotMultiplier, 1.5)
})

test('triple-dotted note (L4...) multiplies by 1.875', () => {
  const events = parsePlayString('C4...')
  assertEquals(events[0].dotMultiplier, 1.875)
})

test('pause/rest with length', () => {
  const events = parsePlayString('P8')
  assertEquals(events.length, 1)
  assertEquals(events[0].type, 'rest')
  assertEquals(events[0].length, 8)
  assertEquals(events[0].dotMultiplier, 1)
})

test('N notation: N5 means semitone offset 5 within current octave', () => {
  const events = parsePlayString('O3 N5')
  assertEquals(events[1].type, 'noteNumber')
  assertEquals(events[1].number, 5)
  assertEquals(events[1].octave, 3)
})

test('lowercase tokens are accepted', () => {
  const events = parsePlayString('t120 o3 c')
  assertEquals(events.length, 3)
  assertEquals(events[2].name, 'C')
})

test('Bublitchki opening parses without error and produces notes/rests', () => {
  const s = "T4 O3 V25 L8 D G A L4 B L8 A G P8 O4 D C# C O3 L4 B L8 A G"
  const events = parsePlayString(s)
  const notes = events.filter(e => e.type === 'note').length
  assertEquals(notes > 10, true, 'expected >10 notes parsed')
})
