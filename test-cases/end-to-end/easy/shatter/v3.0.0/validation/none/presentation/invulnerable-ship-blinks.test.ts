// presentation/invulnerable-ship-blinks — a ship inside its respawn grace reads as
// protected, and reads normal again once the grace is spent.
//
// THE RULE. `specs/overview.md`: "A ship inside its respawn grace reads as such: its
// drawn appearance changes visibly while the grace runs and settles once it ends."
// `specs/progression.md` says the same beside the figure: the next ship appears with
// `INVULN_TIME` (`2.5` seconds) of grace, "and its drawn appearance shows that the
// grace is running". Without it the player cannot tell the two and a half seconds
// they can fly through a rock from the moment lethal contact resumes.
//
// WHAT IS READ, AND AGAINST WHAT. The same ship is read TWICE OVER: once with no
// grace at all, which is the STEADY appearance, and then repeatedly across the whole
// grace window. Reading one ship against itself is what makes the comparison mean
// anything, since `specs/overview.md` leaves the whole look to the build and there is
// no second ship and no palette to compare against. Nothing moves between the
// readings: the star does not pull the ship (`specs/ship.md`), it is posed at rest,
// and no key is held.
//
// AND WHY A COUNT OF CHANGED SAMPLES RATHER THAN A BRIGHTNESS OR A PIXEL COUNT.
// `specs/overview.md` requires the appearance to CHANGE and fixes no way of changing
// it, so a build blinking by colour, by outline weight or by alpha is conformant —
// and the last two keep the ship's drawn area very nearly constant, so anything
// counting lit pixels would fail them. What every one of those has in common is that
// samples inside the hull read differently, which is what is counted here.
//
// THE TWO DIRECTIONS, WHICH ARE THE RULE'S OWN TWO CLAUSES:
//
//   - IT CHANGES WHILE THE GRACE RUNS. At some sampled instant of the window, at
//     least `MIN_CHANGED` of the samples inside `SHIP_R` have moved from the steady
//     reading. One instant rather than all of them, because a build is free to blink
//     — half its window looks exactly like the steady ship — and a build is equally
//     free to hold one changed look for the whole window. Both pass; a ship that
//     never changes at all does not.
//   - AND IT SETTLES ONCE THE GRACE ENDS. Once the window has run out the ship reads
//     as the steady ship again, within `MAX_SETTLED` samples.
//
// The window is sampled every `SAMPLE_EVERY` ticks, which is a twenty-fourth of a
// second: fine enough to land in both phases of any blink a player could see, and
// coarse enough that the whole window is sixty readings rather than three hundred.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { INVULN_TIME, SHIP_R } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { changedSamples, DISC_SAMPLES, readDisc } from "./ink";
import { SHIP_SPOT } from "./scene";

/** Ticks between two readings of the grace window: a twenty-fourth of a second. */
const SAMPLE_EVERY = 5;

/** Ticks the whole grace window is: `INVULN_TIME` of game time. */
const WINDOW_TICKS = ticksFor(INVULN_TIME);

/** Ticks driven past the end of the window before the settled reading is taken. */
const AFTER_TICKS = ticksFor(0.25);

/**
 * How far a sample's colour must move to count as changed, of the 441 an RGB distance
 * can span.
 *
 * Nothing on this field moves between two readings — the ship is at rest, the star
 * does not pull it, and no other body is posed — so the only thing under this bound
 * is the last bit of a channel. Far below the contrast of any mark a build would draw
 * to say "protected".
 */
const SAMPLE_DELTA = 16;

/**
 * How many of the {@link DISC_SAMPLES} readings must move for the ship to read
 * differently.
 *
 * About seven per cent of the disc of `SHIP_R`. A build blinking by colour or by
 * alpha moves nearly all of them; a build blinking by outline weight alone moves the
 * band along its outline, which inside that disc is a little over a tenth of it. The
 * bar sits under the thinnest of those and far above the nothing a ship drawn
 * identically throughout moves.
 */
const MIN_CHANGED = 30;

/**
 * How many samples may still differ once the grace has run out.
 *
 * The settled ship is drawn from the same state as the steady one — same position,
 * same facing, same velocity, no grace — so a conformant build reads zero here and
 * the allowance is for the last bit of a channel alone.
 */
const MAX_SETTLED = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws the ship differently somewhere inside its grace and as before once it ends", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  await harness.advance(1);

  const steady = await readDisc(harness, SHIP_SPOT, SHIP_R);

  await harness.debug.setShipInvuln(INVULN_TIME);
  let mostChanged = 0;
  let keptStill = false;
  for (let ticks = 0; ticks < WINDOW_TICKS; ticks += SAMPLE_EVERY) {
    await harness.advance(Math.min(SAMPLE_EVERY, WINDOW_TICKS - ticks));
    const inside = await readDisc(harness, SHIP_SPOT, SHIP_R);
    const changed = changedSamples(steady, inside, SAMPLE_DELTA);
    if (changed > mostChanged) {
      mostChanged = changed;
      // The picture kept is the instant of the window that differed MOST, which is
      // the one a reviewer wants to see whichever way the item goes.
      await captureStill(harness, "grace");
      keptStill = true;
    }
  }
  if (!keptStill) await captureStill(harness, "grace");

  await harness.advance(AFTER_TICKS);
  const settled = await readDisc(harness, SHIP_SPOT, SHIP_R);

  assertGreaterThanOrEqual(
    mostChanged,
    MIN_CHANGED,
    `of ${DISC_SAMPLES} samples inside SHIP_R, the most that read differently from the ship with no grace at any instant of the ${INVULN_TIME}-second window (specs/overview.md)`,
  );

  assertLessThanOrEqual(
    changedSamples(steady, settled, SAMPLE_DELTA),
    MAX_SETTLED,
    `of ${DISC_SAMPLES} samples inside SHIP_R, how many still read differently from the ship with no grace once the grace had run out (specs/overview.md)`,
  );
});
