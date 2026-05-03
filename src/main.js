import { runGame, computeScale } from './game.js'

const activeCanvases = new WeakSet()

export function boot(canvas, options = {}) {
  if (activeCanvases.has(canvas)) {
    throw new Error('snaker: boot() called on a canvas that already has an active instance — call destroy() first')
  }

  const container = options.container ?? canvas.parentElement
  if (!(container instanceof Element)) {
    throw new Error('snaker: boot(canvas) requires canvas to be in the DOM, or pass options.container')
  }

  activeCanvases.add(canvas)

  // Snapshot the inline style values we're about to overwrite so destroy()
  // can restore the host's pre-boot state exactly. An empty snapshot is fine
  // — assigning '' removes the property, matching the unset case.
  const priorStyles = {
    imageRendering: canvas.style.imageRendering,
    display:        canvas.style.display,
    touchAction:    canvas.style.touchAction,
  }

  // Width-only-mode detection: hide the canvas, see if the container's height
  // collapses to 0. If so, the container has no height of its own (no explicit
  // height, no aspect-ratio) and we must use width-only scaling forever.
  // Synchronous — the next assignment overwrites display anyway, so no flicker.
  canvas.style.display = 'none'
  const useWidthOnly = container.clientHeight === 0

  canvas.style.imageRendering = 'pixelated'
  canvas.style.display = 'block'   // also undoes the 'none' set during detection
  canvas.style.touchAction = 'none'

  const priorTabindex = canvas.hasAttribute('tabindex')
  if (!priorTabindex) canvas.tabIndex = 0

  const onMouseDown = () => canvas.focus({ preventScroll: true })
  canvas.addEventListener('mousedown', onMouseDown)

  const game = runGame(canvas)

  // Initial scale before the observer fires, so the canvas isn't briefly
  // visible at native 256x192.
  game.screen.setScale(computeScale(container, useWidthOnly))

  const ro = new ResizeObserver(() => {
    game.screen.setScale(computeScale(container, useWidthOnly))
  })
  ro.observe(container)

  // Pause audio when the tab is hidden; resume when visible. Without this,
  // a backgrounded game keeps stepping (via setTimeout) and audio continues —
  // both undesirable.
  const onVisibility = () => {
    const promise = document.visibilityState === 'hidden'
      ? game.audio.suspend()
      : game.audio.resume()
    // audio.suspend()/resume() return undefined when the AudioContext doesn't
    // exist yet (no user interaction). Wrap so .catch() doesn't TypeError.
    Promise.resolve(promise).catch(err => console.warn('audio: visibility toggle failed:', err))
  }
  document.addEventListener('visibilitychange', onVisibility)

  game.promise.catch(err => {
    console.error('snaker crashed:', err)
    renderCrashOverlay(canvas, err)
  })

  let destroyed = false
  function destroy() {
    if (destroyed) return
    destroyed = true

    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    canvas.removeEventListener('mousedown', onMouseDown)
    game.escUnsub()
    game.input.destroy()
    game.audio.flush()
    // Wrap because audio.suspend() returns undefined if no AudioContext was
    // created (e.g. destroy() called before the user ever pressed a key).
    Promise.resolve(game.audio.suspend()).catch(err => console.warn('audio: suspend on destroy failed:', err))
    game.setDestroyed()
    game.fireAbort()

    canvas.style.imageRendering = priorStyles.imageRendering
    canvas.style.display        = priorStyles.display
    canvas.style.touchAction    = priorStyles.touchAction
    if (!priorTabindex) canvas.removeAttribute('tabindex')

    activeCanvases.delete(canvas)
  }

  return destroy
}

// Without this, an unhandled error inside runGame just freezes the canvas with
// no signal to the user that anything is wrong — devtools is the only feedback.
function renderCrashOverlay(canvas, err) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f00'
  ctx.textBaseline = 'top'
  ctx.font = '16px monospace'
  ctx.fillText('GAME CRASHED — RELOAD TO RESTART', 8, 8)
  ctx.fillStyle = '#888'
  ctx.font = '12px monospace'
  const detail = (err && (err.message || String(err))) || 'unknown error'
  ctx.fillText(detail.slice(0, 80), 8, 32)
}
