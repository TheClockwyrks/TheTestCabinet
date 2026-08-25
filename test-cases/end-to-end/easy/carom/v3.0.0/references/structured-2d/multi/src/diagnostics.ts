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
// The balls get one group of lines each, in play order, so the overlay shows
// all three at once.

import type { World } from "@test-cabinet/structured-2d";
import { BALL_COUNT, TAGS } from "./constants";
import { Ball, ballsOf } from "./ball";
import type { CaromGame } from "./game";
import { Paddle } from "./paddle";
import { MatchState, screenOf } from "./state";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

function ballOf(world: World, index: number): Ball | null {
  return ballsOf(world)[index] ?? null;
}

function paddleLine(world: World, tag: string): string {
  const paddle = world.byTag(tag)[0];
  if (!(paddle instanceof Paddle)) return "—";
  return `cy ${fixed(paddle.transform.y)} vy ${fixed(paddle.vy)}`;
}

/**
 * The overlay's sources, by name — the same facts `snapshot()` reports. Built
 * as a map so the build's tests read each source the way the overlay does.
 */
export function diagnosticSources(
  game: CaromGame,
): Record<string, () => unknown> {
  const world = (): World => game.engine.world;
  const match = (): MatchState | null => {
    const state = world().state;
    return state instanceof MatchState ? state : null;
  };
  const sources: Record<string, () => unknown> = {
    screen: () => screenOf(world()),
    mode: () => game.mode,
    score: () => {
      const state = match();
      if (state === null) return "0 - 0";
      return `${state.players[0]?.score ?? 0} - ${state.players[1]?.score ?? 0}`;
    },
  };
  // One group per ball, in play order (specs/instrumentation.md).
  for (let i = 0; i < BALL_COUNT; i++) {
    sources[`ball ${i} pos`] = () => {
      const ball = ballOf(world(), i);
      if (!ball) return "—";
      const held = ball.held ? " held" : "";
      return `${fixed(ball.transform.x)}, ${fixed(ball.transform.y)}${held}`;
    };
    sources[`ball ${i} vel`] = () => {
      const ball = ballOf(world(), i);
      if (!ball) return "—";
      const speed = Math.hypot(ball.vx, ball.vy);
      return `${fixed(ball.vx)}, ${fixed(ball.vy)} (${fixed(speed)})`;
    };
    sources[`ball ${i} spin`] = () => {
      const ball = ballOf(world(), i);
      return ball ? fixed(ball.spin) : "—";
    };
  }
  sources["paddle L"] = () => paddleLine(world(), TAGS.paddleLeft);
  sources["paddle R"] = () => paddleLine(world(), TAGS.paddleRight);
  return sources;
}
