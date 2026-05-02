// Three discrete delay values (ms) for keyboard speed. Calibrated in Task 16.
const SPEED_FAST = 30
const SPEED_NORMAL = 80
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
  const keys = { left: false, right: false, up: false, down: false }
  const keyListeners = []
  let lineInputState = null

  function setKeyFromEvent(e, down) {
    const k = e.key
    let handled = true
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = down
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = down
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = down
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = down
    else handled = false
    if (handled) e.preventDefault()
  }

  function onKeyDown(e) {
    setKeyFromEvent(e, true)
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
    setKeyFromEvent(e, false)
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
    } else if (e.key.length === 1 && e.key.charCodeAt(0) >= 32 && e.key.charCodeAt(0) < 127) {
      if (lineInputState.buffer.length < lineInputState.maxLength) {
        lineInputState.buffer += e.key
      }
    }
    lineInputState.render(lineInputState.buffer)
  }

  // ---- touch joystick ----
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  let touchActive = false
  let touchCenter = null    // {x, y} in canvas-local pixels
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
    updateKeysFromTouch()
  }

  function onTouchMove(e) {
    if (!touchActive || e.touches.length === 0) return
    const t = e.touches[0]
    const rect = canvas.getBoundingClientRect()
    touchPos = { x: t.clientX - rect.left, y: t.clientY - rect.top }
    updateKeysFromTouch()
    e.preventDefault()
  }

  function onTouchEnd(e) {
    touchActive = false
    touchCenter = null
    touchPos = null
    keys.left = keys.right = keys.up = keys.down = false
    e.preventDefault()
  }

  function updateKeysFromTouch() {
    if (!touchActive || !touchCenter || !touchPos) return
    const dx = touchPos.x - touchCenter.x
    const dy = touchPos.y - touchCenter.y
    const deadZone = 16
    keys.left  = dx < -deadZone
    keys.right = dx >  deadZone
    keys.up    = dy < -deadZone
    keys.down  = dy >  deadZone
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
    return computeX(keys.left, keys.right)
  }

  function getSpeedMs() {
    return computeSpeed(keys.up, keys.down)
  }

  function waitForKey() {
    return new Promise(resolve => keyListeners.push(resolve))
  }

  // Promise<string>. The caller provides `render(currentBuffer)` invoked on every
  // buffer change so the caller can redraw the prompt + buffer + cursor on canvas.
  function lineInput({ render, maxLength = 12 }) {
    return new Promise(resolve => {
      lineInputState = { resolve, render, buffer: '', maxLength }
      render('')
    })
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

  return { getX, getSpeedMs, waitForKey, lineInput, destroy }
}
