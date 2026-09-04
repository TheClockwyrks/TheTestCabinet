// Carom — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Carom's whole part is to name the values it
// wants on it (specs/instrumentation.md), which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the state
// is a value that every frame replaces. Nothing is closed over, so watching the
// overlay never changes what the simulation does, and each line is short enough
// to read at a glance while the game is running.

import { ballSpeed } from "./entities";
import type { CaromState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** What a line reads while the ball has been cleared out of the field. */
const ABSENT = "—";

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(api: InitApi<CaromState>): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("mode", (state) => state.mode);
  api.diagnostics.register(
    "score",
    (state) => `${state.score.p1} - ${state.score.p2}`,
  );
  api.diagnostics.register("ball pos", (state) =>
    state.ball ? `${fixed(state.ball.x)}, ${fixed(state.ball.y)}` : ABSENT,
  );
  api.diagnostics.register("ball vel", (state) =>
    state.ball
      ? `${fixed(state.ball.vx)}, ${fixed(state.ball.vy)} ` +
        `(${fixed(ballSpeed(state.ball))})`
      : ABSENT,
  );
  api.diagnostics.register("ball spin", (state) =>
    state.ball ? fixed(state.ball.spin) : ABSENT,
  );
  api.diagnostics.register(
    "paddle L",
    (state) =>
      `cy ${fixed(state.paddles.left.cy)} vy ${fixed(state.paddles.left.vy)}`,
  );
  api.diagnostics.register(
    "paddle R",
    (state) =>
      `cy ${fixed(state.paddles.right.cy)} vy ${fixed(state.paddles.right.vy)}`,
  );
}
