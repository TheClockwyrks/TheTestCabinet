// Meltdown — movers/forge-has-no-heat: the Forge carries no heat of its own.
//
// specs/heat.md is flat about it in two places: "The Forge and the Sink carry no
// heat of their own and report `0` for it forever", and "Movers carry no heat, so
// they neither conduct with an emitter nor exchange with each other. They only
// drive the flows above into and out of the emitters they touch." specs/towers.md
// says the same on the roster. So a Forge's `heat` is `0` on the frame it is
// placed and `0` on every frame after it, whatever it is standing against.
//
// THE HARDEST PLACE TO GET IT WRONG IS BESIDE THE HOTTEST GUN. The Lance carries the
// roster's largest footprint and its highest redline, and it is posed at `99` — a
// point off the trip — with a Forge flush against its north face. A build that gave
// its movers a heat and let them take part in conduction has the steepest gradient
// on the floor pointed straight at this one, so if a mover ever warms, it warms
// here.
//
// POSED AT `99` RATHER THAN `100`, so no reading of the trip can reach the
// scenario: the trip is a CROSSING (specs/heat.md), and a build that trips on the
// value instead would take the Lance offline and out of every flow, which is
// `trip/*`'s item and not this one.
//
// THE LANCE IS LEFT THERMALLY LIVE, and that is the point of the check rather than
// an oversight. Pinning it with `setTowerThermal` would hold the gun's heat where
// it was posed and stop every flow it takes part in, so a build whose Forge DOES
// absorb heat would have nothing to absorb. Left live, it sheds through its open
// faces across the minute and every degree of that is a degree a wrong build could
// have put into the Forge.
//
// A MINUTE, SAMPLED THROUGHOUT. The item's reading is the Forge's heat after sixty
// seconds, but a build that warms a mover and then bleeds it back to zero would
// pass a single reading at the end, so the sweep watches for ANY frame on which the
// Forge reports anything but `0` and fails on the first one it finds. The Lance's
// own fall over the minute is asserted as a precondition, so a build that simply
// froze the heat model cannot pass this by standing still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  poseIdleTower,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { MOVER_SITE, faceAnchor } from "./bench";

/** The mover read, and the gun it is stood against. */
const MOVER = "forge";
const GUN = "lance";

/** The heat the gun is posed at: white-hot, and a point clear of the trip. */
const WHITE_HOT = 99;

/** What a mover's heat must read, on every frame of its life. */
const NO_HEAT = 0;

/** How long the mover is watched for, in seconds of game time. */
const WATCH_SECONDS = 60;

/**
 * How many frames apart the sweep's samples are.
 *
 * Sixty frames of the default clock is half a second of game time, so the minute
 * is read a hundred and twenty times over. Geometry, not a tolerance: it says how
 * often the reading is taken, never how far from `0` a mover's heat may sit — that
 * bound is exact, below.
 */
const SAMPLE_EVERY = 15;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge carries no heat", async () => {
  startRun(h);
  const gun = poseIdleTower(
    h,
    GUN,
    MOVER_SITE.col,
    MOVER_SITE.row,
    0,
    WHITE_HOT,
  );
  const anchor = faceAnchor(GUN, "N");
  const mover = poseTower(h, MOVER, anchor.col, anchor.row);

  const warmed = await h.until(
    (snapshot) => towerOf(snapshot, mover).heat !== NO_HEAT,
    { poll: SAMPLE_EVERY, maxFrames: driveFrames(WATCH_SECONDS) },
  );
  captureStill(h, "cold");
  const closed = h.snapshot();

  assertLessThan(
    towerOf(closed, gun).heat,
    WHITE_HOT,
    `precondition: the ${GUN} posed at ${WHITE_HOT} shed heat over ` +
      `${WATCH_SECONDS}s, so the model the ${MOVER} stands in was running`,
  );
  assertTrue(
    !warmed.hit,
    `the ${MOVER}'s heat to read ${NO_HEAT} on every frame of ` +
      `${WATCH_SECONDS}s flush against a ${GUN} posed at ${WHITE_HOT}; it read ` +
      `${towerOf(warmed.snapshot, mover).heat} after ${warmed.frames} frames`,
  );
  assertEqual(
    towerOf(closed, mover).heat,
    NO_HEAT,
    `the heat a ${MOVER} reports after ${WATCH_SECONDS}s flush against a ` +
      `${GUN} posed at ${WHITE_HOT}`,
  );
});
