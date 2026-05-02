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
  }

  return { getX, getSpeedMs, waitForKey, lineInput, destroy }
}
