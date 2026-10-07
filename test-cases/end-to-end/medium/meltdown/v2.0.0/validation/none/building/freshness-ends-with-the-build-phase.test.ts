// building/freshness-ends-with-the-build-phase — a tower stops being fresh on the
// frame the wave starts.
//
// specs/building.md, Freshness: "A tower placed while the phase is `opening` or
// `building` is fresh from the frame it lands. It stops being fresh on the frame that
// phase becomes `wave`."
//
// THE TRANSITION IS REACHED THE WAY THE RUN REACHES IT, and that is the whole point
// of this item. `setPhase` "sets that field alone and runs no entry effect. Neither
// resets a menu index, pays interest or a wave-clear bonus, grants a score, changes
// any tower's freshness, releases or clears a wave, or plays a cue"
// (specs/instrumentation.md), so posing `"wave"` would grade nothing at all: it is
// specified NOT to touch freshness. So the build timer is what ends the phase, which
// specs/waves.md fixes — "Reaching 0 starts the wave" — with the world gate opened
// for exactly that, since specs/instrumentation.md makes "the build timer's automatic
// start of the next wave when it reaches 0" the gate's own business.
//
// THE TIMER IS POSED SHORT rather than run down from fifteen seconds. How fast the
// timer falls is `waves/build-timer-counts-down`'s requirement; this item is the
// freshness, and a second of game time is all it needs to cross the boundary.
//
// THE TOWER IS PLACED, because the specification's first bullet is about a tower
// placed in a build phase, and the fresh reading before the transition is what makes
// the reading after it mean something: a build that never marks a tower fresh at all
// fails the first half rather than passing the second by accident.
//
// ITS GUNS ARE HELD. Opening the gate means the wave releases its first unit on the
// frame it begins (specs/waves.md), and the tower stands six tiles clear of both
// corridors — but `setTowerFiring(id, false)` makes that irrelevant rather than
// merely unlikely: nothing this tower does can be about combat, so nothing about the
// unit that arrives can reach the reading. Its thermal model is left running, since
// an idle tower's heat is nothing this item reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { placeAt, requirePlaced } from "./preview";

/** The tower placed, on a quiet anchor six tiles clear of both corridors. */
const HELD = "arc";
const AT = FREE_SITE;

/** Enough money that affordability is never what refuses the placement. */
const PURSE = 200;

/**
 * The seconds left on the build timer when the gate is opened.
 *
 * Short enough that one sweep crosses it and long enough that the phase is still
 * `building` when the tower is placed, so the "placed while building" half of the
 * rule is genuinely the half being posed.
 */
const TIMER = 0.5;

/**
 * How long the sweep waits for the transition, in seconds of game time.
 *
 * Four times the timer posed above. A build whose timer falls at the one second per
 * second specs/waves.md fixes crosses it in {@link TIMER}; a build that never starts
 * the wave is reported for that rather than hanging.
 */
const SWEEP_SECONDS = 4 * TIMER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("clears freshness on the frame the build phase becomes a wave", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  const id = requirePlaced(
    await placeAt(h, HELD, AT.col, AT.row),
    `a ${HELD} on open floor at (${AT.col}, ${AT.row})`,
  );
  await h.debug.setTowerFiring(id, false);

  const placed = await h.snapshot();
  assertEqual(placed.phase, "building", "the phase the tower was placed in");
  assertEqual(
    requireTower(placed, id, "the tower just placed").fresh,
    true,
    `whether a ${HELD} placed in a building phase is fresh`,
  );

  // The run's own way into the wave phase: the timer runs out with the gate open.
  await h.debug.setBuildTimer(TIMER);
  await h.debug.setWaveSpawning(true);
  const swept = await h.until((snapshot) => snapshot.phase === "wave", {
    maxFrames: Math.ceil(SWEEP_SECONDS * 120),
  });

  await captureStill(h, "stale");

  assertTrue(
    swept.hit,
    `the phase to become "wave" within ${SWEEP_SECONDS} s of game time of a ` +
      `build timer posed at ${TIMER} s with wave spawning on (specs/waves.md)`,
  );
  assertEqual(
    requireTower(swept.snapshot, id, "once the wave began").fresh,
    false,
    `whether the ${HELD} is still fresh once the phase became "wave"`,
  );
});
