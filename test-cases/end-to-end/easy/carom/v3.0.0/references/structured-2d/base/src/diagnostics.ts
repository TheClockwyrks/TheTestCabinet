// Carom — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Carom's whole part is to name the values
// it wants on it (specs/instrumentation.md), registered once through
// `InitApi.diagnostics` when the instance initializes, so the sources outlive
// every level transition.
//
// Every source is a PURE READ of the live world at the moment the overlay
// evaluates it — each one reads `game.engine.world` inside the source rather
// than closing over a world read at initialization, which would report the
// title screen forever. Watching the overlay never changes what the simulation
// does, and each line is short enough to read at a glance while the game runs.
//
// The ball is not always there: `clearWorld` removes it and `spawnBall` puts it
// back (specs/state.md), so each ball line answers with a dash rather than
// inventing a figure for a ball that is not on the field.

import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";
import { ballOf } from "./ball";
import type { CaromGame } from "./game";
import { paddleOf } from "./paddle";
import { caromState } from "./state";
import type { Side } from "./sim";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

function paddleLine(world: World, side: Side): string {
  const paddle = paddleOf(world, side);
  return `cy ${fixed(paddle.transform.y)} vy ${fixed(paddle.vy)}`;
}

/**
 * The overlay's sources, by name — the same facts `snapshot()` reports. Built
 * as a map so the build's tests read each source the way the overlay does.
 */
export function diagnosticSources(
  game: CaromGame,
): Record<string, () => DiagnosticValue> {
  const world = (): World => game.engine.world;
  return {
    screen: () => caromState(world()).screen,
    mode: () => caromState(world()).mode,
    score: () => {
      const [p1, p2] = caromState(world()).players;
      return `${p1?.score ?? 0} - ${p2?.score ?? 0}`;
    },
    "ball pos": () => {
      const ball = ballOf(world());
      return ball
        ? `${fixed(ball.transform.x)}, ${fixed(ball.transform.y)}`
        : "—";
    },
    "ball vel": () => {
      const ball = ballOf(world());
      if (!ball) return "—";
      const speed = Math.hypot(ball.vx, ball.vy);
      return `${fixed(ball.vx)}, ${fixed(ball.vy)} (${fixed(speed)})`;
    },
    "ball spin": () => {
      const ball = ballOf(world());
      return ball ? fixed(ball.spin) : "—";
    },
    "paddle L": () => paddleLine(world(), "left"),
    "paddle R": () => paddleLine(world(), "right"),
  };
}
