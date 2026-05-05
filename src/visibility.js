// Owns the engine's visibilitychange listener, audio suspend/resume, and the
// gated sleep + visibleNow primitives. See docs/superpowers/specs/2026-05-04-snaker-engine-fixes-design.md.

export class VisibilityGateDestroyedError extends Error {
  constructor() { super('visibility gate destroyed'); this.name = 'VisibilityGateDestroyedError' }
}

export function createVisibilityGate(opts = {}) {
  const document = opts.document ?? globalThis.document
  const now = opts.now ?? (() => performance.now())
  const setTimeout = opts.setTimeout ?? globalThis.setTimeout
  const clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout
  const audioRef = opts.audioRef ?? (() => null)

  let hidden = (document.visibilityState === 'hidden')
  let hiddenSince = hidden ? now() : null
  let totalHiddenMs = 0

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && !hidden) {
      hidden = true
      hiddenSince = now()
    } else if (document.visibilityState !== 'hidden' && hidden) {
      hidden = false
      if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
      hiddenSince = null
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  // Single now() snapshot — see spec Section 2 "Read tearing" (roborev #623).
  function visibleNow() {
    const t = now()
    let hiddenSoFar = totalHiddenMs
    if (hidden && hiddenSince !== null) hiddenSoFar += t - hiddenSince
    return t - hiddenSoFar
  }

  return { visibleNow }
}
