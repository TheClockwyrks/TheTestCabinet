// scoring/sonar-range-by-depth — the pulse's range shrinks with depth.
//
// specs/progression.md: "`E = max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (d - 1))`
// tiles", which "is reported as `sonar.range`, and it is the range every pulse the
// forager emits carries, reported as that pulse's `range`". So the figure is read
// twice at every depth: off the state, and off a wavefront the forager actually
// put in the water.
//
// FIVE DEPTHS, BECAUSE THE FLOOR IS PART OF THE RULE. `E` falls by one a depth to
// `6` at depth `4`, and depth `5` is where `SONAR_RANGE_MIN` (`5`) takes over — a
// build that goes on subtracting is only caught by asking a depth at the floor.
//
// THE PULSE IS FIRED WITH THE KEY, because nothing else can fire one: the
// debugging surface carries no operation that emits a pulse, and the claim is
// about a pulse the forager actually emits. A build whose sonar control is dead
// therefore fails here as well as at `controls.sonar-key`, which is the price of
// the clause being about an emitted pulse rather than about a reported number.
//
// THE FRESHEST PULSE IS THE ONE READ. A pulse outlives the beat between two
// depths, so the list can hold the previous depth's front as well; the one whose
// front has travelled least is the one just fired.
//
// THE DEPTH IS POSED THROUGH `setDepth`, which lays the depth's roster out denned
// and unreleased and leaves the maze alone (specs/instrumentation.md), so nothing
// is loose while the pulses are cast.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertNotNull } from "../assert";
import { BINDINGS, SONAR_RANGE_MIN, sonarRange } from "../constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import type { FathomSnapshot, PulseSnapshot } from "../surface";
import { ticks } from "../harness";

/** The depths read, which reach the floor `SONAR_RANGE_MIN` sets. */
const DEPTHS = [1, 2, 3, 4, 5] as const;

/** The key specs/movement.md binds `a` to, which emits a sonar pulse. */
const SONAR_KEY = BINDINGS.a[0];

/** How long a pulse may take to appear after the key, in ticks. */
const PULSE_BUDGET = ticks(0.5);

/** Ticks run after a pulse is read, so the clip shows its front sweeping out. */
const PULSE_TAIL = ticks(0.25);

/** The forager's own wavefronts in flight. */
function foragerPulses(snapshot: FathomSnapshot): PulseSnapshot[] {
  return snapshot.pulses.filter((pulse) => pulse.source === "forager");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports E at every depth, and carries it on the pulses it emits", async () => {
  await startPlaying(h);

  const read = await captureReplay(h, "range", async () => {
    const depths: {
      depth: number;
      range: number;
      pulse: PulseSnapshot | null;
      fired: boolean;
    }[] = [];
    for (const depth of DEPTHS) {
      h.debug.setDepth(depth);
      const posed = h.snapshot();
      const had = foragerPulses(posed).length;
      h.debug.setSonarCooldown(0);
      await h.tap(SONAR_KEY);
      const cast = await h.until((s) => foragerPulses(s).length > had, {
        maxFrames: PULSE_BUDGET,
        poll: 1,
      });
      const freshest = foragerPulses(
        cast.snapshot,
      ).reduce<PulseSnapshot | null>(
        (best, pulse) =>
          best === null || pulse.front < best.front ? pulse : best,
        null,
      );
      await h.advance(PULSE_TAIL);
      depths.push({
        depth,
        range: posed.sonar.range,
        pulse: freshest,
        fired: cast.hit,
      });
    }
    return depths;
  });

  for (const at of read) {
    assertEqual(
      at.range,
      sonarRange(at.depth),
      `sonar.range at depth ${String(at.depth)}, against ` +
        "max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (d - 1)) (specs/progression.md)",
    );
    assertEqual(
      at.fired,
      true,
      `a wavefront the forager emitted at depth ${String(at.depth)}, fired ` +
        `with the ${SONAR_KEY} key inside ${String(PULSE_BUDGET)} ticks`,
    );
    assertNotNull(
      at.pulse,
      `the wavefront just fired at depth ${String(at.depth)}`,
    );
    assertEqual(
      at.pulse?.range,
      sonarRange(at.depth),
      `the range the pulse fired at depth ${String(at.depth)} carries, which ` +
        "is the range the state reports (specs/progression.md)",
    );
  }
  assertEqual(
    read[read.length - 1].range,
    SONAR_RANGE_MIN,
    `sonar.range at depth ${String(DEPTHS[DEPTHS.length - 1])}, where ` +
      `SONAR_RANGE_MIN (${String(SONAR_RANGE_MIN)}) takes over from the ` +
      "falling figure (specs/progression.md)",
  );
});
