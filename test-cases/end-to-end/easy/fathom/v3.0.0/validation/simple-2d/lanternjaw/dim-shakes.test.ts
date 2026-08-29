// lanternjaw/dim-shakes — dimming shakes its fix.
//
// specs/predators/lanternjaw.md: `R` grows with the forager's brightness, so a gap
// that sits inside the range while the forager is bright falls outside it once the
// forager is dim. And when the sense lapses "the fix holds at the last tile the
// Lanternjaw sensed the forager on. It keeps `state` `"chase"`, paths to that
// tile, and holds there for `LINGER_TIME` (`2 s`) from the moment the sense
// lapsed... When the window runs out with nothing sensed, the Lanternjaw drops the
// fix and returns to `"wander"`."
//
// WHY THE FORAGER SLIPS AWAY AS IT DIMS. Dimming alone cannot be measured with the
// forager left standing where it was fixed. While it lingers the Lanternjaw paths
// to that tile at `PREDATOR_SPEED` (116), covering 232 units in the 2 s — so to
// still be outside the dim `R` of 128 when the window expires, the forager would
// have to have started more than 360 units away, and at `G = 1` it can only be
// sensed within 320 in the first place. The two bounds cannot both hold, so a
// spec-correct Lanternjaw always walks back into range and re-acquires. The
// scenario therefore runs the counter the page actually describes: the forager
// goes dim AND slips off down the same corridor, and the hunter, with its range
// collapsed, cannot find it from the stale fix.
//
// AND WHY IT SLIPS ALONG THE SAME STRAIGHT RUN. All three tiles sit on one
// corridor, so the hunter can see the slip tile the whole time and only the SIZE
// of its range decides whether it can sense the forager there. Round a corner
// instead and LINE OF SIGHT would be doing the work, which is
// `lanternjaw/los-break`'s point: a build whose range never shrank would produce
// exactly the same trace and pass. Here it re-acquires at once and never gives up.
//
// WHAT THIS DOES NOT DECIDE. What `detectRange` works out to at a given brightness
// is `brightness/widens-lanternjaw`'s, and taking the fix in the first place is
// `lanternjaw/light-range`'s — a build that never takes one stands this check down
// rather than failing it twice.

import { afterEach, beforeEach } from "vitest";
import {
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { poseDimStandoff } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  check,
  clearUnderfoot,
  denAll,
  parkForager,
  requireKind,
  requireSceneHeld,
  sceneGuard,
  unmetPrecondition,
} from "../scene";
import { tileGap } from "../maze";

/** The brightness the fix is earned at, which `setBrightness` holds steady. */
const BRIGHT_G = 1;

/** The dim range and the bright range the fixture is sized against, in units. */
const DIM_RANGE = LANTERN_RANGE_BASE; // 128, R at G = 0
const BRIGHT_RANGE = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN; // 320, R at G = 1

/**
 * How long the fix is given to be taken, in ticks.
 *
 * A tenth of a second, a hard bound. Whether it is taken at all is
 * `lanternjaw/light-range`'s verdict, so a miss stands this check down.
 */
const FIX_TICKS = ticks(0.1);

/**
 * Where inside the linger the state is read, in ticks from the moment the sense
 * was taken away.
 *
 * `LINGER_TIME` less a seventh of a second. The lapse itself lands on the step
 * after the pose, so the window really opens a tick later than the mark; reading a
 * seventh of a second early asks for the claim the page makes — the fix is held
 * for the whole 2 s — rather than for a tie-break at the boundary.
 */
const INSIDE_TICKS = ticks(LINGER_TIME) - ticks(0.15);

/**
 * The last tick the wander may arrive on, counted from the same mark.
 *
 * The item's bound: back to wander "within a tenth of a second of that window
 * running out". A hard deadline rather than an open wait, so a build that lingers
 * too long FAILS here instead of running the sweep out.
 */
const DEADLINE_TICKS = ticks(LINGER_TIME + 0.1);

