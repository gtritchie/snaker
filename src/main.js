import { runGame } from './game.js'

export function boot(canvas) {
  let audioRef = null

  // Make the canvas focusable so keyboard events reach it. Don't override a
  // host that has already set its own tabindex.
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0

  // Canvases don't take focus on click by default. Without this, a desktop
  // player would have to Tab into the canvas before keys register.
  const onMouseDown = () => canvas.focus({ preventScroll: true })
  canvas.addEventListener('mousedown', onMouseDown)

  // Pause audio when the tab is hidden; resume when visible again. Without this,
  // a backgrounded game would keep stepping (via setTimeout) and audio would
  // continue playing — both undesirable.
  const onVisibility = () => {
    if (!audioRef) return
    const promise = document.visibilityState === 'hidden'
      ? audioRef.suspend()
      : audioRef.resume()
    promise.catch(err => console.warn('audio: visibility toggle failed:', err))
  }
  document.addEventListener('visibilitychange', onVisibility)

  runGame(canvas, audio => { audioRef = audio })
    .catch(err => {
      console.error('snaker crashed:', err)
      renderCrashOverlay(canvas, err)
    })
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
