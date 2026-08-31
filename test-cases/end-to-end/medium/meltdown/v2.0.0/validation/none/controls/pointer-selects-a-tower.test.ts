// Meltdown — controls/pointer-selects-a-tower: a tap on a placed tower selects it.
//
// specs/controls.md's pointer table gives the row: a press and release landing on
// "A placed tower's footprint, with nothing armed" means "That tower is selected."
// specs/building.md says what selecting is — "Selecting is by tower: one tower is
// selected at a time, or none" — and specs/instrumentation.md reports the selection
// as `selected`, the tower's own id.
//
// THE ID IS THE READING. A build that selects SOMETHING on a tap but not the tower
// under the pointer has not answered the requirement, and only the id separates the
// two. `selected` is what the item's own description names.
//
// NOTHING IS ARMED, AND THAT IS THE PRECONDITION THE ROW CARRIES. With a placement
// armed the same tap is required to build instead — that is
// `controls.pointer-places` — so `startRun` leaves `build` `null` and it is read
// back before the tap.
//
// NOTHING IS SELECTED TO BEGIN WITH, so the id read after the tap cannot be a
// selection that was already standing.
//
// THE TOWER IS POSED, NOT PLACED. `addTower` puts one Arc on the floor at no cost
// and runs no placement check (specs/instrumentation.md), so a build whose
// placement is broken is failed by `building.place-builds-the-tower` rather than by
// this point. Its anchor is a quiet one, clear of all four openings and of both
// straight vent-to-exhaust corridors, so nothing about the floor's routes enters a
// reading about the pointer.
//
// THE TAP LANDS INSIDE THE FOOTPRINT, on the centre of the tower's own anchor tile
// — a point the specification puts squarely within "a placed tower's footprint" at
// every size, so the reading does not rest on where inside a footprint a build
// takes a hit.
//
// WHAT SELECTING THEN SHOWS is `hud.inspector-fields` and `hud.inspector-actions`;
// that a range ring is drawn is `presentation.*`. This point reads the selection.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  tapTile,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The tower posed: the cheapest emitter in the shop. */
const TYPE = "arc";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sets the selection to the tapped tower's id with nothing armed", async () => {
  await startRun(h);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.advance(1);
  const before = await h.snapshot();
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await tapTile(h, FREE_SITE.col, FREE_SITE.row);
  const after = await h.snapshot();
  await captureStill(h, "selected");

  assertEqual(
    after.selected,
    id,
    `the selection after a press and release on tile (${FREE_SITE.col}, ${FREE_SITE.row}), inside the posed ${TYPE}'s footprint, with nothing armed`,
  );
});
