// Parse a CoCo PLAY string into an array of events. Pure function — no Web Audio.
//
// Supported tokens (case-insensitive, whitespace ignored):
//   Tnnn         tempo (1-255)
//   Onnn         octave (1-5)
//   Vnnn         volume (1-31), absolute
//   V>           increment volume (relative; resolved by the synth against running state)
//   V<           decrement volume (relative)
//   Lnnn[.+]     default note length (1, 2, 4, 8, 16, 32) with optional trailing dots
//   A-G          note in current octave; optional # or + (sharp), - (flat);
//                optional inline length digits; trailing dots extend duration
//   Pnnn[.+]     rest with optional length and dots
//   Nnnn         note by chromatic number 1-12 within current octave
//
// CoCo runtime quirks accommodated:
//   - BASIC's STR$(N) prepends a space for non-negative integers, so PLAY strings
//     built like "T255 O"+STR$(O)+"N"+STR$(N) resolve to "T255 O 1N 5". Whitespace
//     between a token letter and its numeric argument is therefore skipped.
//   - "L4..." carries the dot multiplier into the running default-length state so
//     notes that follow without their own length/dots inherit the dotted default.
//   - V> and V< emit relative-volume events; the synth tracks running volume across
//     PLAY calls, matching the original PLAY's stateful behavior.
export function parsePlayString(input) {
  const events = []
  const s = input
  let i = 0
  let octave = 2
  let length = 4
  let lengthDots = 0

  function eof() { return i >= s.length }
  function skipWhitespace() { while (!eof() && /\s/.test(s[i])) i++ }

  function readNumber() {
    skipWhitespace()
    let n = ''
    while (!eof() && /[0-9]/.test(s[i])) n += s[i++]
    return n.length ? parseInt(n, 10) : null
  }

  function readDots() {
    let dots = 0
    while (!eof() && s[i] === '.') { dots++; i++ }
    return dots
  }

  function dotMultiplier(dots) {
    let m = 1, add = 0.5
    for (let d = 0; d < dots; d++) { m += add; add /= 2 }
    return m
  }

  while (!eof()) {
    skipWhitespace()
    if (eof()) break

    const c = s[i].toUpperCase()
    i++

    if (c === 'T') {
      const v = readNumber()
      if (v !== null) events.push({ type: 'tempo', value: v })
    } else if (c === 'O') {
      const v = readNumber()
      if (v !== null) { octave = v; events.push({ type: 'octave', value: v }) }
    } else if (c === 'L') {
      const v = readNumber()
      if (v !== null) {
        length = v
        lengthDots = readDots()
        events.push({ type: 'length', value: v, dots: lengthDots })
      }
    } else if (c === 'V') {
      skipWhitespace()
      if (s[i] === '>') { i++; events.push({ type: 'volume', relative: 1 }) }
      else if (s[i] === '<') { i++; events.push({ type: 'volume', relative: -1 }) }
      else {
        const v = readNumber()
        if (v !== null) events.push({ type: 'volume', value: v })
      }
    } else if (c === 'P') {
      const ownLen = readNumber()
      const ownDots = readDots()
      const useLength = ownLen ?? length
      const useDots = (ownLen !== null || ownDots > 0) ? ownDots : lengthDots
      events.push({ type: 'rest', length: useLength, dotMultiplier: dotMultiplier(useDots) })
    } else if (c === 'N') {
      const num = readNumber()
      events.push({ type: 'noteNumber', number: num, octave })
    } else if (c >= 'A' && c <= 'G') {
      let accidental = 0
      if (s[i] === '#' || s[i] === '+') { accidental = 1; i++ }
      else if (s[i] === '-') { accidental = -1; i++ }
      const ownLen = readNumber()
      const ownDots = readDots()
      const useLength = ownLen ?? length
      const useDots = (ownLen !== null || ownDots > 0) ? ownDots : lengthDots
      events.push({
        type: 'note', name: c, accidental,
        length: useLength, dotMultiplier: dotMultiplier(useDots),
        octave,
      })
    }
  }

  return events
}
