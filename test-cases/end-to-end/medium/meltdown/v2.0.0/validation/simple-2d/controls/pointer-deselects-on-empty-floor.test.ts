// Meltdown — controls/pointer-deselects-on-empty-floor: a tap on open floor clears
// the selection.
//
// THE RULE. specs/controls.md's pointer table gives the row: a press and release
// landing on "Open floor, with nothing armed" means "Nothing is selected."
// specs/building.md says the same from the other side — "Deselecting leaves no
// tower selected" — and specs/instrumentation.md reports the selection as
// `selected`, which goes `null`.
//
// THIS IS THE OTHER HALF OF THE FLOOR'S TAP, AND ITS OWN POINT. A build that
// selects a tower on a tap but never lets go of the selection strands the player's
// inspector on a tower they have stopped looking at, and it must grade differently
// from one whose tap does nothing at all. `controls.pointer-selects-a-tower` reads
// the tap that selects; nothing here reads it.
//
// A SELECTION IS POSED FIRST, through `setSelected` (specs/instrumentation.md), so
// there is genuinely something for the tap to clear — a build whose tap does
// nothing reads as the selection still standing rather than as an empty field it
// never filled. Posing it rather than tapping it there is what keeps a build with
// a broken select from failing twice.
//
// NOTHING IS ARMED, AND THAT IS THE PRECONDITION THE ROW CARRIES. With a placement
// armed the same tap is required to build instead. `startRun` leaves `build`
// `null` and it is read back before the tap.
//
// THE TAP LANDS ON OPEN FLOOR, WELL AWAY FROM THE TOWER. Both anchors come from
// this group's quiet sites, which are six tiles apart on both axes, so the tapped
// tile cannot be part of the posed tower's footprint at its 2x2 size — which is
// what makes this tap "open floor" rather than a second selection. Both are clear
// of all four openings and of both straight vent-to-exhaust corridors.
//
// THE TOWER IS POSED, NOT PLACED, so a build whose placement is broken is failed
// by `building.place-builds-the-tower` rather than by this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE, freeSite, tapTile } from "./panel";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/** The tile tapped: a quiet anchor well clear of the posed tower's footprint. */
const EMPTY_TILE = freeSite(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the selection when open floor is tapped with nothing armed", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  h.debug.setSelected(id);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.selected,
    id,
    "posing: the selection the scenario is posed with (specs/building.md)",
  );
  assertNull(
    before.build,
    "posing: the held preview the scenario is posed with (specs/controls.md)",
  );

  await tapTile(h, EMPTY_TILE.col, EMPTY_TILE.row);
  captureStill(h, "deselected");

  assertNull(
    h.snapshot().selected,
    `the selection after a press and release on open tile (${EMPTY_TILE.col}, ` +
      `${EMPTY_TILE.row}) with nothing armed (specs/controls.md, The pointer)`,
  );
});
