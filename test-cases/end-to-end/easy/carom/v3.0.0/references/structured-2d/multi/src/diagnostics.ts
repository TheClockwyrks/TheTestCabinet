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
// The balls get one group of lines each, in play order, and a ball that is not
// on the field reports a dash rather than disappearing, so the panel's shape is
// the same however the field was arranged.

import type { DiagnosticValue, World } from "@clockwyrks/structured-2d";
import { BALL_COUNT, TAGS } from "./constants";
import type { Ball } from "./ball";
import { ballAt } from "./field";
import type { CaromGame } from "./game";
import { Paddle } from "./paddle";
import { stateOf } from "./state";

/** What a source shows for a ball or a paddle that is not on the field. */
const ABSENT = "—";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

function paddleLine(world: World, tag: string): string {
  const paddle = world.byTag(tag)[0];
  if (!(paddle instanceof Paddle)) return ABSENT;
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
  const ball = (index: number): Ball | null => ballAt(world(), index);
  const sources: Record<string, () => DiagnosticValue> = {
    screen: () => stateOf(world()).screen,
    mode: () => game.mode,
    score: () => {
      const { p1, p2 } = stateOf(world()).score;
      return `${p1} - ${p2}`;
    },
  };
  // One group per ball, in play order (specs/instrumentation.md).
  for (let i = 0; i < BALL_COUNT; i++) {
    sources[`ball ${i} pos`] = () => {
      const found = ball(i);
      if (found === null) return ABSENT;
      const held = found.held ? " held" : "";
      return `${fixed(found.transform.x)}, ${fixed(found.transform.y)}${held}`;
    };
    sources[`ball ${i} vel`] = () => {
      const found = ball(i);
      if (found === null) return ABSENT;
      const speed = Math.hypot(found.vx, found.vy);
      return `${fixed(found.vx)}, ${fixed(found.vy)} (${fixed(speed)})`;
    };
    sources[`ball ${i} spin`] = () => {
      const found = ball(i);
      return found === null ? ABSENT : fixed(found.spin);
    };
  }
  sources["paddle L"] = () => paddleLine(world(), TAGS.paddleLeft);
  sources["paddle R"] = () => paddleLine(world(), TAGS.paddleRight);
  return sources;
}
