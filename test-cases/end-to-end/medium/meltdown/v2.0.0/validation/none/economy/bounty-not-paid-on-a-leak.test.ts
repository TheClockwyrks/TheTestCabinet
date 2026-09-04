// economy/bounty-not-paid-on-a-leak — a unit that reaches its exhaust pays
// nothing.
//
// `specs/economy.md`, under the income table: "A unit that reaches its exhaust
// pays no bounty." The Bounty line is paid "On the frame a unit's hp reaches
// `0`", and a leak is not that frame.
//
// THE FLOOR IS EMPTY BUT FOR THE LEAKER, and that is what makes the reading
// unambiguous. With no tower standing there is no damage path at all, so the
// only way the unit can leave the roster is by reaching its exhaust — which is
// why this point can read a removal as a leak without asserting anything about
// what a leak costs in lives, a figure `specs/surge.md` fixes and the `surge`
// group decides.
//
// THE LEAKER IS POSED ONE TILE SHORT OF ITS EXHAUST (`economy/payment.ts`) and
// walks the last tile under its own power, so the leak is the game's own
// transition rather than a state posed on top of it. Its route is recomputed
// from the tile it is placed on (`specs/instrumentation.md`), and a unit entering
// at the left vent is assigned the right exhaust for its whole life
// (`specs/floor.md`), so the tile it is posed on is one step from the opening it
// must leave through.
//
// THE PHASE IS `building`. A wave clears only while the phase is `wave`
// (`specs/waves.md`), and a leak that cleared a wave would pay the clear bonus
// into the money — a payment this point would then read as a bounty. In a build
// phase the leak pays whatever a leak pays, and nothing else can pay anything.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a bounty whenever a unit
// leaves the roster reads `3`, the Mote's bounty; one that pays the bounty on
// the exhaust as a consolation reads whatever it chose. Anything but `0` is a
// build paying for a unit that got away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./payment";

/**
 * What the leak must add to the money: nothing at all.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number
 * and `specs/economy.md` fixes the figure exactly, so the assertion is equality.
 */
const EXPECTED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds nothing to the money when a unit reaches its exhaust", async () => {
  await startRun(h);
  await poseLeaker(h);

  const before = (await h.snapshot()).money;
  const leaked = await runUntilLeaked(h);

  await captureStill(h, "leak");
  const after = (await h.snapshot()).money;

  assertTrue(
    leaked,
    "precondition: the Mote reached its exhaust and left the floor",
  );
  assertEqual(after - before, EXPECTED, "the money a leaked Mote paid");
});
