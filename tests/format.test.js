import { test, assertEquals } from './harness.js'
import { formatScore } from '../src/game.js'

// Mirrors the original BASIC formatting from snaker.bas lines 520-540:
//   SC = HT/60                     ' ticks → seconds (60 Hz timer)
//   M$ = LEFT$(STR$(INT(SC/60)),3) ' minutes string
//   IF VAL(M$) < 1 THEN M$ = "00"
//   IF LEN(M$) > 2 THEN M$ = RIGHT$(M$,2)
//   S$ = LEFT$(STR$(INT(SC - INT(SC/60)*60)),3)
//   IF LEN(S$) < 3 THEN S$ = "0"+RIGHT$(S$,1) ELSE S$ = RIGHT$(S$,2)
//   P$ = M$ + ":" + S$

test('formatScore: 0 ticks → 00:00', () => {
  assertEquals(formatScore(0), '00:00')
})

test('formatScore: 60 ticks (1 sec) → 00:01', () => {
  assertEquals(formatScore(60), '00:01')
})

test('formatScore: 60*59 ticks (59 sec) → 00:59', () => {
  assertEquals(formatScore(60 * 59), '00:59')
})

test('formatScore: 60*60 ticks (60 sec) → 01:00', () => {
  assertEquals(formatScore(60 * 60), '01:00')
})

test('formatScore: 60*125 ticks (2:05) → 02:05', () => {
  assertEquals(formatScore(60 * 125), '02:05')
})

test('formatScore: 60*600 ticks (10:00) → 10:00', () => {
  assertEquals(formatScore(60 * 600), '10:00')
})

test('formatScore: 60*3599 ticks (59:59) → 59:59', () => {
  assertEquals(formatScore(60 * 3599), '59:59')
})
