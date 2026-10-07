// bands/body-always-lethal-same-band — a body is never mistaken for a shield.
//
// specs/bands.md, immediately after the shield table: "A drone's body is not
// filtered by the shield. Contact between the ship and any drone's body, of
// either band and whatever the ship is tuned to, hits the ship."
// specs/progression.md prices it the same way: "Any drone's body reaches the
// ship, of either band | One life."
//
// THE BAND UNDER TEST IS THE SHIP'S OWN, which is the wrong-model case. A build
// that runs a drone's body through the same filter its bullets go through absorbs
// this contact and pays nothing, and that mistake is readable HERE and nowhere
// else: it passes `bands.body-always-lethal-opposite` untouched. Reading the two
// bands as two points is what makes a build that charges for one band only fail
// the band it drops instead of averaging out.
//
// HOW THE BODY REACHES THE SHIP. The drone is posed with its centre on the
// ship's, in phase `diving` — the phase a body reaches the ship in during play —
// with every faculty off, so nothing but the build's own contact test decides
// what follows. It is NOT flown there: specs/swarm.md lets a dive end "by turning
// back above `FIELD_BOTTOM`", so a build whose dives turn back above `SHIP_Y`
// (`600`) is conformant and would never deliver a body by flight, and
// specs/swarm.md leaves the path itself to the build outright. Posing the overlap
// demands nothing a build does not owe and reaches the requirement directly.
//
// THE PHASE IS `diving`, NOT `formation`. A formation slot sits at `y` 140–332
// (specs/field.md), so a formation drone at `SHIP_Y` (`600`) is a state the
// game's own geometry never produces, and a build that scopes its body contact to
// drones that have left the formation would fail here over a situation no player
// can reach.
//
// THE WORLD IS THE SHIP AND ONE DRONE. `startPosed` empties the rosters and shuts
// the three world gates; only the ship's contact test is turned back on, because
// it is this point's requirement. No bullet and no second drone is on the field,
// so the life count can only move for the contact under test, and the drone's own
// firing stays off — a shot reaching the ship would be the shield's reading and a
// different point's.

import { afterEach, beforeEach, it } from "vitest";
import {
  READY_HOLD,
  SHARD_HALF,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, which the drone below carries with it. */
const SHARED_BAND = "cyan" as const;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + SHARD_HALF;

/**
 * Frames the contact is given to resolve, in frames of the suite's clock.
 *
 * A twentieth of a second. specs/simulation.md resolves contacts at the end of
 * EVERY sub-step, and the overlap stands from the moment the drone is posed, so a
 * conformant build resolves it on the first update that runs; the window is the
 * room a build gets to resolve a contact it noticed on the frame before. It is
 * far inside `READY_HOLD` (`1.3` s, specs/progression.md), so the beat the loss
 * opens cannot end and put the returning ship back onto the body still standing
 * there for a second charge. Stated in seconds rather than in frames, so the same
 * requirement is read to the same amount of GAME TIME under all three engines,
 * whose harness clocks differ.
 */
const CONTACT_TICKS = ticksFor(0.05);

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

it("takes one life when a cyan Shard's body reaches a cyan ship", async () => {
  startPosed(h);
  // The one world gate this point's requirement IS: with the hull's contact test
  // shut no body of any band could cost anything, and the sweep below would fail
  // on every build.
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHARED_BAND);
  h.debug.setLives(LIVES_BEFORE);

  const posed = h.snapshot();
  assertEqual(
    posed.ship.band,
    SHARED_BAND,
    "the band the ship was posed on, which is what makes the body below a " +
      "SAME-band one",
  );
  assertEqual(
    posed.lives,
    LIVES_BEFORE,
    "the lives the run was posed with, which is the number the reading below " +
      "is measured against",
  );

  poseDrone(h, "shard", posed.ship.x, SHIP_Y, {
    band: SHARED_BAND,
    phase: "diving",
  });

  // Sampled every frame, so what comes back is the state on the FIRST frame the
  // count moved.
  const struck = await h.until((s) => s.lives < LIVES_BEFORE, {
    maxFrames: CONTACT_TICKS,
  });
  captureStill(h, "hit");

  assertEqual(
    struck.hit,
    true,
    `a ${SHARED_BAND} Shard whose centre is on a ${SHARED_BAND} ship's own ` +
      `centre — no separation at all, against the ${TOUCHING} units at which ` +
      "the two footprints already overlap — costing a life inside " +
      `${CONTACT_TICKS} frames (${seconds(CONTACT_TICKS)} s), with its ` +
      "locomotion gated off so it holds that centre (specs/bands.md: a drone's " +
      "body is not filtered by the shield, whatever the ship is tuned to)",
  );
  assertEqual(
    struck.snapshot.lives,
    LIVES_AFTER,
    `the lives on the frame the count moved, from ${LIVES_BEFORE} — a ` +
      "same-band body costs exactly one (specs/progression.md); the ready " +
      `beat is ${ticksFor(READY_HOLD)} frames long, so no second charge is ` +
      "possible inside this sweep",
  );
});
