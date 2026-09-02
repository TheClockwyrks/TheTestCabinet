// saucer/wraps-top-and-bottom — a saucer driven off the top edge comes back at
// the bottom.
//
// THE RULE. `specs/saucer.md`: the saucer "wraps at the top and bottom edges like
// any body", and `specs/field.md` fixes what that means for every body — "`y`
// modulo `FIELD_H`", with "a body leaving the bottom re-entering at the top, and
// the reverse", carrying its velocity across unchanged. So a saucer posed near
// the top, driven upward for a whole second, must be found the same distance
// BELOW the bottom edge that a build without the wrap would have found it above
// the top one.
//
// THE READING IS THE POSITION THE WRAP PREDICTS, not merely "it is somewhere near
// the bottom". A build that clamps at the edge reads `0` against an expected
// `660`; a build that removes a saucer for leaving the field has no saucer to
// read at all, which `specs/field.md` forbids in as many words ("nothing is ever
// removed for leaving it"); and a build that reflects reads `60`. Each of the
// three is a different number, so a failure names which of them the build
// implemented.
//
// ITS MIND IS OFF, WHICH IS WHAT MAKES THE PREDICTION POSSIBLE. With the weave
// running, the vertical velocity this check poses would be replaced a second in
// and the arithmetic would be the build's rather than the specification's. The
// gun is off for the usual reason. Its travel is on, because the travel is the
// requirement.
//
// WHERE IT IS FLOWN. Down the column `x = 200`, `440` units from the star and
// with no horizontal velocity at all, so the crossing stays in its own column and
// the core — which `specs/saucer.md` has the saucer steer clear of, through the
// mind this check has switched off — is never anywhere near it.
//
// WHY TWO UNITS. A tick of this drift is `0.75` units, so a build that closes its
// wrap a tick either side of where this one counts it is inside the bound and
// every wrong model above is outside it by hundreds.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, SAUCER_WEAVE_SPEED } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { foldY, wrapY } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the drift begins: near the top edge, in a column far from the star. */
const START = { x: 200, y: 30 };

/**
 * The velocity it is driven off the top at: `90` units per second, upward.
 *
 * The one vertical figure `specs/saucer.md` puts on the saucer, borrowed as a
 * plausible pose rather than asserted: `setSaucerVelocity` takes any velocity,
 * and what this check needs from it is only that a second of it carries the craft
 * past an edge.
 */
const DRIFT = -SAUCER_WEAVE_SPEED;

/** The second of game time the drift is run for. */
const DRIFT_TICKS = ticksFor(1);

/** Where `specs/field.md`'s wrap puts it: `wrapY(30 - 90)` = `660`. */
const EXPECTED_Y = wrapY(START.y + DRIFT);

/** Two units, which is under three ticks of this drift. See the header. */
const WRAP_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters at the bottom edge when it is driven off the top", async () => {
  startPlaying(h);
  poseVisit(h, START.x, START.y, {
    vx: 0,
    vy: DRIFT,
    mind: false,
    gun: false,
  });

  await h.advance(DRIFT_TICKS);
  const wrapped = theSaucer(h.snapshot(), "wraps-top-and-bottom");
  captureStill(h, "wrap");

  // IT REALLY LEFT THE FIELD BY THE TOP. Read as a shortest wrapped separation
  // alone, a saucer clamped at the top edge and a saucer that wrapped are two
  // different rows and the reading tells them apart — but only because the
  // arithmetic happens to work out. Reading the half of the field it stands in
  // says it directly.
  assertGreaterThan(
    wrapped.y,
    FIELD_H / 2,
    `the saucer's centre y after ${String(DRIFT_TICKS)} ticks climbing at ` +
      `${String(-DRIFT)} units per second from y = ${String(START.y)} — it ` +
      "left the top edge and must stand in the bottom half of the field " +
      "(specs/field.md)",
  );

  assertLessThanOrEqual(
    Math.abs(foldY(wrapped.y - EXPECTED_Y)),
    WRAP_TOLERANCE,
    `how far the saucer stood from ${EXPECTED_Y}, the row specs/field.md's ` +
      "wrap puts it on",
  );

  // AND THE OTHER AXIS IS UNTOUCHED. `specs/field.md` wraps each axis on its own,
  // so a build that carries the saucer round the top and slides it along the row
  // as it goes has not wrapped it, it has moved it.
  assertLessThanOrEqual(
    Math.abs(wrapped.x - START.x),
    WRAP_TOLERANCE,
    `how far the saucer's centre x moved from the column ${String(START.x)} it ` +
      "was flown along — a vertical wrap leaves the other axis exactly as it " +
      "was (specs/field.md)",
  );
});
