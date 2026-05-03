// Three discrete delay values (ms) for keyboard speed. Each value is meant to
// match a per-iteration wallclock duration on real CoCo, which decomposes as
// `PLAY "O2 T255 G O3 C"` (~102 ms, fixed) + `FOR PP=1 TO SP NEXT` running at
// the high-speed CPU rate of ~690 iterations/sec (1.5× the slow-speed reference
// of 460 iter/sec). My audio.play step beep is fire-and-forget, so the entire
// iteration time has to live in sleep().
//   ↑ key → SP=0:   ~102 ms (just the PLAY portion)
//   no key → SP≈32: ~148 ms  (PLAY + 46 ms FOR loop)
//   ↓ key → SP=63:  ~193 ms  (PLAY + 91 ms FOR loop)
const SPEED_FAST = 100
const SPEED_NORMAL = 150
const SPEED_SLOW = 200

function computeX(left, right) {
  return (right ? 1 : 0) - (left ? 1 : 0)
}

function computeSpeed(up, down) {
  if (up && !down) return SPEED_FAST
  if (down && !up) return SPEED_SLOW
  return SPEED_NORMAL
}

export function createInput(canvas) {
  // Keyboard and touch direction state are tracked independently so that ending
  // a touch does not clobber a held keyboard direction (and vice versa).
  const kbKeys = { left: false, right: false, up: false, down: false }
  const tcKeys = { left: false, right: false, up: false, down: false }

  const keyListeners = []
  let lineInputState = null
  const escListeners = new Set()

  function setKbKeyFromEvent(e, down) {
    const k = e.key
    let handled = true
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') kbKeys.left = down
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') kbKeys.right = down
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') kbKeys.up = down
    else if (k === 'ArrowDown' || k === 's' || k === 'S') kbKeys.down = down
    else handled = false
    if (handled) e.preventDefault()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      // Clear any orphaned waitForKey listeners so a future keydown can't fire
      // resolvers whose promises are no longer awaited.
      keyListeners.length = 0
      if (lineInputState) {
        const stale = lineInputState
        lineInputState = null
        stale.reject(new Error('lineInput aborted by ESC'))
      }
      for (const h of [...escListeners]) {
        try { h() } catch {}
      }
      return
    }
    setKbKeyFromEvent(e, true)
    if (lineInputState) {
      handleLineInputKey(e)
      return
    }
    if (keyListeners.length > 0) {
      const resolvers = keyListeners.splice(0)
      for (const r of resolvers) r(e.key)
    }
  }

  function onKeyUp(e) {
    setKbKeyFromEvent(e, false)
  }

  function handleLineInputKey(e) {
    if (e.key === 'Enter') {
      const result = lineInputState.buffer
      const finish = lineInputState.resolve
      lineInputState = null
      finish(result)
      return
    }
    if (e.key === 'Backspace') {
      lineInputState.buffer = lineInputState.buffer.slice(0, -1)
    } else if (
      !e.ctrlKey && !e.metaKey && !e.altKey
      && e.key.length === 1
      && e.key.charCodeAt(0) >= 32 && e.key.charCodeAt(0) < 127
    ) {
      // Skip when a modifier is held so shortcuts like Ctrl+C / Cmd+R don't
      // pollute the buffer with the underlying character key.
      if (lineInputState.buffer.length < lineInputState.maxLength) {
        lineInputState.buffer += e.key
      }
    }
    lineInputState.render(lineInputState.buffer)
  }

  // ---- touch joystick ----
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  let touchActive = false
  let touchCenter = null
  let touchPos = null

  function onTouchStart(e) {
    if (e.touches.length === 0) return
    const t = e.touches[0]
    const rect = canvas.getBoundingClientRect()
    touchCenter = { x: t.clientX - rect.left, y: t.clientY - rect.top }
    touchPos = { ...touchCenter }
    touchActive = true
    e.preventDefault()
    if (lineInputState === null && keyListeners.length > 0) {
      const resolvers = keyListeners.splice(0)
      for (const r of resolvers) r(' ')
    }
    updateTouchKeys()
  }

  function onTouchMove(e) {
    if (!touchActive || e.touches.length === 0) return
    const t = e.touches[0]
    const rect = canvas.getBoundingClientRect()
    touchPos = { x: t.clientX - rect.left, y: t.clientY - rect.top }
    updateTouchKeys()
    e.preventDefault()
  }

  function onTouchEnd(e) {
    touchActive = false
    touchCenter = null
    touchPos = null
    tcKeys.left = tcKeys.right = tcKeys.up = tcKeys.down = false
    e.preventDefault()
  }

  function updateTouchKeys() {
    if (!touchActive || !touchCenter || !touchPos) return
    const dx = touchPos.x - touchCenter.x
    const dy = touchPos.y - touchCenter.y
    const deadZone = 16
    tcKeys.left  = dx < -deadZone
    tcKeys.right = dx >  deadZone
    tcKeys.up    = dy < -deadZone
    tcKeys.down  = dy >  deadZone
  }

  if (isTouchDevice) {
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false })
    canvas.addEventListener('touchcancel', onTouchEnd,  { passive: false })
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  function getX() {
    return computeX(kbKeys.left || tcKeys.left, kbKeys.right || tcKeys.right)
  }

  function getSpeedMs() {
    return computeSpeed(kbKeys.up || tcKeys.up, kbKeys.down || tcKeys.down)
  }

  function waitForKey() {
    return new Promise(resolve => keyListeners.push(resolve))
  }

  // Promise<string>. The caller provides `render(currentBuffer)` invoked on every
  // buffer change so the caller can redraw the prompt + buffer + cursor on canvas.
  // If a previous lineInput is still pending, it is rejected before the new one
  // replaces it — concurrent line input is not supported.
  function lineInput({ render, maxLength = 12 }) {
    if (lineInputState) {
      const stale = lineInputState
      lineInputState = null
      stale.reject(new Error('lineInput superseded by a new call'))
    }
    return new Promise((resolve, reject) => {
      lineInputState = { resolve, reject, render, buffer: '', maxLength }
      render('')
    })
  }

  // Register a callback to fire when ESC is pressed. Returns an unsubscribe fn.
  function onEscape(handler) {
    escListeners.add(handler)
    return () => escListeners.delete(handler)
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    if (isTouchDevice) {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }

  return { getX, getSpeedMs, waitForKey, lineInput, onEscape, destroy }
}