/** Ticks run after every reading, purely so the clip shows the hunter turn away. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Dimming shakes its fix", async () => {
  await startPlaying(h);
  const line = await poseDimStandoff(h);
  const index = requireKind(h.snapshot(), "lanternjaw");
  const quiet = await denAll(h, [index]);
  await h.debug.setPredatorTile(index, line.pred.tx, line.pred.ty);
  await h.debug.setPredatorState(index, "wander");
  await parkForager(h, line.fix);
  await clearUnderfoot(h);
  await h.debug.setBrightness(BRIGHT_G);
  // The forager is meant to slip down the corridor, so the guard is not held to
  // where it was parked; what it still catches is a life lost, the dive leaving
  // live play, or another predator loose on the board.
  const watch = await sceneGuard(h, quiet, { foragerParked: false });

  const grid = h.snapshot().grid;
  const slipFromFix = tileGap(grid, line.slip, line.fix);
  const slipFromPred = tileGap(grid, line.slip, line.pred);

  const fixed = await h.until((s) => s.predators[index].state === "chase", {
    maxFrames: FIX_TICKS,
    poll: 1,
  });
  if (!fixed.hit) {
    unmetPrecondition(
      `the Lanternjaw took no fix on a forager ${tileGap(grid, line.pred, line.fix).toFixed(0)} ` +
        `units away on a clear line at G ${BRIGHT_G}, so there was no fix to ` +
        `shake; whether it senses the forager at all is lanternjaw/light-range's ` +
        "verdict, not this one's",
    );
  }

  const shaken = await captureReplay(h, "shaken", async () => {
    // Dim and slip together, in one instant with no tick between them. Dimming
    // FIRST is what makes the slip invisible: the pose is not a swim, so a
    // forager still lit as it moved would simply be seen arriving and hand the
    // hunter a fresh fix on its new tile. The pellet under the slip tile comes
    // off the board rather than being eaten (specs/instrumentation.md:
    // "Removing a plankton this way is not eating it"), because an eat there
    // would hand back `BRIGHT_PER_EAT` of the very range this is taking away.
    await h.debug.setBrightness(0);
    await h.debug.setPlankton(line.slip.tx, line.slip.ty, false);
    await parkForager(h, line.slip);

    await h.advance(INSIDE_TICKS);
    const inside = h.snapshot();
    const gaveUp = await h.until((s) => s.predators[index].state === "wander", {
      maxFrames: DEADLINE_TICKS - INSIDE_TICKS,
      poll: 1,
    });
    const at = INSIDE_TICKS + gaveUp.frames;
    await h.advance(TAIL_TICKS);
    return { inside, gaveUp, at, end: h.snapshot() };
  });

  requireSceneHeld(shaken.end, watch);
  assertEqual(
    `${shaken.end.forager.tx},${shaken.end.forager.ty}`,
    `${line.slip.tx},${line.slip.ty}`,
    "the forager stayed on the tile it slipped to, so the separations this " +
      "check is measured on are the ones the fixture states",
  );

  // The fixture's own geometry, against the range the specification fixes at
  // each end of the brightness curve.
  assertGreaterThan(
    slipFromFix,
    DIM_RANGE,
    `the units between the slip tile and the stale fix, which a range shrunk ` +
      `to LANTERN_RANGE_BASE (${DIM_RANGE}) cannot reach across`,
  );
  assertLessThanOrEqual(
    slipFromPred,
    BRIGHT_RANGE,
    `the units between the slip tile and where the hunter started, which a ` +
      `range still at LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN (${BRIGHT_RANGE}) ` +
      "would reach across — so a build whose range never shrank re-acquires " +
      "rather than giving up",
  );

  assertEqual(
    shaken.inside.predators[index].state,
    "chase",
    `the state ${seconds(INSIDE_TICKS).toFixed(2)} s after the sense was taken ` +
      `away, inside the ${LINGER_TIME} s the fix is held for`,
  );
  assertEqual(
    shaken.gaveUp.hit,
    true,
    `the Lanternjaw is back to wander by ${seconds(DEADLINE_TICKS).toFixed(2)} s ` +
      `after the sense lapsed — LINGER_TIME (${LINGER_TIME} s) and a tenth of a ` +
      `second; it read ${shaken.gaveUp.snapshot.predators[index].state} there`,
  );
  assertLessThanOrEqual(
    seconds(shaken.at),
    LINGER_TIME + 0.1,
    "the seconds from the sense lapsing to the Lanternjaw wandering again",
  );
});
