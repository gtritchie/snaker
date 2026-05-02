const results = []

export function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (err) {
    results.push({ name, ok: false, err })
  }
}

export function assertEquals(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

export function assertDeepEquals(actual, expected, msg = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`)
  }
}

export function assertTrue(cond, msg = 'expected true') {
  if (!cond) throw new Error(msg)
}

export function assertThrows(fn, msg = 'expected throw') {
  try { fn() } catch { return }
  throw new Error(msg)
}

export function report() {
  const root = document.body
  const summary = document.createElement('h1')
  const passed = results.filter(r => r.ok).length
  const failed = results.length - passed
  summary.textContent = `${passed} passed, ${failed} failed`
  summary.style.color = failed === 0 ? '#0f0' : '#f00'
  root.appendChild(summary)
  for (const r of results) {
    const row = document.createElement('div')
    row.style.color = r.ok ? '#0f0' : '#f00'
    row.style.fontFamily = 'monospace'
    row.style.padding = '2px 8px'
    row.textContent = `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  — ' + r.err.message}`
    root.appendChild(row)
  }
}
