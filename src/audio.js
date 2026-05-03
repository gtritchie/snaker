// Parse a CoCo PLAY string into an array of events. Pure function — no Web Audio.
//
// Supported tokens (case-insensitive, whitespace ignored):
//   Tnnn / T+ / T- / T> / T<   tempo: set, +1, -1, ×2, /2
//   Onnn / O+ / O- / O> / O<   octave: set, +1, -1, ×2, /2
//   Vnnn / V+ / V- / V> / V<   volume: set, +1, -1, ×2, /2
//   Lnnn[.+] / L+ / L- / L> / L<   default note length (with optional trailing dots)
//   A-G   note in current octave; optional # or + (sharp), - (flat);
//         optional inline length digits; trailing dots extend duration
//   Pnnn[.+]   rest with optional length and dots
//   Nnnn       note by chromatic number 1-12 within current octave
//
// CoCo runtime quirks:
//   - BASIC's STR$(N) prepends a space for non-negative integers, so PLAY strings
//     built like "T255 O"+STR$(O)+"N"+STR$(N) resolve to "T255 O 1N 5". Whitespace
//     between a token letter and its numeric argument is therefore skipped.
//
// Cross-call running state (tempo, octave, default length+dots, volume) is the
// SYNTH's responsibility, not the parser's. The parser emits state events for
// each T/O/V/L token (with either a `value` or an `op`) and lets the synth apply
// them in order against its persistent state. Notes/rests carry their own length
// and dots if specified in the string, otherwise null.
export function parsePlayString(input) {
  const events = []
  const s = input
  let i = 0

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

  // Read either a numeric argument or one of the four CoCo PLAY suffix operators
  // following a T/O/V/L token. Returns:
  //   { value: N }            absolute set
  //   { op: '+'|'-'|'>'|'<' } relative op (synth applies against its running state)
  //   null                    nothing readable
  function readSuffix() {
    skipWhitespace()
    if (eof()) return null
    const ch = s[i]
    if (ch === '+' || ch === '-' || ch === '>' || ch === '<') {
      i++
      return { op: ch }
    }
    const v = readNumber()
    return v === null ? null : { value: v }
  }

  while (!eof()) {
    skipWhitespace()
    if (eof()) break

    const c = s[i].toUpperCase()
    i++

    if (c === 'T') {
      const r = readSuffix()
      if (r) events.push({ type: 'tempo', ...r })
    } else if (c === 'O') {
      const r = readSuffix()
      if (r) events.push({ type: 'octave', ...r })
    } else if (c === 'L') {
      const r = readSuffix()
      if (r) {
        const dots = readDots()
        events.push({ type: 'length', ...r, dots })
      }
    } else if (c === 'V') {
      const r = readSuffix()
      if (r) events.push({ type: 'volume', ...r })
    } else if (c === 'P') {
      const ownLen = readNumber()
      const ownDots = readDots()
      events.push({ type: 'rest', length: ownLen, dots: ownDots })
    } else if (c === 'N') {
      const num = readNumber()
      events.push({ type: 'noteNumber', number: num })
    } else if (c >= 'A' && c <= 'G') {
      let accidental = 0
      if (s[i] === '#' || s[i] === '+') { accidental = 1; i++ }
      else if (s[i] === '-') { accidental = -1; i++ }
      const ownLen = readNumber()
      const ownDots = readDots()
      events.push({ type: 'note', name: c, accidental, length: ownLen, dots: ownDots })
    }
  }

  return events
}

// Resolve a state event against the current running value. Used by the synth for
// tempo/octave/volume/length events that may carry either a `value` or an `op`.
export function applyStateOp(current, event) {
  if (event.value !== undefined) return event.value
  switch (event.op) {
    case '+': return current + 1
    case '-': return current - 1
    case '>': return current * 2
    case '<': return Math.floor(current / 2)
    default: return current
  }
}

// Compute the dotted-duration multiplier from a dot count. 0 dots → 1.0, 1 → 1.5,
// 2 → 1.75, 3 → 1.875, etc.
export function dotMultiplier(dots) {
  let m = 1, add = 0.5
  for (let d = 0; d < dots; d++) { m += add; add /= 2 }
  return m
}

