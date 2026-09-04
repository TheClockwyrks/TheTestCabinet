// instrumentation/reset-clears-the-torpedoes — `reset()` empties the torpedo roster
// and fills the charge back to full. `warhead` only.
//
// THE RULE. `specs/instrumentation.md` states of `reset` under this variant that it
// empties the torpedo roster and sets `torpedoCharge` to `1` — the two title values
// the variant adds to the list `instrumentation/reset-restores-title` reads.
//
// WHY EVERY FIELD IS POSED AWAY FIRST, exactly as its sibling item does it: a
// `reset` that assigns nothing at all passes a check run against a game already at
// those values. So torpedoes are really put in flight and the charge is really run
// down before the reset, and a build that clears one and forgets the other fails on
// the one it forgot.
//
// WHY IT IS AN ITEM OF ITS OWN. `instrumentation/reset-restores-title` is on BOTH
// checklists, and the only thing it could branch on to decide whether to demand
// these two is the build's own surface — whether it installed `addTorpedo`. A
// requirement decided that way can be shed by implementing less: a `warhead` build
// that never wrote the torpedo would be asked for nothing extra and pass, while one
// that wrote the whole torpedo and forgot to clear the roster would fail. This item
// is named by the warhead checklist alone, so it asks unconditionally.
//
// WHAT THIS ITEM DOES NOT DECIDE. Every other field `reset` restores — that is its
// sibling — nor that `clearTorpedoes` empties the roster, which is
// `instrumentation/clear-torpedoes`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the torpedoes are put in flight: above the star and clear of every body. */
const TORPEDO_PLACES = [
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
const POSED_CHARGE = 0.2;

/**
 * The decimal places the restored charge is held to.
 *
 * Six, which is to say exactly: `specs/instrumentation.md` fixes the value at `1`
 * rather than near it, so nothing but floating-point rounding stands between a
 * conforming build's answer and the figure.
 */
const TITLE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the torpedo roster and fills the charge", async () => {
  await startPlaying(h);

  for (const place of TORPEDO_PLACES) {
    await poseTorpedo(h, place.x, place.y, TORPEDO_HEADING, { homing: false });
  }
  await h.debug.setTorpedoCharge(POSED_CHARGE);
  await h.advance(1);

  await h.debug.reset();
  await captureStill(h, "reset");
  const s = await h.snapshot();

  assertLength(
    s.torpedoes ?? [],
    0,
    `the torpedoes left after reset, with ${String(TORPEDO_PLACES.length)} ` +
      "posed in flight before it — reset empties the torpedo roster " +
      "(specs/instrumentation.md)",
  );
  assertCloseTo(
    s.torpedoCharge ?? -1,
    1,
    TITLE_DIGITS,
    `the torpedo charge after reset, posed at ${String(POSED_CHARGE)} before ` +
      "it — reset sets torpedoCharge to 1 (specs/instrumentation.md)",
  );
});
