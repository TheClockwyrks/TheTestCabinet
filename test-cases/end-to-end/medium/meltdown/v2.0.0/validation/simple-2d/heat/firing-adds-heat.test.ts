// Meltdown — heat/firing-adds-heat: one shot raises heat by heatPerShot / mass.
//
// specs/heat.md puts the shot into the frame's resolution as
// `shotGain(T) = shotsFired(T, dt) * heatPerShot(T)` and divides the WHOLE change
// by the tower's thermal mass, so one shot and nothing else raises an emitter's
// heat by exactly `heatPerShot / mass`.
//
// THE READING IS TAKEN WHERE AIR COOLING IS EXACTLY ZERO. Air loss is
// proportional to `H / 100` (specs/heat.md), so a tower that opens a frame at
// heat `0` sheds nothing on it — every term is computed from the heats the frame
// opened with. The emitter is posed at `0` with both faculties running and the
// drive stops on the very frame its heat first moves, which is the frame the
// first shot resolved on. Every frame of that drive opened at `0`, so the whole
// of the number read is the shot's own gain and WHICH frame the shot landed on
// cannot change it.
//
// THE RIME CARRIES THE READING, because its mass is `1.1` rather than `1.0`: the
// division is part of the requirement, and on an Arc a build that never divided
// would read the right answer by accident. A build that skips the mass reads
// `7.0` where the specification requires `7.0 / 1.1`, which is `6.3636`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { firstShotHeat } from "./one-shot";
import { figuresOf, massOf } from "./roster";

/** The emitter read, and the two figures specs/towers.md gives it. */
const TOWER = "rime";
const HEAT_PER_SHOT = figuresOf(TOWER).heatPerShot;
const MASS = massOf(TOWER);

/** What specs/heat.md requires of one shot: 7.0 / 1.1, which is 6.3636. */
const EXPECTED = HEAT_PER_SHOT / MASS;

/**
 * How close the gain must come, as decimal places of a heat point.
 *
 * Three places is `0.0005` of a heat point on a scale of `100`. The frame the
 * reading is taken on opened at heat `0`, so the specification's own arithmetic
 * for it is a single division with no air, conduction or mover term in it at all,
 * and a conformant build needs no room here. What the bound excludes is the two
 * wrong models: skipping the mass reads `7.0`, and adding the raw `heatPerShot`
 * of some other level reads further still.
 */
const HEAT_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Each shot heats the gun", async () => {
  const gained = await firstShotHeat(h, TOWER);
  captureStill(h, "heating");

  assertCloseTo(
    gained,
    EXPECTED,
    HEAT_DIGITS,
    `the heat one level-I ${TOWER} shot adds: heatPerShot ${HEAT_PER_SHOT} ` +
      `over mass ${MASS}`,
  );
});