// Frequency table: equal-tempered, A4 = 440 Hz.
// CoCo PLAY's octave numbering is shifted up one from the standard MIDI scheme:
// CoCo's "O3 D" plays at standard D4 (~293 Hz), confirmed by ear and by spectral
// analysis of an emulator recording. So we add 2 (rather than 1) to the supplied
// octave when computing the MIDI number.
const NOTE_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteFrequency(name, accidental, octave) {
  const midi = (octave + 2) * 12 + NOTE_SEMITONE[name] + accidental
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function noteNumberFrequency(num, octave) {
  const midi = (octave + 2) * 12 + (num - 1)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// Calibration constant: how long is one whole note (length=1) at tempo T=1?
// CoCo PLAY's tempo formula isn't strictly linear, but for our purposes the
// approximation `note_seconds = WHOLE / (tempo * length)` works. At WHOLE=4.4 and
// the original game's settings:
//   - Bublitchki (T=4 L=8):   4.4/(4*8)   = 138 ms/note   matches emulator recording
//   - Step beep (T=255 L=4):  4.4/(255*4) = 4.3 ms/note   ≈ a brief click
//   - Crash (T=2 L=8):        4.4/(2*8)   = 275 ms/note   ≈ a slow ominous tone
// Calibrated against an emulator recording of the title music: matching the
// total played duration (~8.7s for Bublitchki) gave WHOLE = 4 * 8.715/7.968 ≈ 4.38,
// rounded to 4.4.
const WHOLE_NOTE_SEC_AT_T_1 = 4.4

function eventDurationSec(eventLength, dotMul, tempo) {
  const wholeSec = WHOLE_NOTE_SEC_AT_T_1 / tempo
  return (wholeSec / eventLength) * dotMul
}

function volumeToGain(v) {
  return Math.max(0, Math.min(31, v)) / 31 * 0.25
}

// Resolve a note/rest event's effective length and dots against the synth's
// running defaults. Per-event own length OR own dots disables default-dot
// inheritance — e.g. after `L4...` a bare note picks up length=4 with 3 dots,
// but `L4... B5` (own length) becomes length=5 with 0 dots and `L4... B.`
// (own single dot) becomes length=4 with 1 dot.
function resolveLengthAndDots(event, runningLength, runningDots) {
  const useLength = event.length ?? runningLength
  const ownSpecified = event.length !== null || event.dots > 0
  const useDots = ownSpecified ? event.dots : runningDots
  return { useLength, useDots }
}

export function createAudio() {
  let ac = null
  let masterGain = null
  let queueTime = 0
  let suspended = false  // when true, play() is a no-op so a hidden tab can't queue
                         // oscillators on a suspended context that would all fire on resume

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
    suspended = false
    ensureContext()
    if (ac.state === 'suspended') return ac.resume()
    return Promise.resolve()
  }

  function suspend() {
    suspended = true
    // Drop anything currently scheduled so it can't fire as a burst when the
    // context resumes later.
    if (ac) {
      for (const osc of activeNodes) {
        try { osc.stop(0) } catch {}
      }
      activeNodes.clear()
      queueTime = ac.currentTime
    }
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
    // State events (tempo, octave, length, volume) are applied even while suspended
    // so cross-call PLAY state stays consistent. Note/rest events are skipped while
    // suspended — no oscillators are scheduled and queueTime is not advanced — so
    // a hidden tab cannot queue a burst that would all fire on resume.
    if (!suspended) ensureContext()
    if (ac && queueTime < ac.currentTime) queueTime = ac.currentTime

    const events = parsePlayString(playString)
    const start = queueTime

    for (const e of events) {
      if (e.type === 'tempo') { runningTempo = applyStateOp(runningTempo, e); continue }
      if (e.type === 'octave') { runningOctave = applyStateOp(runningOctave, e); continue }
      if (e.type === 'length') {
        runningLength = applyStateOp(runningLength, e)
        runningLengthDots = e.dots ?? 0
        continue
      }
      if (e.type === 'volume') { runningVolume = applyStateOp(runningVolume, e); continue }

      if (suspended) continue   // skip scheduling for note/rest events while hidden

      if (e.type === 'rest') {
        const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
        queueTime += eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
      } else if (e.type === 'note') {
        const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
        const dur = eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
        scheduleTone(noteFrequency(e.name, e.accidental, runningOctave), dur, volumeToGain(runningVolume))
        queueTime += dur
      } else if (e.type === 'noteNumber') {
        const dur = eventDurationSec(runningLength, dotMultiplier(runningLengthDots), runningTempo)
        scheduleTone(noteNumberFrequency(e.number, runningOctave), dur, volumeToGain(runningVolume))
        queueTime += dur
      }
    }

    if (suspended) return Promise.resolve()
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
