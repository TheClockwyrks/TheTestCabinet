// detonation/harder-scatter — the torpedo's fan is blasted far harder than the gun's.
//
// `specs/collision.md` tabulates the two fans side by side. Each fragment takes
// the destroyed rock's velocity plus a kick, and the kick is what the weapon
// decides:
//
//   killed by a bullet   SPLIT_KICK (90), the two fragments kicked to opposite sides
//   killed by a torpedo  TORPEDO_SCATTER (240), the two blasted to opposite sides
//
// So this item is a COMPARISON, and the gun kill is its control: a build that
// throws every fragment at one figure reads the same number twice, its ratio comes
// out at one, and it fails whichever figure it picked.
//
// AND THE GUN'S OWN FIGURE IS NOT ASSERTED HERE. `rocks/fragment-kick-magnitude`
// owns `SPLIT_KICK` and decides it at this same tenth on a base build and a warhead
// one alike, so a second reading of it in this file would charge a build twice for
// one defect. What the gun kill is used for is the RATIO — the reading that says
// which of the two fans is the harder — and the only absolute figure this item
// decides is the torpedo's.
//
// READ OFF THE PAIR, NEVER OFF ONE FRAGMENT. The difference between the two
// fragments' velocities is twice the kick with the parent's own motion — and
// everything the well added to it over the shots — cancelled exactly, so half that
// difference is the kick and nothing else. That is what `kickOf` computes, and it
// is the repair the fold-in made for the fragment fan carried into this group:
// read as a difference, no placement can let gravity into the figure.
//
// BOTH SPREADS ARE READ AT THE INSTANT OF THEIR OWN KILL. The previous version of
// this case compared a torpedo spread taken at impact against a gun spread taken
// three quarters of a second later, which let the well act on one side of the
// comparison and not the other. Here each half reads its fragments on the tick its
// own weapon landed: `destroyByGun` reports the tick the rock came apart, and
// `driveTorpedo` reports the tick the torpedo left the roster.
//
// THE SAME POSED ROCK BOTH TIMES — a Large at rest on quiet ground — so the only
// thing that differs between the two readings is which weapon destroyed it. Under
// `warhead` the gun needs `ROCK_HEALTH.large` (3) rounds to get there, which
// `destroyByGun` places one after another on the rock's doorstep.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SPLIT_KICK, TORPEDO_SCATTER } from "../constants";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  captureReplay,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  destroyByGun,
  driveTorpedo,
  fragmentPair,
  inwardHeading,
  kickOf,
  launchAt,
  lengthOf,
} from "./scenario";

/**
 * How far the torpedo's reading may sit from the figure `specs/collision.md` fixes:
 * a tenth of it, as the review item states.
 *
 * It is room for a build's own arithmetic and for the order in which it applies a
 * tick's motion, NOT for the environment: the well's contribution to the parent is
 * cancelled by reading the difference of the pair, so it is not in the figure to be
 * allowed for.
 */
const TOLERANCE = 0.1;

/**
 * How many times the gun's kick the torpedo's must be, at least.
 *
 * Twice, and it is the COMPARISON this item owns rather than a second reading of
 * either figure. `specs/collision.md` puts the two at `240` against `90`, a ratio of
 * `2.67`, and the loosest pair this case tolerates — `240` less a tenth over `90`
 * plus a tenth — still reads `2.18`. A build that used ONE figure for both weapons,
 * whichever it picked, reads exactly `1`. So the floor sits between the two, well
 * clear of both.
 *
 * IT IS A RATIO AND NOT THE GUN'S OWN FIGURE, deliberately. `rocks/fragment-kick-
 * magnitude` owns `SPLIT_KICK` and decides it at this same tenth, so asserting it
 * again here would charge a build twice for one defect. What is read here is that
 * the torpedo's fan is the harder of the two, which is what the item is named for.
 */
const HARDER_THAN_THE_GUN = 2;

/** Frames of the fragments coming apart, recorded after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blasts the fragments apart at TORPEDO_SCATTER against the gun's SPLIT_KICK", async () => {
  // The control: the same Large, taken by the gun. Under `warhead` that is three
  // rounds, and the spread is read on the tick the third one landed.
  startPlaying(h);
  const gunParent = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);
  const gunKill = await destroyByGun(h, gunParent);
  const [gunA, gunB] = fragmentPair(
    gunKill,
    "medium",
    "harder-scatter: the gun kill",
  );
  const gunKick = lengthOf(kickOf(gunA, gunB));

  // The subject: the same Large, taken by one torpedo.
  startPlaying(h);
  const parentId = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);
  const parent = rockById(
    h.snapshot(),
    parentId,
    "the Large the torpedo takes",
  );
  const torpedo = launchAt(
    h,
    { x: parent.x, y: parent.y, radius: ROCK_RADIUS.large },
    inwardHeading(parent),
  );

  const run = await captureReplay(h, "scatter", async () => {
    const flight = await driveTorpedo(h, torpedo);
    await h.advance(AFTERMATH_TICKS);
    return flight;
  });

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );
  const [torpedoA, torpedoB] = fragmentPair(
    run.at,
    "medium",
    "harder-scatter: the torpedo kill",
  );
  const torpedoKick = lengthOf(kickOf(torpedoA, torpedoB));

  assertLessThanOrEqual(
    Math.abs(torpedoKick - TORPEDO_SCATTER),
    TORPEDO_SCATTER * TOLERANCE,
    `the torpedo's fragment kick, TORPEDO_SCATTER (${TORPEDO_SCATTER}), within ` +
      "a tenth (specs/collision.md)",
  );
  assertGreaterThan(
    torpedoKick / gunKick,
    HARDER_THAN_THE_GUN,
    "how many times the gun's own fragment kick on the same posed Large the " +
      `torpedo's is, against the ${TORPEDO_SCATTER} to ${SPLIT_KICK} ` +
      "`specs/collision.md` gives the two fans; the gun read " +
      `${gunKick.toFixed(1)} and the torpedo ${torpedoKick.toFixed(1)}`,
  );
});
