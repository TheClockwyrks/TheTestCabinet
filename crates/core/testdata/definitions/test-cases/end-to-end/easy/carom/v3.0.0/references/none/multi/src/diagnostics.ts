// Carom — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Carom's whole part is to
// name the values it wants on it (specs/instrumentation.md), which is what this
// file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does, and each line is short enough
// to read at a glance while the game is running.
//
// A ball can be OFF the field (specs/state.md), so each ball's lines are written
// against the ball found under that index rather than against a slot: an absent
// ball reads as absent instead of taking the panel down with a read of `undefined`.

import { BALL_COUNT } from "./constants";
import { ballSpeed, findBall } from "./entities";
import type { CaromState } from "./game";
import type { InitApi } from "./runtime";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** What a line shows for a ball that is not on the field. */
const ABSENT = "—";

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: CaromState): void {
  api.diagnostics.register("screen", () => state.screen);
  api.diagnostics.register("mode", () => state.mode);
  api.diagnostics.register(
    "score",
    () => `${state.score.p1} - ${state.score.p2}`,
  );
  // One group per ball, in play order, so the overlay shows all three at once
  // (specs/instrumentation.md) and each line stays short enough to read.
  for (let index = 0; index < BALL_COUNT; index += 1) {
    api.diagnostics.register(`ball ${index} pos`, () => {
      const ball = findBall(state.balls, index);
      if (ball === null) return ABSENT;
      return `${fixed(ball.x)}, ${fixed(ball.y)}${ball.held ? " held" : ""}`;
    });
    api.diagnostics.register(`ball ${index} vel`, () => {
      const ball = findBall(state.balls, index);
      if (ball === null) return ABSENT;
      return `${fixed(ball.vx)}, ${fixed(ball.vy)} (${fixed(ballSpeed(ball))})`;
    });
    api.diagnostics.register(`ball ${index} spin`, () => {
      const ball = findBall(state.balls, index);
      return ball === null ? ABSENT : fixed(ball.spin);
    });
  }
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
