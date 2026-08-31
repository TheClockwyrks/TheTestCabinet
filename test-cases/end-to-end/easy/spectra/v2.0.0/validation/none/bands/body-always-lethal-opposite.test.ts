// bands/body-always-lethal-opposite — a body of the opposite band costs a life.
//
// specs/bands.md: "Contact between the ship and any drone's body, of either band
// and whatever the ship is tuned to, hits the ship." specs/progression.md prices
// it: any drone's body reaching the ship costs one life.
//
// This is the band half a build is most likely to get right and the one it must
// not get wrong: a drone of the band OPPOSITE the ship's is lethal on contact
// exactly as its bullets are. The same-band half is the sibling
// `bands/body-always-lethal-same-band`, so a build that charges for one band only
// fails the band it drops rather than passing on an average.
//
// HOW THE BODY REACHES THE SHIP. The drone is posed with its centre on the
// ship's, in phase `diving` — the phase a body reaches the ship in during play —
// with every faculty off, so nothing but the build's own contact test decides
// what follows. It is not flown there: specs/swarm.md lets a dive end "by turning
// back above `FIELD_BOTTOM`", so a build whose dives turn back above `SHIP_Y`
// (600) is conformant and would never deliver a body by flight.
//
// The field holds nothing else, and the wave's own entry and dive launching are
// shut, so the life count can only move for the contact under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SHIP_Y, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Frames the contact is given to resolve.
 *
 * The overlap stands from the moment the drone is posed, so a build resolves it
 * in the first frame it runs; four frames leave room for one that resolves
 * contact after its motion step, and stop the sweep long before `READY_HOLD`
 * (1.3 s) could end and expose the ship to a second charge.
 */
const CONTACT_FRAMES = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("costs a life when a drone of the opposite band reaches it", async () => {
  await startPosed(harness);
  await harness.debug.setShipContact(true);
  const posed = await harness.snapshot();
  assertEqual(posed.ship.band, "cyan", "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  await poseDrone(harness, "shard", posed.ship.x, SHIP_Y, {
    band: "magenta",
    phase: "diving",
  });

  const struck = await harness.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_FRAMES,
  });
  await captureStill(harness, "hit");

  assertEqual(
    struck.hit,
    true,
    "a drone body of the band opposite the ship's costing a life (specs/bands.md)",
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    "the lives left after one opposite-band body reached the ship",
  );
});
