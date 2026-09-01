// progression/body-costs-life — a drone's body costs ONE life.
//
// specs/progression.md prices it in its table: "Any drone's body reaches the
// ship, of either band | One life", under the arithmetic the whole table runs on
// — "One event costs exactly one life, whatever else is on the field at that
// instant."
//
// SO THIS POINT IS ABOUT THE PRICE. That a body is lethal whatever band it
// carries is `bands.body-always-lethal-same-band`'s and
// `bands.body-always-lethal-opposite`'s; what the loss then opens is
// `progression.ready-hold`'s. This one reads the count on the FIRST FRAME IT
// MOVED and requires exactly one off it, which is where a build that resolves the
// same body twice in a frame reads two off and a build that prices a body as a
// whole run reads none.
//
// THE BODY IS PUT WHERE THE RULE APPLIES, AND NOT FLOWN THERE. Its centre is
// posed ON the ship's, which is a contact under any reach a build tests with, and
// its LOCOMOTION IS OFF. Letting a posed drone dive the last few units into the
// hull instead would decide this point on the dive's path, and specs/swarm.md
// leaves that path to the build outright — "a smooth swooping path of your
// design". A build whose diving locomotion drives its drone along a curve
// anchored at the slot it launched from is entirely conformant, and would carry a
// drone posed above the ship AWAY from it on the first frame; that build must
// fail its dive points, not this one. With locomotion gated,
// specs/instrumentation.md has the drone "hold its exact center and keep its
// phase", so nothing but the rule under test can move anything this check reads.
//
// THE PHASE IS `diving`, not `formation`. A formation slot sits at `y` 140–332
// (specs/field.md), so a formation drone at `SHIP_Y` (`600`) is a state the
// game's own geometry never produces, and a build that scopes its body contact to
// drones that have left the formation would fail here over a situation no player
// can reach. `diving` is the phase in which a body genuinely arrives at the ship.
//
// ITS BAND CLOCK AND ITS FIRING ARE OFF TOO. A shot taken on the way in would be
// an enemy bullet reaching the ship, which is a different row of the same table
// and a different point.
//
// THE BAND IS THE ONE OPPOSITE THE SHIP'S, so the reading is the plain price of a
// body rather than a question about the hull's shield — the shield filters
// bullets, and specs/bands.md says a body is not filtered at all.
//
// THE FIELD HOLDS NOTHING ELSE: no bullet, no second drone, and the wave's own
// entry and dive launching are shut, so the life count can only move for the
// contact under test.

import { afterEach, beforeEach, it } from "vitest";
import {
  READY_HOLD,
  SHARD_HALF,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, and the band the body carries. */
const SHIP_BAND = "cyan" as const;
const DRONE_BAND = "magenta" as const;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + SHARD_HALF;

/**
 * Frames the contact is given to resolve, in frames of the 120 Hz clock.
 *
 * `0.25` s. The body is already on the ship when the frames start, so the rule
 * applies on the first update that runs; the window is the room a build gets to
 * resolve a contact it noticed on the frame before, and 30 frames is far more
 * than any build needs. It is well short of `READY_HOLD` (`1.3` s), so the hold
 * the loss opens cannot end and put the returning ship back onto the body that is
 * still standing there for a second charge.
 */
const CONTACT_TICKS = ticksFor(0.25);

/** Lives before the contact, and the one specs/progression.md leaves after it. */
const LIVES_BEFORE = START_LIVES;
const LIVES_AFTER = LIVES_BEFORE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly one life when a drone body reaches the ship", async () => {
  startPosed(h);
  // The one world gate this point's requirement IS: with the hull's contact test
  // shut no body of any band could cost anything, and the sweep below would fail
  // on every build.
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(LIVES_BEFORE);
  poseDrone(h, "shard", LANE_CENTER, SHIP_Y, {
    band: DRONE_BAND,
    phase: "diving",
  });

  const posed = h.snapshot();
  assertEqual(posed.lives, LIVES_BEFORE, "the lives the run was posed with");
  assertEqual(
    posed.ship.band,
    SHIP_BAND,
    "the band the ship was posed holding, opposite the body's",
  );

  // Sampled every frame, so what comes back is the state on the FIRST frame the
  // count moved.
  const struck = await h.until((s) => s.lives !== LIVES_BEFORE, {
    maxFrames: CONTACT_TICKS,
  });
  captureStill(h, "cost");

  assertEqual(
    struck.hit,
    true,
    `a ${DRONE_BAND} Shard whose centre is on a ${SHIP_BAND} ship's own ` +
      `centre — no separation at all, against the ${TOUCHING} units at which ` +
      "the two footprints already overlap — moving the life count inside " +
      `${CONTACT_TICKS} frames (${seconds(CONTACT_TICKS)} s), with its ` +
      "locomotion gated off so it holds that centre " +
      "(specs/progression.md: any drone's body reaching the ship costs a life)",
  );
  assertEqual(
    struck.snapshot.lives,
    LIVES_AFTER,
    `the lives on the frame the count moved, from ${LIVES_BEFORE} — ` +
      "specs/progression.md: one event costs exactly one life, whatever else " +
      `is on the field at that instant. ${LIVES_BEFORE - 2} is one body ` +
      `charged twice in the frame it arrived, and ${LIVES_BEFORE} inside ` +
      `READY_HOLD ${READY_HOLD} s is a build that prices a body at nothing`,
  );
});
