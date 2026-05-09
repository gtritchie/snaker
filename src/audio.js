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

export function createAudio(opts = {}) {
  const sleep = opts.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)))
  let ac = null
  let masterGain = null
  let queueTime = 0
  let suspended = false  // when true, play() is a no-op so a hidden tab can't queue
                         // oscillators on a suspended context that would all fire on resume
  let audioDisabled = false  // set if AudioContext can't be constructed; play() then
                             // becomes a no-op aside from cross-call PLAY state updates
  let unlockAttempted = false  // set ONLY by waitForRunning()'s 1 s timeout, never by a
                               // successful 'running' transition. See waitForRunning()
                               // for the iOS 26 quirk this guards against.

  // Cross-PLAY-call running state. Mirrors CoCo PLAY's stateful behavior.
  let runningTempo = 60
  let runningOctave = 2
  let runningLength = 4
  let runningLengthDots = 0
  let runningVolume = 15

  const activeNodes = new Set()

  function stopOsc(osc) {
    // osc.stop(0) on an already-stopped oscillator throws InvalidStateError; that's
    // expected and ignorable. Any other error is a real bug worth surfacing.
    try {
      osc.stop(0)
    } catch (err) {
      if (err && err.name !== 'InvalidStateError') {
        console.warn('audio: osc.stop failed:', err)
      }
    }
  }

  function ensureContext() {
    if (ac || audioDisabled) return ac
    try {
      ac = new AudioContext()
    } catch (err) {
      audioDisabled = true
      console.warn('audio: AudioContext unavailable, audio disabled:', err)
      return null
    }
    masterGain = ac.createGain()
    masterGain.gain.value = 1.0
    masterGain.connect(ac.destination)
    queueTime = ac.currentTime
    return ac
  }

  function resume() {
    suspended = false
    ensureContext()
    if (ac && ac.state === 'suspended') return ac.resume()
    return Promise.resolve()
  }

  function suspend() {
    suspended = true
    // Drop anything currently scheduled so it can't fire as a burst when the
    // context resumes later.
    if (ac) {
      for (const osc of activeNodes) stopOsc(osc)
      activeNodes.clear()
      queueTime = ac.currentTime
    }
    if (ac && ac.state === 'running') return ac.suspend()
    return Promise.resolve()
  }

  function flush() {
    if (!ac) return
    for (const osc of activeNodes) stopOsc(osc)
    activeNodes.clear()
    queueTime = ac.currentTime
  }

  // Wait briefly for the AudioContext to transition into 'running'. Used by
  // play() to bridge the few-millisecond gap between ac.resume() being called
  // (after a user gesture) and the autoplay-policy unlock actually completing.
  // Resolves immediately if ac is already running. Times out after 1 s so we
  // can't hang if the page never gets a user gesture.
  //
  // On the iOS 26 quirk path, a freshly-created AudioContext stays in
  // 'suspended' indefinitely even after ac.resume() resolves. Without
  // unlockAttempted, every awaited play() call (TITLE_MUSIC plus the 32
  // calls in setup()'s border loop) would burn its own 1 s timeout — pre-
  // fix, the border draw was held off for ~32 s. The first timeout latches
  // the flag and emits a one-shot warn (matching the audioDisabled
  // pattern); all subsequent calls short-circuit. The flag is set only on
  // the timeout branch, so an unlock that completes within 1 s leaves it
  // false and future suspend/resume cycles on a healthy context still get
  // their 1 s grace period. Once latched, the flag persists for the
  // lifetime of this createAudio() instance — if iOS later recovers the
  // context, plays during the resume transition skip-schedule. Accepted
  // trade-off: the iOS 26 wedge does not recover in practice.
  function waitForRunning() {
    if (!ac || ac.state === 'running') return Promise.resolve()
    if (unlockAttempted) return Promise.resolve()
    return new Promise(resolve => {
      const cleanup = () => {
        ac.removeEventListener('statechange', onChange)
        clearTimeout(timer)
        resolve()
      }
      const onChange = () => { if (ac.state === 'running') cleanup() }
      ac.addEventListener('statechange', onChange)
      const timer = setTimeout(() => {
        unlockAttempted = true
        console.warn(
          `audio: AudioContext did not reach 'running' within 1 s ` +
          `(state=${ac.state}); subsequent play() calls will skip scheduling`
        )
        cleanup()
      }, 1000)
    })
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

  async function play(playString) {
    // State events (tempo, octave, length, volume) are applied even while suspended
    // or audio-disabled so cross-call PLAY state stays consistent. Note/rest events
    // are skipped in those cases — no oscillators are scheduled — so a hidden tab
    // cannot queue a burst that fires on resume, and a missing AudioContext does
    // not crash the game. The wallclock setTimeout below paces awaited play()
    // calls for the full musical duration even when scheduling is skipped, so
    // visual sequencing (title music, win sequence) stays correct under silence.
    if (!suspended) ensureContext()

    // If the context is mid-transition (suspended → running) after a recent
    // ac.resume(), wait briefly for it. Without this the very first play() call
    // after the autoplay-unlock tap would schedule oscillators on a still-
    // suspended context, with start times that elapse before the context
    // unlocks — producing silent output.
    if (ac && ac.state !== 'running') await waitForRunning()

    // Resync queueTime with ac.currentTime when the context is running. We do
    // this in BOTH directions: if queueTime fell behind currentTime (gap since
    // the last play), we catch up; if it's ahead (e.g. a previous skipped play
    // would have advanced queueTime past currentTime, but we no longer do that),
    // we don't reschedule the past. queueTime is only mutated when scheduling.
    if (ac && ac.state === 'running' && queueTime < ac.currentTime) {
      queueTime = ac.currentTime
    }

    const events = parsePlayString(playString)
    const skipScheduling = suspended || audioDisabled || !ac || ac.state !== 'running'

    // Wallclock duration is tracked separately from queueTime so awaited play()
    // calls pace correctly under skipped scheduling without poisoning the
    // future audio schedule with a queueTime that ran ahead of ac.currentTime
    // (ac.currentTime doesn't advance while suspended, so a queueTime that
    // accumulated during a silent play would schedule subsequent tones N
    // seconds in the future after the context resumes).
    let elapsedSec = 0

    for (const e of events) {
      if (e.type === 'tempo') { runningTempo = applyStateOp(runningTempo, e); continue }
      if (e.type === 'octave') { runningOctave = applyStateOp(runningOctave, e); continue }
      if (e.type === 'length') {
        runningLength = applyStateOp(runningLength, e)
        runningLengthDots = e.dots ?? 0
        continue
      }
      if (e.type === 'volume') { runningVolume = applyStateOp(runningVolume, e); continue }

      // Narrow catch around the Web Audio surface only: a scheduling failure for
      // one event must not abort the rest of the PLAY string, and must not be
      // confused with a parser/state-update bug, which propagates instead.
      try {
        if (e.type === 'rest') {
          const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
          const dur = eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
          if (!skipScheduling) queueTime += dur
          elapsedSec += dur
        } else if (e.type === 'note') {
          const { useLength, useDots } = resolveLengthAndDots(e, runningLength, runningLengthDots)
          const dur = eventDurationSec(useLength, dotMultiplier(useDots), runningTempo)
          if (!skipScheduling) {
            const freq = noteFrequency(e.name, e.accidental, runningOctave)
            scheduleTone(freq, dur, volumeToGain(runningVolume))
            queueTime += dur
          }
          elapsedSec += dur
        } else if (e.type === 'noteNumber') {
          const dotMul = dotMultiplier(runningLengthDots)
          const dur = eventDurationSec(runningLength, dotMul, runningTempo)
          if (!skipScheduling) {
            const freq = noteNumberFrequency(e.number, runningOctave)
            scheduleTone(freq, dur, volumeToGain(runningVolume))
            queueTime += dur
          }
          elapsedSec += dur
        }
      } catch (err) {
        console.error('audio.play: scheduling failed', { playString, event: e, err })
      }
    }

    if (elapsedSec <= 0) return
    await sleep(elapsedSec * 1000)
  }

  return { play, resume, suspend, flush }
}
