// Parse a CoCo PLAY string into an array of events. Pure function — no Web Audio.
//
// Supported tokens (case-insensitive, whitespace ignored):
//   Tnnn         tempo (1-255)
//   Onnn         octave (1-5)
//   Vnnn         volume (1-31), absolute
//   V>           increment volume (relative; resolved by synth running state)
//   V<           decrement volume (relative)
//   Lnnn[.+]     default note length (1, 2, 4, 8, 16, 32) with optional trailing dots
//   A-G          note in current octave; optional # or + (sharp), - (flat);
//                optional inline length digits; trailing dots extend duration
//   Pnnn[.+]     rest with optional length and dots
//   Nnnn         note by chromatic number 1-12 within current octave
//
// CoCo runtime quirks:
//   - BASIC's STR$(N) prepends a space for non-negative integers, so PLAY strings
//     built like "T255 O"+STR$(O)+"N"+STR$(N) resolve to "T255 O 1N 5". Whitespace
//     between a token letter and its numeric argument is therefore skipped.
//   - L4... carries the dot count into a length event; the synth applies it as the
//     default dot multiplier for following notes that lack their own length/dots.
//
// Cross-call running state (tempo, octave, default length+dots, volume) is the
// SYNTH's responsibility, not the parser's. The parser emits null on note fields
// that were not explicitly set within this string; the synth resolves them
// against state carried over from previous play() calls.
export function parsePlayString(input) {
  const events = []
  const s = input
  let i = 0

  // Parser-internal "running within this string" state for octave/length/dots.
  // null means "not yet set in this string" — the synth will fall back to its
  // own cross-call running state at note resolution time.
  let inStringOctave = null
  let inStringLength = null
  let inStringLengthDots = null

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
      if (v !== null) {
        inStringOctave = v
        events.push({ type: 'octave', value: v })
      }
    } else if (c === 'L') {
      const v = readNumber()
      if (v !== null) {
        const dots = readDots()
        inStringLength = v
        inStringLengthDots = dots
        events.push({ type: 'length', value: v, dots })
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
      events.push({
        type: 'rest',
        length: ownLen,                  // null if not specified
        dots: ownDots,                   // 0 if not specified
        defaultLength: inStringLength,   // snapshot of in-string default at this point
        defaultDots: inStringLengthDots,
      })
    } else if (c === 'N') {
      const num = readNumber()
      events.push({ type: 'noteNumber', number: num, octave: inStringOctave })
    } else if (c >= 'A' && c <= 'G') {
      let accidental = 0
      if (s[i] === '#' || s[i] === '+') { accidental = 1; i++ }
      else if (s[i] === '-') { accidental = -1; i++ }
      const ownLen = readNumber()
      const ownDots = readDots()
      events.push({
        type: 'note', name: c, accidental,
        length: ownLen,
        dots: ownDots,
        octave: inStringOctave,
        defaultLength: inStringLength,
        defaultDots: inStringLengthDots,
      })
    }
  }

  return events
}

// Compute the dotted-duration multiplier from a dot count. 0 dots → 1.0, 1 → 1.5,
// 2 → 1.75, 3 → 1.875, etc.
export function dotMultiplier(dots) {
  let m = 1, add = 0.5
  for (let d = 0; d < dots; d++) { m += add; add /= 2 }
  return m
}

