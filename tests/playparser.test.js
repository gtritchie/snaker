import { test, assertEquals, assertDeepEquals } from './harness.js'
import { parsePlayString, dotMultiplier } from '../src/audio.js'

test('empty string yields no events', () => {
  assertDeepEquals(parsePlayString(''), [])
})

test('whitespace is ignored', () => {
  assertEquals(parsePlayString('   ').length, 0)
})

test('bare note has null octave/length/dots so synth fills from running state', () => {
  const events = parsePlayString('C')
  assertEquals(events.length, 1)
  assertEquals(events[0].type, 'note')
  assertEquals(events[0].name, 'C')
  assertEquals(events[0].octave, null)
  assertEquals(events[0].length, null)
  assertEquals(events[0].dots, 0)
})

test('tempo, octave, default length, volume tokens are state events', () => {
  const events = parsePlayString('T120 O3 L8 V20 C')
  assertEquals(events.length, 5)
  assertDeepEquals(events[0], { type: 'tempo', value: 120 })
  assertDeepEquals(events[1], { type: 'octave', value: 3 })
  assertDeepEquals(events[2], { type: 'length', value: 8, dots: 0 })
  assertDeepEquals(events[3], { type: 'volume', value: 20 })
  // Note after O3 L8 carries the in-string snapshot; synth uses these to fill defaults.
  assertEquals(events[4].type, 'note')
  assertEquals(events[4].octave, 3)
  assertEquals(events[4].defaultLength, 8)
  assertEquals(events[4].defaultDots, 0)
})

test('relative volume V> and V< emit relative events (resolved by synth)', () => {
  const events = parsePlayString('V10 V> V> V<')
  assertDeepEquals(events, [
    { type: 'volume', value: 10 },
    { type: 'volume', relative: 1 },
    { type: 'volume', relative: 1 },
    { type: 'volume', relative: -1 },
  ])
})

test('sharp # and + and flat - on notes', () => {
  const events = parsePlayString('C# D+ E-')
  assertEquals(events[0].accidental, 1)
  assertEquals(events[1].accidental, 1)
  assertEquals(events[2].accidental, -1)
})

test('per-note own length is preserved on event', () => {
  const events = parsePlayString('L4 C8 D')
  assertEquals(events[0].value, 4)               // length state event
  assertEquals(events[1].length, 8)               // C with own length
  assertEquals(events[2].length, null)            // D inherits via defaultLength
  assertEquals(events[2].defaultLength, 4)
})

test('dotted note records own dots on event', () => {
  const events = parsePlayString('L4 C.')
  assertEquals(events[1].dots, 1)
  assertEquals(events[1].length, null)
  assertEquals(events[1].defaultLength, 4)
})

test('triple-dotted note records dots=3', () => {
  const events = parsePlayString('C4...')
  assertEquals(events[0].length, 4)
  assertEquals(events[0].dots, 3)
})

test('L4... emits length event with dots=3 carried as in-string default', () => {
  const events = parsePlayString('L4... B')
  assertEquals(events.length, 2)
  assertDeepEquals(events[0], { type: 'length', value: 4, dots: 3 })
  // B has no own length/dots — synth will use defaultLength/defaultDots from event.
  assertEquals(events[1].type, 'note')
  assertEquals(events[1].length, null)
  assertEquals(events[1].dots, 0)
  assertEquals(events[1].defaultLength, 4)
  assertEquals(events[1].defaultDots, 3)
})

test('pause/rest with length records own length', () => {
  const events = parsePlayString('P8')
  assertEquals(events.length, 1)
  assertEquals(events[0].type, 'rest')
  assertEquals(events[0].length, 8)
  assertEquals(events[0].dots, 0)
})

test('N notation: number 5 in current octave', () => {
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

test('whitespace between token letter and number is skipped (BASIC STR$ leading space)', () => {
  // The score-screen runtime string PLAY "T255 O"+STR$(O)+"N"+STR$(N) resolves to
  // "T255 O 1N 5" because STR$ prepends a space for non-negative integers.
  const events = parsePlayString('T255 O 1N 5')
  assertEquals(events.length, 3)
  assertDeepEquals(events[0], { type: 'tempo', value: 255 })
  assertDeepEquals(events[1], { type: 'octave', value: 1 })
  assertEquals(events[2].type, 'noteNumber')
  assertEquals(events[2].number, 5)
  assertEquals(events[2].octave, 1)
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
