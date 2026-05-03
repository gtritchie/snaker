import { test, assertEquals, assertDeepEquals } from './harness.js'
import { parsePlayString, dotMultiplier, applyStateOp } from '../src/audio.js'

test('empty string yields no events', () => {
  assertDeepEquals(parsePlayString(''), [])
})

test('whitespace is ignored', () => {
  assertEquals(parsePlayString('   ').length, 0)
})

test('bare note has null length and 0 dots; synth fills the rest from running state', () => {
  const events = parsePlayString('C')
  assertEquals(events.length, 1)
  assertDeepEquals(events[0], { type: 'note', name: 'C', accidental: 0, length: null, dots: 0 })
})

test('T/O/L/V tokens with numeric arguments emit absolute-value events', () => {
  const events = parsePlayString('T120 O3 L8 V20 C')
  assertEquals(events.length, 5)
  assertDeepEquals(events[0], { type: 'tempo', value: 120 })
  assertDeepEquals(events[1], { type: 'octave', value: 3 })
  assertDeepEquals(events[2], { type: 'length', value: 8, dots: 0 })
  assertDeepEquals(events[3], { type: 'volume', value: 20 })
  assertEquals(events[4].type, 'note')
})

test('V suffix ops emit op events (synth applies against running volume)', () => {
  const events = parsePlayString('V10 V+ V- V> V<')
  assertDeepEquals(events, [
    { type: 'volume', value: 10 },
    { type: 'volume', op: '+' },
    { type: 'volume', op: '-' },
    { type: 'volume', op: '>' },
    { type: 'volume', op: '<' },
  ])
})

test('T suffix ops emit op events', () => {
  const events = parsePlayString('T+ T- T> T<')
  assertDeepEquals(events, [
    { type: 'tempo', op: '+' },
    { type: 'tempo', op: '-' },
    { type: 'tempo', op: '>' },
    { type: 'tempo', op: '<' },
  ])
})

test('O suffix ops emit op events', () => {
  const events = parsePlayString('O+ O- O> O<')
  assertDeepEquals(events, [
    { type: 'octave', op: '+' },
    { type: 'octave', op: '-' },
    { type: 'octave', op: '>' },
    { type: 'octave', op: '<' },
  ])
})

test('L suffix ops emit op events with dots field', () => {
  const events = parsePlayString('L+ L- L> L<')
  assertDeepEquals(events, [
    { type: 'length', op: '+', dots: 0 },
    { type: 'length', op: '-', dots: 0 },
    { type: 'length', op: '>', dots: 0 },
    { type: 'length', op: '<', dots: 0 },
  ])
})

test('applyStateOp: numeric value sets absolute, op transforms current', () => {
  assertEquals(applyStateOp(15, { value: 7 }), 7)
  assertEquals(applyStateOp(7, { op: '+' }), 8)
  assertEquals(applyStateOp(7, { op: '-' }), 6)
  assertEquals(applyStateOp(7, { op: '>' }), 14)
  assertEquals(applyStateOp(14, { op: '<' }), 7)
  assertEquals(applyStateOp(15, { op: '<' }), 7)   // floor
})

test('sharp # and + and flat - on notes', () => {
  const events = parsePlayString('C# D+ E-')
  assertEquals(events[0].accidental, 1)
  assertEquals(events[1].accidental, 1)
  assertEquals(events[2].accidental, -1)
})

test('per-note own length is preserved; bare note has length=null', () => {
  const events = parsePlayString('L4 C8 D')
  assertEquals(events[0].value, 4)
  assertEquals(events[1].length, 8)
  assertEquals(events[2].length, null)
})

test('dotted note records own dots', () => {
  const events = parsePlayString('L4 C.')
  assertEquals(events[1].dots, 1)
  assertEquals(events[1].length, null)
})

test('triple-dotted note records dots=3', () => {
  const events = parsePlayString('C4...')
  assertEquals(events[0].length, 4)
  assertEquals(events[0].dots, 3)
})

test('L4... emits length event with dots=3; following bare note has null length', () => {
  const events = parsePlayString('L4... B')
  assertEquals(events.length, 2)
  assertDeepEquals(events[0], { type: 'length', value: 4, dots: 3 })
  assertDeepEquals(events[1], { type: 'note', name: 'B', accidental: 0, length: null, dots: 0 })
})

test('pause/rest with length records own length', () => {
  const events = parsePlayString('P8')
  assertEquals(events.length, 1)
  assertDeepEquals(events[0], { type: 'rest', length: 8, dots: 0 })
})

test('N notation: number stored without octave (synth uses running)', () => {
  const events = parsePlayString('O3 N5')
  assertDeepEquals(events[0], { type: 'octave', value: 3 })
  assertDeepEquals(events[1], { type: 'noteNumber', number: 5 })
})

test('lowercase tokens are accepted', () => {
  const events = parsePlayString('t120 o3 c')
  assertEquals(events.length, 3)
  assertEquals(events[2].name, 'C')
})

test('whitespace between token letter and number is skipped (BASIC STR$ leading space)', () => {
  // The score-screen runtime string PLAY "T255 O"+STR$(O)+"N"+STR$(N) resolves to
  // "T255 O 1N 5" because STR$ prepends a space for non-negative integers.
  const events = parsePlayString('T255 O 1N 5')
  assertEquals(events.length, 3)
  assertDeepEquals(events[0], { type: 'tempo', value: 255 })
  assertDeepEquals(events[1], { type: 'octave', value: 1 })
  assertDeepEquals(events[2], { type: 'noteNumber', number: 5 })
})

test('Bublitchki opening parses without error and produces notes/rests', () => {
  const s = "T4 O3 V25 L8 D G A L4 B L8 A G P8 O4 D C# C O3 L4 B L8 A G"
  const events = parsePlayString(s)
  const notes = events.filter(e => e.type === 'note').length
  assertEquals(notes > 10, true, 'expected >10 notes parsed')
})

test('dotMultiplier helper: 0,1,2,3 dots → 1, 1.5, 1.75, 1.875', () => {
  assertEquals(dotMultiplier(0), 1)
  assertEquals(dotMultiplier(1), 1.5)
  assertEquals(dotMultiplier(2), 1.75)
  assertEquals(dotMultiplier(3), 1.875)
})
