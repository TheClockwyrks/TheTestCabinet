// pathing/never-seal-unit-route — a placement that would strand a unit already on
// the yard is refused, even when the chain itself stays open.
//
// TWO CLAUSES, AND THIS IS THE SECOND. `specs/pathing.md` refuses a placement
// that closes a leg AND one that leaves any unit with no open route to the
// checkpoint it is heading for. The first clause is about the map and holds on an
// empty yard; this one is about the Load and can only be read with a unit
// standing somewhere the first clause does not care about. A build that
// implements the leg check alone passes its sibling point and walls a unit into a
// pocket here, where it stands until the wave it belongs to can never clear.
//
// SO THE POCKET IS OFF THE CHAIN ENTIRELY: a corner of the yard no leg passes
// through, closed by a placement whose four tiles are Open, in bounds, and under
// no unit. The chain's own route is untouched, and the maze length says so on
// both sides of the refusal. The unit is then cleared and the same placement
// retaken, which is what shows the refusal was about the unit rather than about
// anything else the yard had to say.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { tileCenter } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  standBlocker,
  type Harness,
} from "../harness";

/** The two footprints that close the pocket's southern side. */
const POCKET_WALLS = [
  { col: 0, row: 2 },
  { col: 2, row: 2 },
];

/** The tile the unit stands on, inside the pocket. */
const STANDING_ON = { col: 1, row: 1 };

/** The placement that closes the pocket's last way out. */
const STRANDING = { col: 4, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a placement that would leave a unit with no route out", async () => {
  await openYard(h, { wave: 1 });
  for (const at of POCKET_WALLS) await standBlocker(h, at.col, at.row);

  // One unit in the pocket, heading for the checkpoint it spawned toward. Its
  // travel is held, because the requirement is about where it stands rather than
  // about how it walks; every other faculty it has is untouched.
  const at = tileCenter(STANDING_ON.col, STANDING_ON.row);
  const id = await parkUnit(h, "mote", at);
  await h.advance(1);
  await captureStill(h, "refused");

  const before = await h.snapshot();
  assertEqual(
    before.units.find((unit) => unit.id === id)?.waypointIndex,
    1,
    "the checkpoint the pocketed unit is heading for",
  );

  await h.debug.placeBlocker(STRANDING.col, STRANDING.row);
  const after = await h.snapshot();

  assertEqual(
    after.structures.length,
    before.structures.length,
    `the yard to stay at ${before.structures.length} structures after a ` +
      `placement anchored at (${STRANDING.col}, ${STRANDING.row}), which would ` +
      `leave the unit standing on (${STANDING_ON.col}, ${STANDING_ON.row}) ` +
      `with no open route to the checkpoint it is heading for`,
  );
  // Every leg of the chain would have stayed open, so the refusal is the unit's.
  assertCloseTo(
    after.mazeLength,
    before.mazeLength,
    6,
    "the maze length across the refusal: the chain's own route never changed",
  );

  // And the same placement, with nothing to strand, is accepted.
  await h.debug.clearUnits();
  await h.debug.placeBlocker(STRANDING.col, STRANDING.row);
  assertEqual(
    (await h.snapshot()).structures.length,
    before.structures.length + 1,
    `the same placement at (${STRANDING.col}, ${STRANDING.row}) to be accepted ` +
      `once no unit is standing in the pocket it closes`,
  );
});
