// Meltdown — controls/pointer-arms-from-the-shop: a tap on a shop entry arms its
// type.
//
// THE RULE. specs/controls.md's pointer table gives the row: a press and release
// landing on "A shop entry" means "That entry's type is armed." The same section
// fixes what a tap is — "the game answers a press and release inside one region as
// one interaction with that region" — and specs/building.md says what arming
// leaves behind, reported as `build.type`.
//
// WHY THIS IS CAPPED `broken`. specs/controls.md requires that "Every interaction
// and every menu is reachable with the pointer alone", and the shop is where every
// tower a player ever builds comes from. A build whose shop cannot be tapped is a
// build that cannot be played with a pointer or on a touchscreen at all.
//
// THE RECTANGLE IS THE BUILD'S OWN. specs/hud.md says what the panel must hold and
// leaves "Where each element sits inside the strip" to the build, and
// specs/instrumentation.md reports each control's hit rectangle "so a scripted
// scenario operates the panel the build laid out". So the tap lands at the centre
// of the rectangle the build reported for the entry, and a build that put its shop
// somewhere unusual is graded on its own layout. That the rectangle is big enough
// for a finger is `hud.touch-targets`, and that the shop lists all eight in order
// is `hud.shop-lists-eight`.
//
// THE BLOOM, WHICH THE ITEM NAMES, and it is a better choice than the first entry:
// it is neither the first nor the last of the eight, so a build whose rectangles
// are shifted by one row lands the tap on a neighbour and reads as arming the
// wrong type rather than as arming nothing.
//
// THE MONEY CLEARS ITS BUILD COST. specs/hud.md draws an entry "whose build cost
// is above the current money" as disabled, and no specification says whether a
// disabled entry still arms — so the scenario stays away from that unstated
// question and poses money at twice the Bloom's cost.
//
// THE TAP GOES THROUGH THE ENGINE'S OWN POINTER INPUT, as a press and a release in
// one place, with a frame while it is down and a frame for the release to resolve
// on. That is the path a player's finger takes, and it is what makes this a
// reading about the POINTER rather than about the surface's `pointerUp`.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN with nothing armed, read back before the
// tap.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  clickControl,
  createHarness,
  shopEntry,
  startRun,
  type Harness,
} from "../harness";

/** The entry tapped: the Bloom, which the item names. */
const TYPE = "bloom";

/**
 * The money the run is posed with: twice the Bloom's build cost.
 *
 * Comfortably clear of specs/hud.md's disabled entry, whose arming behaviour no
 * specification states.
 */
const BUDGET = 2 * TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms the Bloom when its reported shop rectangle is tapped", async () => {
  startRun(h);
  h.debug.setMoney(BUDGET);
  await h.advance(1);
  const before = h.snapshot();
  assertNull(
    before.build,
    "posing: the held preview the scenario is posed with (specs/building.md)",
  );

  await clickControl(h, shopEntry(before.controls, TYPE));
  captureStill(h, "armed");

  assertEqual(
    h.snapshot().build?.type ?? null,
    TYPE,
    `the type held after a press and release inside the reported ${TYPE} shop ` +
      "rectangle (specs/controls.md, The pointer)",
  );
});
