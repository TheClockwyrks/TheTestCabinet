// screens/fault-display-freezes-machine — a faulted run leaves the machine drawn
// where the fault caught it, part way through the cycle.
//
// THE RULE is the first clause of `specs/ui.md`, The fault display: "While
// `sim.status` is `faulted`, THE FIELD SHOWS THE MACHINE FROZEN AT THE CYCLE THE
// FAULT STOPPED, the parts and motes `specs/simulation.md` names in the fault
// drawn visibly distinct from the rest, and a banner naming which of the `FAULTS`
// of `specs/simulation.md` stopped the run." Where the fault stopped it is fixed
// by `specs/simulation.md`: "A fault freezes the run where it stood: the status
// becomes `faulted` and nothing advances further", and for a collision, "A
// `collision` leaves the fraction at that sample's `k / 8`" — a moment inside a
// cycle rather than at either of its ends.
//
// THE CONFIGURATION is worked example K of `specs/simulation.md`'s collision
// table, chosen because it is the row whose first contact comes LATEST: "An open
// track through `(-1, 0)`, `(0, 0)`, `(1, 0)`, `(2, 0)`, `(3, 0)`. An arm at
// `(-1, 0)` carries a mote on `(0, 0)` and advances; an arm at `(3, 0)` carries a
// mote on `(2, 0)` and recedes." First sample within `38`: `36.00` at `t = 5/8`.
// Five eighths of a translation between two hexes is `HEX_PITCH * 5 / 8` — `30`
// logical units — so each mote is frozen thirty units from the hex it started on
// and eighteen from the one it was heading for. A machine put back to its rest
// state, or drawn at a boundary, cannot land there.
//
// Each hold is given with `setGrip`, "which takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so the cycle under test is the first the
// run executes, and the field holds these two motes and nothing else.
//
// HOW THE FIELD IS READ. `specs/assets.md` fixes what a mote's drawing is and
// where it goes: the sprite is `44 x 44` and "centered on every mote's position,
// at rest and while carried, upright at every moment of a cycle", drawn "at that
// size in logical units … so nothing is scaled at draw time". Where that position
// IS at this moment the snapshot answers: a mote's `x` and `y` are "The drawn
// position at the current fraction" (`specs/instrumentation.md`), while its `q`
// and `r` are "the hex at the last boundary". So the check asks the frame for the
// mote sprite at the live position and, separately, for one at the resting hex.
//
// THE VERDICT. The run is `faulted` on a `collision` with the fraction at `5/8`;
// each of the two motes has a `44 x 44` sprite drawn on its live position; and
// neither has one on the hex it stood on at the last boundary. A build that
// cleared the field fails the first reading, and one that redrew the machine at
// rest fails the second.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  FRACTION_TOLERANCE,
  MOTE_SPRITE_SIZE,
  sampleFraction,
} from "../constants";
import { at, hexCenter } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  imagesNear,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** Example K's track: five cells running east, open at both ends. */
const TRACK = [at(-1, 0), at(0, 0), at(1, 0), at(2, 0), at(3, 0)];

/** Where the two carried motes rest at the last boundary, before the cycle runs. */
const WEST_MOTE = at(0, 0);
const EAST_MOTE = at(2, 0);

/**
 * Example K, as the table writes it: the track, an arm on its first cell that
 * `advance`s east, and an arm on its last cell that `recede`s west. The second
 * arm is turned to spoke `3` so its gripper stands on `(2, 0)`, the hex its mote
 * rests on — "one gripper per spoke at `base + length * DIRS[d]`"
 * (`specs/parts.md`), and `DIRS[3]` is west.
 */
const MACHINE = solution([
  trackPart(TRACK),
  armPart("arm", -1, 0, 0, 1, ["advance"]),
  armPart("arm", 3, 0, 3, 1, ["recede"]),
]);

/** The sample the first contact falls on, per the table's example K row. */
const CONTACT_SAMPLE = 5;

/**
 * How near a sprite's centre must land to count as drawn on a point.
 *
 * `specs/assets.md`: every sprite is "drawn at that size in logical units,
 * centered on the thing it depicts, so nothing is scaled at draw time". The
 * frozen motes stand thirty units from their resting hexes and eighteen from the
 * hexes they were bound for, so this span reaches neither.
 */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each mote where the faulting sample froze it rather than on its resting hex", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const ids = await partIds(h);
  const west = ids[1] as number;
  const east = ids[2] as number;

  const carriedWest = await spawnMote(h, WEST_MOTE, "dust");
  await takeGrip(h, west, 0, carriedWest);
  const carriedEast = await spawnMote(h, EAST_MOTE, "dust");
  await takeGrip(h, east, 3, carriedEast);

  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  await captureStill(h, "frozen");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has faulted");
  assertEqual(
    shown.sim?.status,
    "faulted",
    "example K comes within 38, so the run faults and the fault display is up",
  );
  assertEqual(
    shown.sim?.fault?.kind,
    "collision",
    "and the fault that stopped it is a collision",
  );
  assertNear(
    shown.sim?.fraction ?? -1,
    sampleFraction(CONTACT_SAMPLE),
    FRACTION_TOLERANCE,
    "a collision leaves the fraction at that sample's k / 8, which example K " +
      "puts at 5/8 — part way through the cycle, which is what freezing means here",
  );

  for (const [mote, resting] of [
    [carriedWest, WEST_MOTE],
    [carriedEast, EAST_MOTE],
  ] as const) {
    const live = moteById(shown, mote);
    assertNotNull(live, `the frozen run still reports mote ${String(mote)}`);
    if (live === null) continue;

    assertGreaterThan(
      imagesNear(calls, { x: live.x, y: live.y }, ON_POINT).filter(
        (draw) => draw.image.width === MOTE_SPRITE_SIZE,
      ).length,
      0,
      `the field shows the machine frozen at the fraction the fault stopped it ` +
        `at, so mote ${String(mote)} is drawn at the position it had reached`,
    );
    assertLength(
      imagesNear(calls, hexCenter(resting), ON_POINT).filter(
        (draw) => draw.image.width === MOTE_SPRITE_SIZE,
      ),
      0,
      `and not back on (${String(resting.q)}, ${String(resting.r)}), the hex it ` +
        "stood on at the last boundary, which is where a run returned to its " +
        "rest poses would have put it",
    );
  }
});
