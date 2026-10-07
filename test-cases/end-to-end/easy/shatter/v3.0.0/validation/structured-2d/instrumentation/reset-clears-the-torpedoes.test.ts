// instrumentation/reset-clears-the-torpedoes — `reset()` empties the torpedo roster
// and fills the charge back to full. `warhead` only.
//
// THE RULE, quoted from `specs/instrumentation.md` under `warhead`: "It empties the
// torpedo roster and sets `torpedoCharge` to `1`." Those are the two title values
// the variant adds to the list `instrumentation/reset-restores-title` reads.
//
// EVERYTHING IS DIRTIED FIRST, AND DIRTIED AWAY FROM THE TITLE VALUE, exactly as its
// sibling does it: a field posed to the value `reset` would restore says nothing. So
// torpedoes are really put in flight and the charge is really run down before the
// reset, and a build that clears one and forgets the other fails on the one it
// forgot.
//
// WHY IT IS AN ITEM OF ITS OWN. That sibling script is on BOTH checklists, and the
// only thing it could branch on to decide whether to demand these two is the build's
// own surface — whether it carries `addTorpedo`. A requirement decided that way can
// be shed by implementing less: a `warhead` build that never wrote the torpedo would
// be asked for nothing extra and pass, while one that wrote the whole torpedo and
// forgot to clear the roster would fail.
//
// THE READING IS TAKEN AT THE CALL, with no frame between, for the reason its
// sibling gives: a pose acts on the live game the moment it is made.
//
// WHAT THIS ITEM DOES NOT DECIDE. Every other field `reset` restores — that is its
// sibling — nor that `clearTorpedoes` empties the roster, which is
// `instrumentation/clear-torpedoes`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { poseTorpedo } from "./torpedo";

/** Where the torpedoes are put in flight: above the star and clear of every body. */
const TORPEDO_SPOTS = [
  { x: 420, y: 160 },
  { x: 860, y: 160 },
] as const;

/** The heading they are launched on: `+x`, across the field. */
const TORPEDO_HEADING = 0;

/**
 * The charge the run is dressed in before the reset.
 *
 * A fifth: plainly not the `1` a title-value reset has to restore, and a value a
 * real recharge passes through two seconds in (`specs/weapons.md`).
 */
const DIRTY_CHARGE = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the torpedo roster and sets the charge back to 1", async () => {
  startPlaying(h);
  for (const spot of TORPEDO_SPOTS) {
    poseTorpedo(h, spot.x, spot.y, TORPEDO_HEADING);
  }
  requireOp(h.debug, "setTorpedoCharge")(DIRTY_CHARGE);
  await h.advance(1);

  assertLength(
    torpedoesOf(h.snapshot()),
    TORPEDO_SPOTS.length,
    "the torpedoes posed in flight before the reset",
  );

  h.debug.reset();
  const after = h.snapshot();

  assertLength(
    torpedoesOf(after),
    0,
    "the torpedo roster emptied — reset empties it (specs/instrumentation.md, " +
      "under warhead)",
  );
  assertEqual(
    after.torpedoCharge,
    1,
    `torpedoCharge restored to 1 from the ${String(DIRTY_CHARGE)} it was ` +
      "posed at (specs/instrumentation.md, under warhead)",
  );

  // The title screen the reset restored.
  await h.advance(1);
  captureStill(h, "reset");
});
