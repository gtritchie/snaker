const KEY = 'snaker.bestScore'

// localStorage throws in Safari Private Mode and on quota exhaustion. Each call
// is guarded so a storage failure degrades to "no best score saved" rather than
// crashing the game.
function tryRemove() {
  try {
    localStorage.removeItem(KEY)
  } catch (err) {
    console.warn('storage: removeItem failed:', err)
  }
}

export function loadBestScore() {
  let raw
  try {
    raw = localStorage.getItem(KEY)
  } catch (err) {
    console.warn('storage: getItem failed:', err)
    return null
  }
  if (raw === null) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    tryRemove()
    return null
  }
  if (
    !parsed
    || typeof parsed.ticks !== 'number'
    || typeof parsed.name !== 'string'
    || typeof parsed.displayTime !== 'string'
  ) {
    // Discard schema-mismatched data so it doesn't sit in storage forever.
    tryRemove()
    return null
  }
  return parsed
}

export function saveBestScore({ name, ticks, displayTime }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name, ticks, displayTime }))
  } catch (err) {
    console.warn('storage: saveBestScore failed (private mode or quota?):', err)
  }
}

export function clearBestScore() {
  tryRemove()
}
