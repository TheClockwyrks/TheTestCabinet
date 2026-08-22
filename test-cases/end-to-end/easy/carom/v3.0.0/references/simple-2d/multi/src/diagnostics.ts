// Carom — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Carom's whole part is to name the values it
// wants on it (specs/instrumentation.md), which is what this file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does, and each line is short enough to
// read at a glance while the game is running.

import { BALL_COUNT } from "./constants";
import { ballSpeed } from "./entities";
import type { CaromState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

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
  for (let i = 0; i < BALL_COUNT; i++) {
    api.diagnostics.register(`ball ${i} pos`, () => {
      const ball = state.balls[i];
      return `${fixed(ball.x)}, ${fixed(ball.y)}${ball.held ? " held" : ""}`;
    });
    api.diagnostics.register(`ball ${i} vel`, () => {
      const ball = state.balls[i];
      return `${fixed(ball.vx)}, ${fixed(ball.vy)} (${fixed(ballSpeed(ball))})`;
    });
    api.diagnostics.register(`ball ${i} spin`, () =>
      fixed(state.balls[i].spin),
    );
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
