// Convert elapsed timer ticks (60 Hz) to "MM:SS".
// Mirrors the original BASIC formatting from snaker.bas lines 520-540.
export function formatScore(ticks) {
  const sec = ticks / 60
  const totalMinutes = Math.floor(sec / 60)
  const remSeconds = Math.floor(sec - totalMinutes * 60)
  const mm = String(totalMinutes).padStart(2, '0').slice(-2)
  const ss = String(remSeconds).padStart(2, '0').slice(-2)
  return `${mm}:${ss}`
}
