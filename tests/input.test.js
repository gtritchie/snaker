import { test, assertEquals, assertTrue } from './harness.js'
import { createInput } from '../src/input.js'

// Stub the canvas surface that createInput attaches listeners to.
// captures the registered handlers so tests can synthesize events directly.
function makeStubCanvas() {
  const handlers = {}
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn) },
    removeEventListener(type, fn) {
      const arr = handlers[type]
      if (!arr) return
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 192 }),
    focus() {},
    tabIndex: 0,
  }
}

function makeKeyEvent(key, opts = {}) {
  let prevented = false
  return {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    preventDefault() { prevented = true },
    get prevented() { return prevented },
    wasPrevented() { return prevented },
  }
}

function fireKeyDown(canvas, e) {
  for (const fn of canvas.handlers.keydown ?? []) fn(e)
}

// ── waitForKey path ────────────────────────────────────────────────────

test('Space during waitForKey() resolves the wait AND calls preventDefault', async () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  const p = input.waitForKey()
  const e = makeKeyEvent(' ')
  fireKeyDown(canvas, e)
  await p
  assertTrue(e.wasPrevented(), 'preventDefault should have been called')
})

test('Space with no waiter pending does NOT call preventDefault', () => {
  const canvas = makeStubCanvas()
  createInput(canvas)
  const e = makeKeyEvent(' ')
  fireKeyDown(canvas, e)
  assertEquals(e.wasPrevented(), false, 'no waiter, no preventDefault')
})

// ── lineInput path ─────────────────────────────────────────────────────

test('Enter during lineInput() resolves AND calls preventDefault', async () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  const p = input.lineInput({ render: () => {} })
  const e = makeKeyEvent('Enter')
  fireKeyDown(canvas, e)
  await p
  assertTrue(e.wasPrevented())
})

test('Backspace during lineInput() shrinks buffer AND calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  fireKeyDown(canvas, makeKeyEvent('a'))
  fireKeyDown(canvas, makeKeyEvent('b'))
  const e = makeKeyEvent('Backspace')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'a')
  assertTrue(e.wasPrevented())
})

test('Printable char during lineInput() appends AND calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  const e = makeKeyEvent('x')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'x')
  assertTrue(e.wasPrevented())
})

test('Printable char dropped at maxLength still calls preventDefault', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b }, maxLength: 1 })
  fireKeyDown(canvas, makeKeyEvent('a'))
  const e = makeKeyEvent('b')
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, 'a', 'second char dropped')
  assertTrue(e.wasPrevented(), 'still preventDefault — engine swallowed the keystroke')
})

test('Printable char with Ctrl held is NOT consumed and NOT preventDefaulted', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let lastBuffer = ''
  input.lineInput({ render: (b) => { lastBuffer = b } })
  // Use 'c' rather than 'a' — 'a' is a movement key (left), so
  // setKbKeyFromEvent runs first and preventDefaults BEFORE the line-input
  // branch sees it. 'c' has no direction handling, so the only path that
  // could call preventDefault is the printable branch — which the modifier
  // check correctly skips.
  const e = makeKeyEvent('c', { ctrlKey: true })
  fireKeyDown(canvas, e)
  assertEquals(lastBuffer, '', 'modifier means engine does not consume')
  assertEquals(e.wasPrevented(), false)
})

test('Tab key during lineInput is NOT consumed and NOT preventDefaulted', () => {
  const canvas = makeStubCanvas()
  const input = createInput(canvas)
  let renderCount = 0
  input.lineInput({ render: () => { renderCount++ } })
  const initialRender = renderCount
  const e = makeKeyEvent('Tab')
  fireKeyDown(canvas, e)
  assertEquals(e.wasPrevented(), false, 'Tab is not handled by lineInput')
  // render still fires once on the unchanged buffer (existing behavior — Tab
  // falls through to the trailing render call). The point is that the
  // browser default (focus advance) is preserved.
  assertEquals(renderCount, initialRender + 1)
})
