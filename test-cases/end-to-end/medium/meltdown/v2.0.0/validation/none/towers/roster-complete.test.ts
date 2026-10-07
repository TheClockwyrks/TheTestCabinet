// towers/roster-complete — all eight towers arm, preview and place, and the shop
// lists all eight in the roster's order.
//
// `specs/towers.md`: "Eight towers stand on the floor: six emitters that fire, and
// the Forge and the Sink, which never fire and only move heat."
// `specs/hud.md`, The shop: "The shop lists all eight towers, one entry per type,
// in the shop order of `TOWER_TYPES`: Arc, Stutter, Rime, Flak, Bloom, Lance,
// Forge, Sink." `specs/building.md` gives the three steps a type is built by:
// arming holds a preview, the preview follows the pointer and reports whether it
// could be placed, and placing commits it.
//
// WHY THIS RUNS THE WHOLE ACT AND NOT `addTower`. Everything else in this group
// poses its floor with `addTower`, which costs nothing and runs no placement
// check. This item is the one whose requirement IS that a type can be built, so
// each of the eight is armed, previewed and placed through the same operations a
// player's press reaches (`specs/instrumentation.md`, Building), and a type that
// arms but never previews as valid, or previews but never commits, is named at the
// step it failed rather than merely missing from the floor at the end.
//
// THE THREE STEPS ARE READ SEPARATELY FOR EACH TYPE, so a build that dropped one
// entry from its roster fails naming that type and that step. What each step is
// worth on its own — the deduction, the tiles blocked, the re-path, what an invalid
// footprint does — is the `building/*` group's; this item asks only that all eight
// go through.
//
// THE ANCHORS ARE THE QUIET ONES, six tiles apart on both axes, so the Lance's 4x4
// and the Bloom's 3x3 have room and no two footprints meet: a placement refused
// because it landed on the tower before it would be a scenario grading itself
// rather than the roster.
//
// THE PURSE IS FAR ABOVE THE WHOLE ROSTER. The eight cost `500` between them, and
// `specs/building.md` refuses a footprint the money cannot cover and disarms
// placement when the money left falls below the held type's cost, so a thin purse
// would turn this into an economy check. Whether an unaffordable entry is refused
// is `building/preview-invalid-when-unaffordable`'s requirement.
//
// THE ORDER IS READ OFF `controls.shop`, which `specs/instrumentation.md` defines
// as "one per entry, in shop order". Whether each entry DRAWS its name and its
// cost is `hud/shop-lists-eight`'s requirement; what is decided here is that there
// are eight of them and that they run in the roster's order.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import { TOWER_DEFS, TOWER_TYPES } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./probes";

/**
 * Money far above the `500` the whole roster costs, so no entry is refused or
 * disarmed for affordability at any point in the sequence.
 */
const PURSE = 5000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("arms, previews and places every one of the eight, and lists them in shop order", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  for (const [index, type] of TOWER_TYPES.entries()) {
    const at = freeSite(index);
    const before = (await h.snapshot()).towers.length;

    // Arming holds a preview of that type (specs/building.md, Arming a type).
    await h.debug.setArmed(type);
    const armed = await heldPreview(h);
    assertEqual(armed.type, type, `the type held after arming the ${type}`);

    // The preview sits where it was put, and the placement check accepts it.
    await h.debug.setPreview(at.col, at.row);
    const previewed = await heldPreview(h);
    assertEqual(
      previewed.col,
      at.col,
      `the column the ${type}'s preview is held at`,
    );
    assertEqual(
      previewed.row,
      at.row,
      `the row the ${type}'s preview is held at`,
    );
    assertEqual(
      previewed.valid,
      true,
      `the ${type}'s footprint at (${at.col}, ${at.row}) — open floor, inside no ` +
        "build zone, with the money well above its cost — to pass the placement " +
        "check (specs/building.md, Valid and invalid)",
    );

    // Placing commits it.
    await h.debug.place();
    const after = await h.snapshot();
    if (after.towers.length !== before + 1) {
      fail(
        `placing the ${type} on a valid footprint to build one tower ` +
          "(specs/building.md, Placing)",
        `the roster went from ${before} towers to ${after.towers.length}`,
      );
    }
    const built = lastTower(after);
    assertEqual(built?.type, type, `the type of the tower the ${type} placed`);
    assertEqual(
      built?.col,
      at.col,
      `the column the placed ${type} landed its footprint at`,
    );
    assertEqual(
      built?.row,
      at.row,
      `the row the placed ${type} landed its footprint at`,
    );
  }

  await h.debug.setArmed(null);
  await h.advance(1);
  await captureStill(h, "roster");

  const standing = await h.snapshot();
  assertDeepEqual(
    standing.towers.map((tower) => tower.type),
    [...TOWER_TYPES],
    "the eight types standing on the floor, one placement each, in the order " +
      "they were built",
  );

  assertLength(
    standing.controls.shop,
    TOWER_TYPES.length,
    "the entries the shop reports",
  );
  assertDeepEqual(
    standing.controls.shop.map((entry) => entry.type),
    [...TOWER_TYPES],
    "the shop's entries, in the shop order specs/hud.md gives: " +
      TOWER_TYPES.map((type) => `${type} (${TOWER_DEFS[type].cost})`).join(
        ", ",
      ),
  );
});
