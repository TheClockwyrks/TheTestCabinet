// Meltdown — combat/range-from-the-footprint-centre: range is measured from the
// centre of the footprint, not from its anchor tile.
//
// `specs/combat.md`: "An emitter's range is a radius in tiles from its
// footprint's centre", and "Range is measured from the footprint's centre at
// every size, so a 4x4 Lance reaches the same distance in every direction from
// the centre of its sixteen tiles."
//
// THE DISTINGUISHING ARRANGEMENT. A 2x2's centre is only half a tile from its
// anchor tile's centre, which no reading can separate; the Lance's is a tile and
// a half, on both axes at once, and that is the gap this point opens. Two marks
// are posed the SAME distance from the centre of the anchor tile — one east, one
// west, both on the horizontal line through the footprint's centre — so any
// measurement taken from the anchor tile gives them an identical verdict, whatever
// radius it uses. Measured from the footprint's centre they are `181.5` and
// `238.5` units out, one inside the Lance's `228` and one beyond it.
//
// SO EVERY WRONG MODEL READS A DIFFERENT PAIR. A build measuring from the anchor
// tile has both marks at `211.9` and therefore targets both, or neither. A build
// measuring from the footprint's TOP-LEFT CORNER has them at `222.8` and `204.1`,
// so it targets both as well. A build with a radius short enough to exclude the
// east mark fails the first reading; one long enough to include the west mark
// fails the second. Only a build measuring from the footprint's centre reports
// the east mark and refuses the west one.
//
// TWO POSES RATHER THAN ONE FLOOR WITH BOTH MARKS ON IT, and the reason is worth
// stating: with both present, the east mark has the smaller `remaining` and is
// therefore the target under `specs/combat.md`'s target rule — so an
// anchor-measuring build, which has both in range, would report the east mark too
// and pass. Posed one at a time, `targeting` answers the range question and
// nothing else. Each pose opens a fresh run, so the second Lance's fire clock
// starts at zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, distance, type Harness } from "../harness";
import {
  gunAnchorCentre,
  gunCentre,
  poseGun,
  poseMarkAt,
  rangeUnitsOf,
  readGun,
} from "./duel";

/** The emitter read: the only 4x4 on the roster (`specs/towers.md`). */
const TOWER = "lance";
const HEAT = 0;

/** `specs/towers.md` and `specs/floor.md`: 12.0 tiles of 19 units, so 228. */
const RADIUS_UNITS = rangeUnitsOf(TOWER);

/**
 * How far each mark stands from the anchor tile's centre along the x axis.
 *
 * Geometry, not a tolerance. The footprint's centre sits `28.5` units east and
 * south of the anchor tile's centre, so a mark `210` units east of that centre is
 * `181.5` from the footprint's centre and one `210` west is `238.5` — straddling
 * the `228` radius while remaining equidistant from the anchor tile. Any offset
 * between `200` and `256` does the same; `210` is the middle of that window, and
 * it leaves both marks on the floor from the anchor at `(12, 24)`.
 */
const OFFSET_UNITS = 210;

/** The line both marks stand on: the horizontal through the footprint's centre. */
const LINE_Y = gunCentre(TOWER).y;

/** Where each mark stands. */
const EAST = { x: gunAnchorCentre().x + OFFSET_UNITS, y: LINE_Y };
const WEST = { x: gunAnchorCentre().x - OFFSET_UNITS, y: LINE_Y };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Range is measured from the footprint centre", async () => {
  const centre = gunCentre(TOWER);
  const anchor = gunAnchorCentre();

  const insideGun = await poseGun(h, TOWER, HEAT);
  const insideMark = await poseMarkAt(h, "mote", EAST.x, EAST.y);
  await h.advance(1);
  await captureStill(h, "centre");
  const withInside = await readGun(h, insideGun, "the Lance with the east mark");

  const outsideGun = await poseGun(h, TOWER, HEAT);
  await poseMarkAt(h, "mote", WEST.x, WEST.y);
  await h.advance(1);
  const withOutside = await readGun(
    h,
    outsideGun,
    "the Lance with the west mark",
  );

  assertEqual(
    withInside.targeting,
    insideMark,
    `the unit targeted with one mark ${distance(EAST, centre)} units from the ` +
      `footprint centre (${distance(EAST, anchor).toFixed(2)} from the anchor ` +
      `tile), inside the ${TOWER}'s ${RADIUS_UNITS}`,
  );
  assertNull(
    withOutside.targeting,
    `targeting with one mark ${distance(WEST, centre)} units from the ` +
      `footprint centre (${distance(WEST, anchor).toFixed(2)} from the anchor ` +
      `tile, the same distance as the east mark), beyond the ${TOWER}'s ` +
      `${RADIUS_UNITS}`,
  );
});
