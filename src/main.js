import { runGame } from './game.js'

export function boot(canvas) {
  let audioRef = null

  // Pause audio when the tab is hidden; resume when visible again. Without this,
  // a backgrounded game would keep stepping (via setTimeout) and audio would
  // continue playing — both undesirable.
  const onVisibility = () => {
    if (!audioRef) return
    if (document.visibilityState === 'hidden') audioRef.suspend()
    else audioRef.resume()
  }
  document.addEventListener('visibilitychange', onVisibility)

  runGame(canvas, audio => { audioRef = audio })
    .catch(err => { console.error('snaker crashed:', err) })
}
