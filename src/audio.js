// Parse a CoCo PLAY string into an array of events. Pure function — no Web Audio.
//
// Supported tokens (case-insensitive, whitespace ignored):
//   Tnnn         tempo (1-255)
//   Onnn         octave (1-5)
//   Vnnn         volume (1-31)
//   V>           increment volume
//   V<           decrement volume
//   Lnnn         default note length (1, 2, 4, 8, 16, 32)
//   A-G          note in current octave; optional # or + (sharp), - (flat);
//                optional inline length digits; trailing dots extend duration
//   Pnnn         rest with length
//   Nnnn         note by chromatic number 1-12 within current octave
//
// Returns events in stream order. Synthesis interprets the running state
// (tempo, octave, length, volume) implicitly from the order of events.
export function parsePlayString(input) {
  const events = []
  const s = input
  let i = 0
  let lastVolume = 15

  function eof() { return i >= s.length }

  function skipWhitespace() {
    while (!eof() && /\s/.test(s[i])) i++
  }

  function readNumber() {
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
      if (v !== null) events.push({ type: 'octave', value: v })
    } else if (c === 'L') {
      const v = readNumber()
      if (v !== null) events.push({ type: 'length', value: v })
    } else if (c === 'V') {
      skipWhitespace()
      if (s[i] === '>') { i++; lastVolume++; events.push({ type: 'volume', value: lastVolume }) }
      else if (s[i] === '<') { i++; lastVolume--; events.push({ type: 'volume', value: lastVolume }) }
      else {
        const v = readNumber()
        if (v !== null) { lastVolume = v; events.push({ type: 'volume', value: v }) }
      }
    } else if (c === 'P') {
      const len = readNumber()
      const dots = readDots()
      events.push({ type: 'rest', length: len, dotMultiplier: dotMultiplier(dots) })
    } else if (c === 'N') {
      const num = readNumber()
      events.push({ type: 'noteNumber', number: num, octave: null })
    } else if (c >= 'A' && c <= 'G') {
      let accidental = 0
      if (s[i] === '#' || s[i] === '+') { accidental = 1; i++ }
      else if (s[i] === '-') { accidental = -1; i++ }
      const len = readNumber()
      const dots = readDots()
      events.push({
        type: 'note', name: c, accidental,
        length: len, dotMultiplier: dotMultiplier(dots),
        octave: null,
      })
    }
  }

  // Second pass: fill in running octave / length on notes from preceding state events.
  let octave = 2, length = 4
  for (const e of events) {
    if (e.type === 'octave') octave = e.value
    else if (e.type === 'length') length = e.value
    else if (e.type === 'note') {
      if (e.octave === null) e.octave = octave
      if (e.length === null || e.length === undefined) e.length = length
    } else if (e.type === 'rest') {
      if (e.length === null || e.length === undefined) e.length = length
    } else if (e.type === 'noteNumber') {
      if (e.octave === null) e.octave = octave
    }
  }

  return events
}
