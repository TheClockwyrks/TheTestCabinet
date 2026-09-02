// simulation/carried-motes-land-on-hex-centers — a motion ends with its load
// seated on hex centers, never between them.
//
// THE RULE. "A carried constellation moves as one rigid body: every mote of it
// follows the motion, and at `t = 1` every mote lands exactly on a hex center"
// (`specs/simulation.md`, Motion and carrying). The cycle order says the same of
// the moment: "5. Boundary. Motes are at rest on hex centers again." And
// `specs/field.md` fixes where a hex center is:
//
//   `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`
//   `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`
//
// — which `field.ts` carries as `hexCenter`. So at the boundary a mote's reported
// `x` and `y`, "the drawn position at the current fraction"
// (`specs/instrumentation.md`), are those two formulas of the `q` and `r` the same
// snapshot reports for it.
//
// THREE CARRIES AT ONCE, one from each family of the motion table, so the reading
// covers a sweep and both kinds of translation in the one boundary:
//
//   * a `rotate-cw` arm on `(-3, 0)` at rotation `0`, length `1`, carrying the
//     mote on its gripper hex `(-2, 0)` around to `(-3, 1)`;
//   * an `extend` piston on `(2, 0)` at rotation `0`, length `1`, carrying the
//     mote on `(3, 0)` out to `(4, 0)`;
//   * an `advance` arm mounted on an open track along `r = 3`, anchored on
//     `(0, 3)` at rotation `4` (`DIRS[4]` is `(0, -1)`, so its gripper is
//     `(0, 2)`), carrying the mote there east to `(1, 2)`.
//
// The three stand far apart — the nearest pair of motes is several hexes clear at
// every sample — so no pair comes within the `38` the collision rule watches and
// the cycle reaches its boundary. Each hold is given with `setGrip`, "which takes
// hold with no `grab` ever running" (`specs/instrumentation.md`).
//
// THE MOTIONS REALLY RAN, which is what separates this from a build that carries
// nothing: each mote is read back on the hex its own instruction sends it to
// before the seating is read at all. A build that never moved a mote would
// trivially leave every mote on a center.
//
// THE VERDICT. EVERY mote the run reports — the three carried ones, and there are
// no others — stands exactly on the center of the hex it reports, to within one
// fraction's worth of a hex step. A build that eases its motion out, that rounds a
// hex from a position rather than a position from a hex, or that leaves a
// remainder of the sweep unplayed lands off center and fails here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seats every carried mote exactly on the center of the hex it reports", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", -3, 0, 0, 1, ["rotate-cw"]),
      armPart("piston", 2, 0, 0, 1, ["extend"]),
      trackPart([at(0, 3), at(1, 3), at(2, 3)]),
      armPart("arm", 0, 3, 4, 1, ["advance"]),
    ]),
  });
  const placed = await partIds(h);
  const swept = await spawnMote(h, at(-2, 0), "dust");
  await takeGrip(h, placed[0] ?? -1, 0, swept);
  const slid = await spawnMote(h, at(3, 0), "dust");
  await takeGrip(h, placed[1] ?? -1, 0, slid);
  const ridden = await spawnMote(h, at(0, 2), "dust");
  await takeGrip(h, placed[3] ?? -1, 4, ridden);

  await advanceCycles(h, 1);
  await captureStill(h, "landed");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "the three carries stand far apart, so no pair comes within 38 and the cycle reaches its boundary",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  // The motions really ran: each carried mote reached the hex its own
  // instruction sends it to.
  for (const [mote, landed, instruction] of [
    [swept, at(-3, 1), "rotate-cw"],
    [slid, at(4, 0), "extend"],
    [ridden, at(1, 2), "advance"],
  ] as const) {
    assertEqual(
      `${moteById(boundary, mote)?.q},${moteById(boundary, mote)?.r}`,
      `${landed.q},${landed.r}`,
      `${instruction} really carried its mote, so the seating below is read off a motion that happened`,
    );
  }

  assertLength(
    boundary.sim?.motes ?? [],
    3,
    "the three carried motes are the whole of the field",
  );
  for (const mote of boundary.sim?.motes ?? []) {
    const seat: Hex = at(mote.q, mote.r);
    assertNotNull(mote, "the run reports the mote it is carrying");
    assertNear(
      mote.x,
      hexCenter(seat).x,
      DRAWN_TOLERANCE,
      `at t = 1 mote ${mote.id} lands exactly on hexX of the (q, r) it reports`,
    );
    assertNear(
      mote.y,
      hexCenter(seat).y,
      DRAWN_TOLERANCE,
      `at t = 1 mote ${mote.id} lands exactly on hexY of the (q, r) it reports`,
    );
  }
});
