// Shatter — input, as named runtime actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them (`BINDINGS` in `src/constants.ts`) and the runtime
// (`src/keyboard.ts`) does the listening, the edge detection and the binding.
//
// `specs/controls.md` gives three codes two meanings each — `Space` fires and
// confirms, `Escape` pauses and leaves, `ArrowUp` thrusts and moves a menu
// selection up — and says THE SCREEN DECIDES which applies. Each meaning is its
// own action here, bound to the same code, and the screen decides by reading only
// the actions it answers to. Two actions on one key each arm their own edge, so
// reading one never eats the other's.

import { ACTIONS, BINDINGS } from "./constants";
import type { InitApi } from "./runtime";

/** Register every action Shatter answers to, bound as `BINDINGS` gives it. */
export function registerActions(api: InitApi): void {
  for (const action of ACTIONS) {
    api.input.register(action, BINDINGS[action]);
  }
}