// Frequency table: equal-tempered, A4 = 440 Hz.
const NOTE_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteFrequency(name, accidental, octave) {
  const midi = (octave + 1) * 12 + NOTE_SEMITONE[name] + accidental
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function noteNumberFrequency(num, octave) {
  const midi = (octave + 1) * 12 + (num - 1)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// Calibration constant: how long is one whole note (length=1) at tempo T=1?
// Tuned by ear in Task 16.
const WHOLE_NOTE_SEC_AT_T_1 = 240

function eventDurationSec(eventLength, dotMul, tempo) {
  const wholeSec = WHOLE_NOTE_SEC_AT_T_1 / tempo
  return (wholeSec / eventLength) * dotMul
}

function volumeToGain(v) {
  return Math.max(0, Math.min(31, v)) / 31 * 0.25
}

// Resolve a note/rest event's effective length and dots against the synth's running
// defaults. Per-event own length OR own dots disables default-dot inheritance.
function resolveLengthAndDots(event, runningLength, runningDots) {
  const useLength = event.length ?? event.defaultLength ?? runningLength
  const ownSpecified = event.length !== null || event.dots > 0
  const useDots = ownSpecified ? event.dots : (event.defaultDots ?? runningDots)
  return { useLength, useDots }
}

export function createAudio() {
  let ac = null
  let masterGain = null
  let queueTime = 0

  // Cross-PLAY-call running state. Mirrors CoCo PLAY's stateful behavior.
  let runningTempo = 60
  let runningOctave = 2
  let runningLength = 4
  let runningLengthDots = 0
  let runningVolume = 15

  const activeNodes = new Set()

  function ensureContext() {
    if (ac) return ac
    ac = new AudioContext()
    masterGain = ac.createGain()
    masterGain.gain.value = 1.0
    masterGain.connect(ac.destination)
    queueTime = ac.currentTime
    return ac
  }

  function resume() {
    ensureContext()
    if (ac.state === 'suspended') return ac.resume()
    return Promise.resolve()
  }

  function suspend() {
    if (ac && ac.state === 'running') return ac.suspend()
    return Promise.resolve()
  }

  function flush() {
    if (!ac) return
    for (const osc of activeNodes) {
      try { osc.stop(0) } catch {}
    }
    activeNodes.clear()
    queueTime = ac.currentTime
  }

  function scheduleTone(freq, durationSec, gain) {
    const osc = ac.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const env = ac.createGain()
    const attack = 0.005, release = 0.005
    env.gain.setValueAtTime(0, queueTime)
    env.gain.linearRampToValueAtTime(gain, queueTime + attack)
    env.gain.setValueAtTime(gain, queueTime + Math.max(0, durationSec - release))
    env.gain.linearRampToValueAtTime(0, queueTime + durationSec)
    osc.connect(env).connect(masterGain)
    osc.start(queueTime)
    osc.stop(queueTime + durationSec + 0.01)
    activeNodes.add(osc)
    osc.onended = () => activeNodes.delete(osc)
  }

  function play(playString) {
    ensureContext()
    if (queueTime < ac.currentTime) queueTime = ac.currentTime

    const events = parsePlayString(playString)
    const start = queueTime

    for (const e of events) {
      if (e.type === 'tempo') {
        runningTempo = e.value
      } else if (e.type === 'octave') {
        runningOctave = e.value
      } else if (e.type === 'length') {
        runningLength = e.value
        runningLengthDots = e.dots
      } else if (e.type === 'volume') {
        if (typeof e.relative === 'number') runningVolume += e.relative
        else runningVolume = e.value
      } else if (e.type === 'rest') {
        const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
        queueTime += eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
      } else if (e.type === 'note') {
        const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
        const useOctave = e.octave ?? runningOctave
        const dur = eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
        scheduleTone(noteFrequency(e.name, e.accidental, useOctave), dur, volumeToGain(runningVolume))
        queueTime += dur
      } else if (e.type === 'noteNumber') {
        const useOctave = e.octave ?? runningOctave
        const dur = eventDurationSec(runningLength, dotMultiplier(runningLengthDots), runningTempo)
        scheduleTone(noteNumberFrequency(e.number, useOctave), dur, volumeToGain(runningVolume))
        queueTime += dur
      }
    }

    const totalSec = queueTime - start
    return new Promise(resolve => setTimeout(resolve, totalSec * 1000))
  }

  function stop() {
    if (!ac) return
    ac.close()
    ac = null
    masterGain = null
    queueTime = 0
    activeNodes.clear()
  }

  return { play, stop, resume, suspend, flush }
}
