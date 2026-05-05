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

  let hidden = (document.visibilityState === 'hidden')
  let hiddenSince = hidden ? now() : null
  let totalHiddenMs = 0

  const parked = new Set()
  const active = new Set()
  let destroyed = false

  function start(sleeper) {
    sleeper.startedAt = now()
    active.add(sleeper)
    sleeper.timerId = setTimeout(() => {
      active.delete(sleeper)
      sleeper.timerId = null
      sleeper.resolve()
    }, sleeper.remaining)
  }

  function park(sleeper) {
    clearTimeout(sleeper.timerId)
    sleeper.timerId = null
    sleeper.remaining -= (now() - sleeper.startedAt)
    if (sleeper.remaining < 0) sleeper.remaining = 0
    active.delete(sleeper)
    parked.add(sleeper)
  }

  function sleep(ms) {
    if (destroyed) return Promise.reject(new VisibilityGateDestroyedError())
    return new Promise((resolve, reject) => {
      const sleeper = { remaining: ms, startedAt: now(), timerId: null, resolve, reject }
      if (hidden) parked.add(sleeper)
      else start(sleeper)
    })
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && !hidden) {
      hidden = true
      hiddenSince = now()
      for (const s of [...active]) park(s)
    } else if (document.visibilityState !== 'hidden' && hidden) {
      hidden = false
      if (hiddenSince !== null) totalHiddenMs += now() - hiddenSince
      hiddenSince = null
      for (const s of [...parked]) {
        parked.delete(s)
        start(s)
      }
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

  return { sleep, visibleNow }
}
