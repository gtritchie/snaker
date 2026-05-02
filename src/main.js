import { runGame } from './game.js'

export function boot(canvas) {
  runGame(canvas).catch(err => {
    console.error('snaker crashed:', err)
  })
}
