// input/pointer-drop-illegal — a press on an illegal footprint keeps the rock held.
//
// THE REQUIREMENT. `specs/controls.md`: "A press on an illegal footprint places
// nothing and keeps the rock held." `specs/yard.md` says what that costs, in the
// negative: "A placement that fails any condition is refused: nothing is placed,
// no stamp is spent, and the held rock stays held", and makes a waypoint
// platform's four tiles one of the placements that always fails, since "no
// footprint may cover any of them".
//
// HOW IT IS DECIDED. A rock is armed on an otherwise empty yard and the pointer
// is pressed on the anchor tile of the map's first waypoint platform — a footprint
// that covers platform tiles and so can never be legal, whatever else is on the
// yard. Three things are read afterwards: the yard is still empty, the allowance
// is untouched, and the rock is still on the cursor. All three matter, because a
// build that refuses the placement and drops the rock anyway costs the player the
// stamp for nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { mapById, STAMPS_PER_LEVEL } from "../constants";
import {
  captureStill,
  clickTile,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places nothing and spends nothing when pressed over a waypoint platform", async () => {
  await openYard(h);
  await pressAction(h, "stamp");

  const armed = await h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    "a rock armed on the cursor before the press (specs/scrap-press.md)",
  );

  // The first waypoint's own anchor: a footprint here covers platform tiles, and
  // no footprint may cover any of them (specs/yard.md).
  const platform = mapById(armed.map).waypoints[0]!;
  await clickTile(h, platform.col, platform.row);
  await captureStill(h, "illegal");

  const after = await h.snapshot();
  assertLength(
    after.structures,
    0,
    `pressing over the platform of WP1 at (${platform.col}, ${platform.row}) ` +
      "to place nothing, because no footprint may cover a platform tile " +
      "(specs/yard.md)",
  );
  assertEqual(
    after.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamp allowance after a refused placement, which spends no stamp " +
      "(specs/yard.md)",
  );
  assertEqual(
    after.held.active,
    true,
    "the rock after a refused placement, which stays held (specs/controls.md)",
  );
  assertEqual(
    after.held.legal,
    false,
    "the held footprint's legal read over a waypoint platform " +
      "(specs/instrumentation.md)",
  );
});
