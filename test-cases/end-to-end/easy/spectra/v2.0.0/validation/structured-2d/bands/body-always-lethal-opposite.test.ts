// bands/body-always-lethal-opposite — a body of the opposite band costs a life.
//
// specs/bands.md: "A drone's body is not filtered by the shield. Contact between
// the ship and any drone's body, of either band and whatever the ship is tuned to,
// hits the ship." specs/progression.md prices it: "Any drone's body reaches the
// ship, of either band | One life."
//
// THIS IS THE BAND A BUILD IS MOST LIKELY TO GET RIGHT and the one it must not get
// wrong: a drone of the band OPPOSITE the ship's is lethal on contact exactly as
// its bullets are. The same-band half is the sibling
// `bands.body-always-lethal-same-band`, so a build that charges for one band only
// fails the band it drops rather than passing on an average.
//
// HOW THE BODY REACHES THE SHIP. The drone is posed with its centre on the ship's,
// in phase `diving` — the phase a body reaches the ship in during play — with
// every faculty off, so nothing but the build's own contact test decides what
// follows. It is NOT flown there: specs/swarm.md lets a dive end "by turning back
// above `FIELD_BOTTOM`", so a build whose dives turn back above `SHIP_Y` (`600`)
// is conformant and would never deliver a body by flight.
//
// THE WORLD IS THE SHIP AND ONE DRONE. `startPosed` empties the rosters and shuts
// the three world gates; only the ship's contact test is turned back on, because
// it is this point's requirement. Nothing else is on the field, so the life count
// can only move for the contact under test.

import { afterEach, beforeEach, it } from "vitest";
import { READY_HOLD, SHIP_Y, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, which `startPosed` poses. */
const SHIP_BAND = "cyan" as const;

/** The band the drone carries: the opposite one. */
const DRONE_BAND = "magenta" as const;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs a life when a drone of the opposite band reaches it", async () => {
  startPosed(h);
  h.debug.setShipContact(true);

  const posed = h.snapshot();
  assertEqual(posed.ship.band, SHIP_BAND, "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  poseDrone(h, "shard", posed.ship.x, SHIP_Y, {
    band: DRONE_BAND,
    phase: "diving",
  });

  const struck = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_TICKS,
  });
  captureStill(h, "hit");

  assertEqual(
    struck.hit,
    true,
    `a ${DRONE_BAND} drone body standing on a ${SHIP_BAND} ship costing a life ` +
      `within ${CONTACT_TICKS} frames (specs/bands.md)`,
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    `the lives left after one opposite-band body reached the ship, which costs ` +
      `exactly one (specs/progression.md); the ready beat is ` +
      `${ticksFor(READY_HOLD)} frames long, so no second charge is possible ` +
      `inside this sweep`,
  );
});
