import { test, assertEquals } from './harness.js'
import { formatScore } from '../src/game.js'

// Mirrors the original BASIC formatting from snaker.bas lines 520-540:
//   SC = HT/60                     ' ticks → seconds (60 Hz timer)
//   M$ = LEFT$(STR$(INT(SC/60)),3) ' minutes string (STR$ has leading space)
//   IF VAL(M$) < 1 THEN M$ = "00"
//   IF LEN(M$) > 2 THEN M$ = RIGHT$(M$,2)
//   S$ = LEFT$(STR$(INT(SC - INT(SC/60)*60)),3)
//   IF LEN(S$) < 3 THEN S$ = "0"+RIGHT$(S$,1) ELSE S$ = RIGHT$(S$,2)
//   P$ = M$ + ":" + S$
//
// Quirks preserved:
//   - Single-digit minutes carry the leading space from BASIC's STR$ (" 1:00" for 60s)
//   - 100+ minutes truncate to the first two significant digits (100 → "10", 125 → "12")

test('formatScore: 0 ticks → 00:00', () => {
  assertEquals(formatScore(0), '00:00')
})

test('formatScore: 60 ticks (1 sec) → 00:01', () => {
  assertEquals(formatScore(60), '00:01')
})

test('formatScore: 60*59 ticks (59 sec) → 00:59', () => {
  assertEquals(formatScore(60 * 59), '00:59')
})

test('formatScore: 60*60 ticks (1 min) → " 1:00" with leading space (BASIC STR$)', () => {
  assertEquals(formatScore(60 * 60), ' 1:00')
})

test('formatScore: 60*125 ticks (2:05) → " 2:05" with leading space', () => {
  assertEquals(formatScore(60 * 125), ' 2:05')
})

test('formatScore: 60*600 ticks (10 min) → 10:00', () => {
  assertEquals(formatScore(60 * 600), '10:00')
})

test('formatScore: 60*3599 ticks (59:59) → 59:59', () => {
  assertEquals(formatScore(60 * 3599), '59:59')
})

test('formatScore: 60*6000 ticks (100 min) → 10:00 per BASIC truncation', () => {
  // BASIC: STR$(100) = " 100", LEFT$(" 100", 3) = " 10", RIGHT$(" 10", 2) = "10"
  assertEquals(formatScore(60 * 6000), '10:00')
})

test('formatScore: 60*7500 ticks (125 min) → 12:00 per BASIC truncation', () => {
  // BASIC: STR$(125) = " 125", LEFT$(" 125", 3) = " 12", RIGHT$(" 12", 2) = "12"
  assertEquals(formatScore(60 * 7500), '12:00')
})
