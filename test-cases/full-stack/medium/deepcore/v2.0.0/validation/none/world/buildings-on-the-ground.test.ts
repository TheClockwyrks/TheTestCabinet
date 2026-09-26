// world/buildings-on-the-ground — every building rises from the camp ground.
//
// `specs/world.md` leaves where the six buildings stand to the build and fixes
// two things about each footprint: "Every footprint's base sits on the ground
// line: `y + h` equals `SURFACE_Y` (`80`), and the building rises from there into
// the open sky", and "Every footprint lies within columns `1`–`30`". A building
// floating above the ground, or sunk into the first row of rock, or standing over
// the bedrock border, is one a prospector walking the camp cannot reach the way
// the camp is meant to be walked.
//
// The footprints are read through `buildings()`, which
// `specs/instrumentation.md` has report "`{ id, x, y, w, h }`, with `id` the
// building's id and `x`, `y`, `w`, `h` its footprint in world units". Each of the
// six ids `specs/world.md` names is looked up by name, so a build that reported
// five fails here naming the one that is not standing on the ground.
//
// Columns `1`–`30` span world `x` from `TILE` to `(PLAYABLE_COL_MAX + 1) * TILE`,
// which is `80` to `2480`, since a cell's rectangle runs from `col * TILE`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  BUILDING_IDS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SURFACE_Y,
  TILE,
} from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** The world `x` the playable columns run between. */
const FIELD_LEFT = PLAYABLE_COL_MIN * TILE;
const FIELD_RIGHT = (PLAYABLE_COL_MAX + 1) * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sits every footprint's base on the ground line, inside the playable columns", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await h.advance(2);

  const boxes = await h.debug.buildings();
  for (const id of BUILDING_IDS) {
    const box = boxes.find((entry) => entry.id === id);
    if (box === undefined) {
      fail(
        `a footprint for the "${id}" specs/world.md names`,
        `buildings() reported ${boxes.length === 0 ? "none" : boxes.map((b) => b.id).join(", ")}`,
      );
    }
    assertEqual(box.y + box.h, SURFACE_Y, `the base of "${id}"`);
    assertGreaterThanOrEqual(box.x, FIELD_LEFT, `the left edge of "${id}"`);
    assertLessThanOrEqual(
      box.x + box.w,
      FIELD_RIGHT,
      `the right edge of "${id}"`,
    );
  }

  // The picture: the camp the six buildings stand on.
  await captureStill(h, "camp");
});
