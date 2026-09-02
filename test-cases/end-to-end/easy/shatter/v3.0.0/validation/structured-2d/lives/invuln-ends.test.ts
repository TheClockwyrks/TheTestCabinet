// lives/invuln-ends — contact comes back when the respawn grace runs out.
//
// THE RULE. `specs/progression.md`: "Lethal contact resumes on the tick the
// grace reaches `0`." This is the opposite direction of
// `lives/invuln-ignores-a-rock`, and the two are separate items on purpose: a
// build that never suspends contact passes this one and fails that one, a build
// that suspends it forever fails this one and passes that one, and a build with
// no window at all fails both — so a grade names which half is wrong.
//
// THE SAME ROCK, THE SAME GROUND, THE SAME CLOSING SPEED as the item next door.
// The one thing that differs is the grace: there it is posed at `2.0` seconds
// and outlasts the pass, here it is posed at `0.5` and is run down to nothing
// BEFORE the rock is put up.
//
// WHY THE WINDOW IS RUN OUT FIRST RATHER THAN TIMED AGAINST THE ROCK. A rock
// launched at the start and timed to arrive after the window would make the
// verdict depend on how long the flight took, and the flight is the build's:
// gravity, however faithfully it is implemented, moves a body over a second of
// travel. Running the window down on an empty field and ASSERTING it at `0`
// makes "after the grace has run out" a fact about the scenario rather than an
// estimate — and the rock then lands a sixth of a second later, which is as
// close to the instant the window closed as a body that has to travel can be
// brought.
//
// THE WINDOW IS RUN DOWN BY WATCHING IT, not by advancing the seconds it was
// posed with, so that HOW FAST a build counts its grace down cannot decide this
// item. That rate is `lives/invuln-counts-down`; a build that runs its window at
// half speed loses that point and is still asked this one honestly, because the
// rock goes in when the window this build kept actually reaches zero.
//
// The contact gate is on and asserted on, the field holds the ship and the one
// rock and nothing else, and the counter is read on the tick it falls: exactly
// one life, for the reason `lives/a-rock-costs-a-life` states.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, START_LIVES, TICK_HZ } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  rockById,
  ticksFor,
  type Harness,
} from "../harness";
import { poseClosingRock, poseDuel, watchContact } from "./duel";

/**
 * The grace the window is opened at, in seconds.
 *
 * Short, so the whole drive — the window running down and the contact landing —
 * fits inside one replay, and long enough that a build's own countdown has to
 * run for sixty ticks before the window closes.
 */
const POSED_GRACE = 0.5;

/**
 * The most game time the posed window is given to run out in.
 *
 * Three times the `0.5` s it was posed with, so a build whose grace runs slow is
 * still measured on the rule this item is about rather than on its rate — and
 * the whole drive stays inside one replay.
 */
const GRACE_TICKS = ticksFor(POSED_GRACE * 3);

/**
 * The ceiling on the watch after the rock is put up.
 *
 * The rock crosses its `STANDOFF` (40) of surface gap at `CLOSING_SPEED` (240)
 * in a sixth of a second. Half a second bounds a build whose rocks do not travel
 * without hanging the suite.
 */
const CONTACT_TICKS = ticksFor(0.5);

/** More of the field after the contact, filmed for the replay. */
const DWELL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends a life when a rock reaches a ship whose grace has run out", async () => {
  poseDuel(h);
  h.debug.setShipInvuln(POSED_GRACE);

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
    "setShipInvuln to be reported by the snapshot before the window runs " +
      "down (specs/instrumentation.md)",
  );

  const watch = await captureReplay(h, "grace", async () => {
    const closed = await h.until((snapshot) => snapshot.ship.invuln === 0, {
      maxFrames: GRACE_TICKS,
    });
    assertTrue(
      closed.hit,
      "the posed respawn grace running out within " +
        `${(GRACE_TICKS / TICK_HZ).toFixed(1)} s of game time, which is what ` +
        "the contact below is timed against (specs/progression.md)",
    );

    const rockId = poseClosingRock(h);
    const seen = await watchContact(h, {
      maxTicks: CONTACT_TICKS,
      radius: ROCK_RADIUS.small,
      read: (snapshot) => rockById(snapshot, rockId),
    });
    await h.advance(DWELL_TICKS);
    return seen;
  });

  assertTrue(
    watch.lostAt >= 0,
    "the rock reaching a ship whose grace had run out to destroy it — " +
      "lethal contact resumes on the tick the grace reaches 0 " +
      "(specs/progression.md)",
  );
  assertEqual(
    watch.end.lives,
    START_LIVES - 1,
    "the ships left after the contact landed — losing a ship costs one life " +
      "(specs/progression.md)",
  );
});
