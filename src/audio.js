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

// Frequency table: equal-tempered, A4 = 440 Hz. Note names mapped to semitone offsets
// from C of the same octave.
const NOTE_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteFrequency(name, accidental, octave) {
  // CoCo PLAY octave 4 corresponds approximately to MIDI octave 4 (C4 = 261.63 Hz).
  const midi = (octave + 1) * 12 + NOTE_SEMITONE[name] + accidental
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function noteNumberFrequency(num, octave) {
  // CoCo N1..N12 maps to a chromatic scale starting at C of `octave`.
  const midi = (octave + 1) * 12 + (num - 1)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// Tempo conversion: how long is one whole note (length=1) at tempo T?
// Calibration constant; tuned by ear in Task 16.
const WHOLE_NOTE_SEC_AT_T_1 = 240

function eventDurationSec(eventLength, dotMultiplier, tempo) {
  const wholeSec = WHOLE_NOTE_SEC_AT_T_1 / tempo
  return (wholeSec / eventLength) * dotMultiplier
}

// Convert CoCo volume (1-31) to a linear gain. 0.25 ceiling keeps mixing comfortable.
function volumeToGain(v) {
  return Math.max(0, Math.min(31, v)) / 31 * 0.25
}

export function createAudio() {
  let ac = null
  let masterGain = null
  let queueTime = 0
  let runningVolume = 15  // carries across play() calls so V>/V< can resolve relatively
  const activeNodes = new Set()

  function ensureContext() {
    if (ac) return ac
    ac = new (window.AudioContext || window.webkitAudioContext)()
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

  // Cancel everything currently scheduled and reset queueTime to "now". Used when
  // transitioning past the title screen so setup beeps don't queue behind the melody.
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
    let tempo = 60

    const start = queueTime
    for (const e of events) {
      if (e.type === 'tempo') tempo = e.value
      else if (e.type === 'volume') {
        if (typeof e.relative === 'number') runningVolume += e.relative
        else runningVolume = e.value
      }
      else if (e.type === 'octave' || e.type === 'length') { /* baked into note events */ }
      else if (e.type === 'rest') {
        queueTime += eventDurationSec(e.length, e.dotMultiplier, tempo)
      } else if (e.type === 'note') {
        const dur = eventDurationSec(e.length, e.dotMultiplier, tempo)
        scheduleTone(noteFrequency(e.name, e.accidental, e.octave), dur, volumeToGain(runningVolume))
        queueTime += dur
      } else if (e.type === 'noteNumber') {
        const dur = eventDurationSec(4, 1, tempo)   // N notes use default length 4
        scheduleTone(noteNumberFrequency(e.number, e.octave), dur, volumeToGain(runningVolume))
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
