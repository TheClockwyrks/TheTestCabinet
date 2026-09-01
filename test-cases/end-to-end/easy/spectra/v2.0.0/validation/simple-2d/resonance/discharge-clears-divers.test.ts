// resonance/discharge-clears-divers — every drone in phase `diving` is gone once
// the wave has run.
//
// THE RULE. `specs/resonance.md`'s wave table: "A drone in phase `entering`,
// `diving`, or `returning` | It is destroyed." This point takes the `diving` row.
// Its siblings take the other two rows and the `formation` row that must be
// spared, so a build that clears the whole field and a build that clears nothing
// grade differently on each phase separately.
//
// THE DRONES ARE POSED IN PHASE, NOT LAUNCHED INTO ONE. `specs/resonance.md` keys
// what the wave takes on the PHASE and on nothing else, so the requirement is
// reached by posing three drones in phase `diving` — the shortest route to the
// scenario, and the only one that does not also demand the dive-launching rules
// `swarm` grades. Every faculty is off: travel, so each holds the place it was
// put and the wave is judged against a known geometry; fire, so no bullet appears
// that the wave would also be clearing.
//
// THREE RATHER THAN ONE, spread across the field's width at three different
// distances from the ship, so a build that takes only the nearest thing it
// reaches, or only one drone per wave, reads differently from a build that takes
// every diver. Each is well inside `DISCHARGE_MAX_R` (`1500`) of the ship, so the
// wave reaches all three inside its life.
//
// THE WAVE ITSELF IS NOT POSED. The meter is filled with `setResonance` and the
// discharge action is driven through its own key, because
// `specs/instrumentation.md` gives the surface no operation that discharges, so
// what expands is the build's own wave and what it destroys is the build's own
// rules.
//
// WHAT THIS DOES NOT DECIDE. That the wave lasts `DISCHARGE_TIME` is
// `resonance/discharge-duration`; that it ignores bands is
// `resonance/discharge-band-blind`; that each drone it takes pops is `bursts`'
// and scores is `scoring`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  RESONANCE_MAX,
} from "../../src/constants";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureReplay,
  createHarness,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander, release } from "./wave";

/**
 * Where the three divers stand.
 *
 * A clear stretch of the play field, spread across its width so no two are the
 * same distance from the ship at `(640, 600)`: `350`, `180` and `361` units out,
 * every one of them a small fraction of `DISCHARGE_MAX_R` (`1500`), so the wave
 * reaches all three well inside its life. All three are clear of both HUD strips
 * (`FIELD_TOP` `64`, `FIELD_BOTTOM` `656`) and of the corner the bystander holds.
 */
const DIVERS_AT = [
  { x: 340, y: 420 },
  { x: 640, y: 420 },
  { x: 980, y: 480 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock. The wave grows from `0` to
 * `DISCHARGE_MAX_R` (`1500`) over that span and the furthest diver is `361` units
 * out, so it is reached at roughly a quarter of the span and the reading is taken
 * with the whole wave behind it rather than on its edge.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys every drone in phase diving", async () => {
  startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so the wave
  // still leaves a drone standing: a stage clears in the moment the last drone of
  // its wave is destroyed (specs/stages.md), and this scenario destroys three.
  poseBystander(h);
  const divers = DIVERS_AT.map((at) =>
    poseDrone(h, "shard", at.x, at.y, { phase: "diving" }),
  );

  const posed = h.snapshot();
  assertLength(
    posed.drones,
    DIVERS_AT.length + 1,
    "precondition: the three divers and the bystander are on the field",
  );
  assertEqual(
    posed.discharge.active,
    false,
    "precondition: no wave is running before the action",
  );

  const after = await captureReplay(h, "cleared", async () => {
    await release(h, RESONANCE_MAX);
    await h.advance(WAVE_TICKS);
    return h.snapshot();
  });

  for (const [index, id] of divers.entries()) {
    assertNull(
      findDrone(after, id),
      `the drone posed in phase diving at (${DIVERS_AT[index].x}, ` +
        `${DIVERS_AT[index].y}), well inside DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}) of the ship: destroyed by the wave ` +
        `(specs/resonance.md)`,
    );
  }
});
