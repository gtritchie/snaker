# How to play Snaker

You steer a snake making its way down a 16-row highway while cars rise toward
you from the bottom. Each successful top-to-bottom descent counts as one run;
finish three runs to win and your elapsed time becomes your score (lower is
better). Hitting a car bumps you back up one row and resumes the run.

## Controls

### Keyboard

| Key            | Action                                           |
| -------------- | ------------------------------------------------ |
| `←` or `A`     | Steer left                                       |
| `→` or `D`     | Steer right                                      |
| `↑` or `W`     | Speed up (~100 ms/step)                          |
| `↓` or `S`     | Slow down (~200 ms/step)                         |
| (no key held)  | Normal speed (~150 ms/step)                      |
| `Esc`          | Abort the current game, return to the pre-title  |

Speed is sampled every step, so you can hold `↑` to dash through a tight
opening and release for normal pace. Holding both `↑` and `↓` is treated as
neither.

### Touch (phones, tablets)

The canvas itself is a virtual joystick:

1. Touch and hold anywhere on the playfield. The point you first touch becomes
   the joystick center.
2. Drag relative to that center:
   - left / right of center steers the snake
   - above / below center maps to speed-up / slow-down
3. There is a 16-pixel deadzone around the center, so a slight wobble does not
   register as input.
4. Lift your finger to release all directions. Touch again to re-center.

A single tap also advances the pre-title and title prompts. Steering and
speed during gameplay work entirely from touch — but the name-entry and
`ANOTHER GAME (Y/N)` prompts still require a keyboard.

## Prompts during a game

- **Best-score entry.** When you beat the previous best time, the screen shows
  `WHAT IS YOUR NAME>>>>?` followed by a yellow cursor. Type up to 9 characters,
  use `Backspace` to correct, and press `Enter` to submit. Names are saved in
  `localStorage` and persist across reloads.
- **Play again.** After the best-score display, the screen prompts
  `ANOTHER GAME (Y/N)`. Press `Y` to start a new game or `N` to end on a final
  best-score recap.

## Aborting

Pressing `Esc` at any point — descent, win sequence, score screen, name entry,
play-again prompt — cancels everything in flight and returns you to the
pre-title. Your in-progress run is discarded.

## Tips

- The bottom row is constantly seeded with random color blocks and orange wall
  segments at the edges. Anything that scrolls up into your row is a hazard —
  cell `96` (the green blank) is the only safe cell.
- Slowing down near a dense pattern gives you more chances to slip through, at
  the cost of total elapsed time.
- The snake's left/right travel is clamped to the current row's wall edges, so
  you cannot run off the side of the playfield — but you also cannot duck
  through a wall to skip a row.
