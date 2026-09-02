// Meltdown — controls/esc-cancels-a-held-placement: Escape with a placement armed
// cancels it, and does not pause.
//
// THE RULE. specs/controls.md resolves `back` — bound to `Escape` — "in this
// order, taking the first case that applies: 1. A placement is armed: cancel it,
// leaving the screen where it is... 3. The screen is `playing`: open the pause
// screen." This item is case 1, and what makes it an item of its own is the
// phrase "leaving the screen where it is": the requirement is not merely that the
// preview clears, it is that case 1 is taken INSTEAD of case 3.
// specs/building.md says what cancelling leaves behind — "Disarming clears the
// preview entirely" — reported as `build` going null.
//
// BOTH HALVES ARE ONE RULE. A build that clears the preview and also pauses has
// not taken the first case that applies; it has taken two. A build that pauses
// without clearing has taken the wrong case outright. So the reading is the pair,
// and either half alone would let one of those two builds through.
//
// NOTHING IS SELECTED, ON PURPOSE. Case 2 sits between the two cases this item is
// about, so a scenario that armed a placement AND selected a tower would be
// reading the ordering of cases 1 and 2 as well — and would rest on whether arming
// a type leaves a selection standing, which no specification states either way.
// `startRun` leaves `selected` null and this scenario leaves it there.
//
// AN ARC IS HELD, the cheapest emitter in specs/towers.md's table, with the money
// posed at its build cost so the entry is affordable and nothing here brushes
// against specs/hud.md's disabled entry. The preview sits on a quiet anchor, so
// nothing about the floor's routes enters a reading about a key.
//
// THE PREVIEW IS READ BACK BEFORE THE PRESS, so a build that never armed at all is
// caught posing rather than passing on a preview it never held.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** The key specs/controls.md binds `back` to, as a `KeyboardEvent.code`. */
const KEY = "Escape";

/** The type held: the cheapest emitter in the shop. */
const TYPE = "arc";

/** Money at the held type's build cost, so its shop entry is not the disabled one. */
const PURSE = TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the held preview and leaves the game playing when Escape is pressed with a placement armed", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(QUIET_SITE.col, QUIET_SITE.row);
  await h.advance(1);

  const before = h.snapshot();
  assertNotNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await h.tap(KEY);
  captureStill(h, "cancelled");

  const after = h.snapshot();
  assertNull(
    after.build,
    `${KEY}: the held preview after one press with a placement armed`,
  );
  assertEqual(
    after.screen,
    "playing",
    `${KEY}: the screen after one press with a placement armed, which cancelling leaves where it is`,
  );
});
