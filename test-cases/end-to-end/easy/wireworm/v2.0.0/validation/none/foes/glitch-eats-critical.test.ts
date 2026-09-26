// foes/glitch-eats-critical — a glitch removes a critical node without
// detonating it.
//
// `specs/foes.md`: "A glitch removes the node on the tile its center occupies,
// whatever that node's charge. A critical node eaten this way is removed without
// detonating, so no discharge fires and no arc is reported."
//
// The two clauses are ONE SCENARIO READ TWICE rather than two requirements:
// eating and detonating leave the eaten tile in the same state — empty — so the
// tile alone cannot tell them apart. What tells them apart is a WITNESS.
// `specs/discharge.md` fixes a detonation as arcing to every node at charge `1`
// or above whose tile lies within `DISCHARGE_RADIUS` (`2`) tiles, each of which
// is itself detonated and removed, so a charged node exactly that far away
// survives an eating and would not survive a discharge.
//
// The witness is posed at charge `2`, the one value from which every wrong model
// reads as a different number: a discharge leaves the tile EMPTY, a build that
// de-energizes the neighbourhood leaves `1`, a build that slammed it leaves `3`,
// and only a build that ate the critical node without detonating leaves `2`. The
// live arcs are read on the same frame, since `specs/discharge.md` keeps an arc
// for `ARC_LIFE` from the moment the chain resolves, so a chain that fired on
// the frame the node went is still reporting its links then.
//
// The glitch is posed with its locomotion held, so it acts on exactly the tile
// it was placed on (`specs/foes.md`) and cannot wander onto the witness.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, DISCHARGE_RADIUS } from "../constants";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  framesFor,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { untilTileChanges } from "./watching";

/** The tile the glitch stands on, with the critical node beneath it. */
const TILE_C = 10;
const TILE_R = 8;

/**
 * The witness: charged, and exactly `DISCHARGE_RADIUS` tiles away, so it stands
 * on the edge of the block a detonation of the eaten node would reach.
 */
const WITNESS_C = TILE_C + DISCHARGE_RADIUS;
const WITNESS_R = TILE_R;

/** The charge it is posed at: the value from which every wrong model differs. */
const WITNESS_CHARGE = 2;

/**
 * How long the glitch is given to act at all, in seconds.
 *
 * `specs/foes.md` fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure derived from one: a quarter second is every chance a build needs
 * to act on the single tile it is standing on. What is graded is the first
 * change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes a critical node without firing a discharge", async () => {
  await startPlaying(h);
  await h.debug.setNode(TILE_C, TILE_R, CHARGE_MAX);
  await h.debug.setNode(WITNESS_C, WITNESS_R, WITNESS_CHARGE);
  await poseFoe(h, "glitch", TILE_C, TILE_R, { travel: false });

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    framesFor(ACT_SECONDS),
  );

  await captureStill(h, "eaten");
  assertNull(
    change.now,
    `the glitch's first act on the charge-${CHARGE_MAX} node on (${TILE_C}, ` +
      `${TILE_R}) removes it, leaving that tile empty`,
  );
  assertLength(
    change.snapshot.arcs,
    0,
    "no discharge fired on the frame the critical node went, so no arc is " +
      "reported",
  );
  assertEqual(
    chargeAt(change.snapshot, WITNESS_C, WITNESS_R),
    WITNESS_CHARGE,
    `the charge-${WITNESS_CHARGE} node ${DISCHARGE_RADIUS} tiles away is ` +
      `untouched, so no chain reached it`,
  );
});
