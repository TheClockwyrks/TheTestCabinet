// lives/invuln-ignores-a-rock — a rock passes harmlessly over a ship inside its
// respawn grace.
//
// THE RULE. `specs/progression.md` gives a respawned ship a window through which
// it "ignores the three lethal contacts", and `specs/collision.md` says it from
// the other side: "The ship's destruction is subject to the respawn grace
// specs/progression.md states: inside that window the three lethal pairs above
// cost nothing and the ship passes through unharmed." This item decides the
// window's SUSPENSION of the rock's pair; that contact comes back when the
// window closes is `lives/invuln-ends`, the opposite direction and its own item.
//
// THE CONTACT GATE IS ON, which is what makes this a reading at all. A ship
// whose lethal contact test was simply switched off would also survive, so the
// gate `specs/instrumentation.md` describes as the contact test itself is
// switched ON and asserted on before a tick runs. The only thing standing
// between the rock and the ship is the grace.
//
// THE PASS IS PROVEN, NOT ASSUMED. A build that never brings the two bodies
// together survives for a reason that has nothing to do with the grace, so every
// tick of the approach is sampled and the closest the ROCK'S PATH came to the
// ship's centre is read — the distance to the segment between two samples rather
// than to the samples, since the closest point of a path lies between them — and
// that closest approach must be inside `SHIP_R + ROCK_RADIUS.small` (28), which
// is contact as `specs/collision.md` defines it. If anything at all could have
// destroyed the ship on this pass, it would have.
//
// THE WINDOW IS POSED WIDE ENOUGH TO OUTLAST THE PASS. `setShipInvuln(2.0)` is
// what the item names, and the whole approach takes under half a second, so the
// grace is asserted still running at the end: what the ship survived, it
// survived INSIDE the window rather than after it.
//
// The ship is posed at rest, because none of this is about how the ship flies:
// `duel.ts` puts it on quiet ground 385 units from the star, where the well
// never touches it and the core is nowhere near.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R, START_LIVES } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { createHarness, rockById, ticksFor, type Harness } from "../harness";
import { poseClosingRock, poseDuel, watchContact } from "./duel";

/** The grace the ship is posed inside, in seconds. The figure the item names. */
const POSED_GRACE = 2.0;

/** Contact, as `specs/collision.md` defines it for a ship and a Small. */
const CONTACT = SHIP_R + ROCK_RADIUS.small;

/**
 * How long the pass is watched.
 *
 * The rock crosses its `STANDOFF` (40) of surface gap at `CLOSING_SPEED` (240)
 * in a sixth of a second and is clear of the ship a tenth of a second later.
 * Half a second covers the whole pass and is a quarter of the posed window, so
 * the grace cannot run out underneath the reading.
 */
const PASS_TICKS = ticksFor(0.5);

/** The surface gap the picture is kept at: the tick the rock is over the ship. */
const PASS_PICTURE_GAP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life when a rock reaches a ship inside its grace", async () => {
  poseDuel(h);
  h.debug.setShipInvuln(POSED_GRACE);
  const rockId = poseClosingRock(h);

  const armed = h.snapshot();
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running, so the grace is the only thing " +
      "standing between the rock and the ship (specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.invuln,
    POSED_GRACE,
    "setShipInvuln to be reported by the snapshot before the pass " +
      "(specs/instrumentation.md)",
  );

  const watch = await watchContact(h, {
    maxTicks: PASS_TICKS,
    radius: ROCK_RADIUS.small,
    read: (snapshot) => rockById(snapshot, rockId),
    follow: true,
    still: { id: "grace", gap: PASS_PICTURE_GAP },
  });

  assertLessThanOrEqual(
    watch.closest,
    CONTACT,
    "the rock's path really reaching the ship, within SHIP_R + " +
      "ROCK_RADIUS.small (specs/collision.md)",
  );
  assertGreaterThan(
    watch.end.ship.invuln,
    0,
    "the grace still running at the end of the pass, so the whole pass " +
      "happened inside the window (specs/progression.md)",
  );
  assertEqual(
    watch.end.lives,
    START_LIVES,
    "the ships the run still has after a rock crossed a ship inside its " +
      "respawn grace — inside that window the lethal pairs cost nothing " +
      "(specs/collision.md)",
  );
});
