const KEY = 'snaker.bestScore'

export function loadBestScore() {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    localStorage.removeItem(KEY)
    return null
  }
  if (!parsed || typeof parsed.ticks !== 'number' || typeof parsed.name !== 'string' || typeof parsed.displayTime !== 'string') {
    return null
  }
  return parsed
}

export function saveBestScore({ name, ticks, displayTime }) {
  localStorage.setItem(KEY, JSON.stringify({ name, ticks, displayTime }))
}

export function clearBestScore() {
  localStorage.removeItem(KEY)
}
