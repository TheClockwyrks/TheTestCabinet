// Carom — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Carom's whole part is to name the values it
// wants on it (specs/instrumentation.md), which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the engine calls it
// with the state current at the moment the overlay reads, which is the state
// this frame's `update` returned — so watching the overlay never changes what
// the simulation does, and each line is short enough to read at a glance while
// the game is running. No source closes over a state: the one `initialize`
// built is the title screen, and a source holding it would report the title
// screen forever.
//
// Which balls are present is state, so every ball source looks its ball up by
// index and says so plainly when that ball is not in the field.

import { BALL_COUNT } from "./constants";
import { ballSpeed } from "./entities";
import type { BallState, CaromState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

type State = DeepReadonly<CaromState>;

/** What a ball source reports while that ball is not in the field. */
const ABSENT = "—";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** The ball in play order under `index`, or null while it is absent. */
function ballAt(state: State, index: number): DeepReadonly<BallState> | null {
  return state.balls.find((ball) => ball.index === index) ?? null;
}

/** Register every diagnostic source, each a read of the state it is handed. */
export function registerDiagnostics(api: InitApi<CaromState>): void {
  api.diagnostics.register("screen", (state: State) => state.screen);
  api.diagnostics.register("mode", (state: State) => state.mode);
  api.diagnostics.register(
    "score",
    (state: State) => `${state.score.p1} - ${state.score.p2}`,
  );
  // One group per ball, in play order, so the overlay shows all three at once
  // (specs/instrumentation.md) and each line stays short enough to read.
  for (let i = 0; i < BALL_COUNT; i++) {
    api.diagnostics.register(`ball ${i} pos`, (state: State) => {
      const ball = ballAt(state, i);
      if (ball === null) return ABSENT;
      return `${fixed(ball.x)}, ${fixed(ball.y)}${ball.held ? " held" : ""}`;
    });
    api.diagnostics.register(`ball ${i} vel`, (state: State) => {
      const ball = ballAt(state, i);
      if (ball === null) return ABSENT;
      return `${fixed(ball.vx)}, ${fixed(ball.vy)} (${fixed(ballSpeed(ball))})`;
    });
    api.diagnostics.register(`ball ${i} spin`, (state: State) => {
      const ball = ballAt(state, i);
      return ball === null ? ABSENT : fixed(ball.spin);
    });
  }
  api.diagnostics.register(
    "paddle L",
    (state: State) =>
      `cy ${fixed(state.paddles.left.cy)} vy ${fixed(state.paddles.left.vy)}`,
  );
  api.diagnostics.register(
    "paddle R",
    (state: State) =>
      `cy ${fixed(state.paddles.right.cy)} vy ${fixed(state.paddles.right.vy)}`,
  );
}
