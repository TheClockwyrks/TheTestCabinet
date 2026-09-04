// Carom — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Carom's whole part is to
// name the values it wants on it (specs/instrumentation.md), which is what this
// file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does, and each line is short enough to
// read at a glance while the game is running.

import { ballSpeed } from "./entities";
import type { CaromState } from "./state";
import type { InitApi } from "./runtime";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** What a line reads while the field has no ball on it to report. */
const NO_BALL = "—";

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: CaromState): void {
  api.diagnostics.register("screen", () => state.screen);
  api.diagnostics.register("mode", () => state.mode);
  api.diagnostics.register(
    "score",
    () => `${state.score.p1} - ${state.score.p2}`,
  );
  api.diagnostics.register("ball pos", () =>
    state.ball === null
      ? NO_BALL
      : `${fixed(state.ball.x)}, ${fixed(state.ball.y)}`,
  );
  api.diagnostics.register("ball vel", () =>
    state.ball === null
      ? NO_BALL
      : `${fixed(state.ball.vx)}, ${fixed(state.ball.vy)} ` +
        `(${fixed(ballSpeed(state.ball))})`,
  );
  api.diagnostics.register("ball spin", () =>
    state.ball === null ? NO_BALL : fixed(state.ball.spin),
  );
  api.diagnostics.register(
    "paddle L",
    () =>
      `cy ${fixed(state.paddles.left.cy)} vy ${fixed(state.paddles.left.vy)}`,
  );
  api.diagnostics.register(
    "paddle R",
    () =>
      `cy ${fixed(state.paddles.right.cy)} vy ${fixed(state.paddles.right.vy)}`,
  );
}
