// Meltdown — combat/rime-slow-degrades-with-heat: the slow fades as the Rime
// heats.
//
// `specs/combat.md` gives the Rime's live slow as
//
//   slowFactor(H) = slowCeil * (1 - H / 100)
//
// and spells out the arithmetic: "A Rime at heat `0` and level I therefore applies
// `0.55`, a Rime at heat `50` applies `0.275`, and a Rime at heat `100` applies
// nothing at all." The tower reports that fraction as `slowFactor`
// (`specs/instrumentation.md`: "the Rime's live slow fraction; 0 otherwise").
//
// FIVE HEATS, BECAUSE TWO POINTS FIT A GREAT MANY CURVES. Read at `0`, `25`, `50`,
// `75` and `100`, the specification requires `0.55`, `0.4125`, `0.275`, `0.1375`
// and `0`, and every wrong model reads a different five:
//
//   - a build that does not fade the slow at all reads `0.55` five times;
//   - a build that fades it QUADRATICALLY, the way `specs/heat.md` climbs the
//     damage multiplier, reads `0.55`, `0.5156`, `0.4125`, `0.2406`, `0` — right at
//     both ends and half again too strong in the middle, which is why the interior
//     samples are here;
//   - a build that fades against the Rime's redline as a fraction of some other
//     figure, or that inverts the rule and slows hardest when hot, reads the
//     sequence backwards.
//
// THE HEAT IS MOVED WITH THE TOWER PINNED, so each of the five readings is taken at
// exactly the heat posed: `setTowerThermal(id, false)` holds the tower's part in
// the heat model, so nothing cools between the pose and the read, and the trip —
// which belongs to that model — cannot take the tower offline at the `100` sample
// (`specs/instrumentation.md`).
//
// ONE FRAME IS RUN AFTER EACH POSE, so a build that recomputes its derived readouts
// once a frame and one that derives them at the snapshot are read alike. Nothing
// else is on the floor, so the frame moves nothing: the emitter has no target, and
// `specs/combat.md` neither grows nor shrinks its accumulator on such a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { TRIP_HEAT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseGun, readGun, slowCeilOf } from "./duel";

/** The one emitter that slows (`specs/towers.md`), at level I. */
const TOWER = "rime";
const LEVEL = 1;

/** The five heats read, spanning the scale end to end. */
const HEATS: readonly number[] = [0, 25, 50, 75, 100];

/** `specs/combat.md`: `slowCeil * (1 - H / 100)`. */
function expectedFactor(heat: number): number {
  return slowCeilOf(LEVEL) * (1 - heat / TRIP_HEAT);
}

/**
 * How close each reading must come, as decimal places of a slow fraction.
 *
 * Four places is `0.00005`. Each reading is one product and one subtraction over
 * figures the specification states exactly, so a conformant build's float slack is
 * orders below the bound; the nearest wrong model — the quadratic fade, read at
 * heat `25` — is `0.10` away, two thousand times the bound.
 */
const FACTOR_DIGITS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The slow fades as the Rime heats", async () => {
  const id = await poseGun(h, TOWER, HEATS[0], LEVEL);

  const read: number[] = [];
  for (const heat of HEATS) {
    await h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    read.push((await readGun(h, id, `the ${TOWER} pinned at ${heat}`)).slowFactor);
  }
  await captureStill(h, "degraded");

  for (const [index, heat] of HEATS.entries()) {
    assertCloseTo(
      read[index],
      expectedFactor(heat),
      FACTOR_DIGITS,
      `the slowFactor a level-${LEVEL} ${TOWER} reports at heat ${heat}`,
    );
  }
});
