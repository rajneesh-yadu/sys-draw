# modes

Sandbox / Guided / Interview / Debug / Learn / Chaos controllers.

- **Depends on:** `store`, `registry`, `engine`
- **Rules:** Each mode is a `ModeController` (`onEnter`, `onGraphChange`, `onSimResult`, `isComplete`).
- **Built in:** session S18

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New mode = new controller file.
