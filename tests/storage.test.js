import { test, assertEquals, assertDeepEquals } from './harness.js'
import { loadBestScore, saveBestScore, clearBestScore } from '../src/storage.js'

const KEY = 'snaker.bestScore'

function withCleanStorage(fn) {
  const before = localStorage.getItem(KEY)
  localStorage.removeItem(KEY)
  try { fn() } finally {
    if (before === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, before)
  }
}

test('loadBestScore returns null when nothing stored', () => {
  withCleanStorage(() => {
    assertEquals(loadBestScore(), null)
  })
})

test('saveBestScore + loadBestScore round trip', () => {
  withCleanStorage(() => {
    saveBestScore({ name: 'GARY', ticks: 1234, displayTime: '00:20' })
    assertDeepEquals(loadBestScore(), { name: 'GARY', ticks: 1234, displayTime: '00:20' })
  })
})

test('loadBestScore returns null and clears storage when JSON is corrupted', () => {
  withCleanStorage(() => {
    localStorage.setItem(KEY, 'not json{{{')
    assertEquals(loadBestScore(), null)
    assertEquals(localStorage.getItem(KEY), null)
  })
})

test('loadBestScore returns null when stored object is missing required fields', () => {
  withCleanStorage(() => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'X' }))
    assertEquals(loadBestScore(), null)
  })
})

test('clearBestScore removes the entry', () => {
  withCleanStorage(() => {
    saveBestScore({ name: 'A', ticks: 1, displayTime: '00:00' })
    clearBestScore()
    assertEquals(loadBestScore(), null)
  })
})
