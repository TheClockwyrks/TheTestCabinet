// flarefish/light-sense — the Flarefish fixes on the forager's light inside its
// detection range, with no flare in it, and takes no fix beyond that range.
//
// `specs/predators/flarefish.md` gives the sense three conditions at once — in
// range, in line of sight, clear of ink — and fixes the range: "`R` grows with the
// forager's brightness `G` on the same curve the Lanternjaw's does:
// `R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, `128` (4 tiles) at `G = 0`
// and `320` (10 tiles) at `G = 1`." Then: "This sense runs whatever the Flarefish
// is doing and owes nothing to the flare, so a Flarefish that simply drifts up on
// a lit forager takes a fix at once and pursues ... it reports `state` as
// `"chase"`."
//
// BOTH DIRECTIONS, ON ONE BOARD AND AT ONE BRIGHTNESS. A build with no range test
// at all senses the forager from anywhere and passes the inside leg; a build that
// senses nothing passes the outside leg. So the same pair stands at two distances
// with `G` posed at `1` for both, and the only thing that changes between the two
// readings is how far apart they are.
//
// THE OUTSIDE LEG COMES FIRST, and it is bounded rather than open-ended: a
// Flarefish that has not fixed on the forager after a stated stretch of steps has
// held none, and the stretch is short enough that its own travel cannot carry it
// inside `R` underneath the reading. At `PREDATOR_SPEED` (`116`) it covers under a
// hundred units in the window, against the hundred and sixty of margin the far
// stand leaves.
//
// NEITHER DISTANCE IS INSIDE A FLARE. Both stands are past `FLARE_RADIUS`
// (`192`), so the bloom's own lock — which reaches through rock and is
// `flarefish/flare-lock`'s subject — cannot be what produces the fix here. That is
// what "with no flare needed" means, and it is posed rather than hoped for.
//
// WHAT THIS DOES NOT DECIDE. The detection alert that a fresh acquisition fires,
// which is `alert/flarefish`'s; and what a chasing Flarefish then does, which is
// `flarefish/chase-like-lanternjaw`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  BRIGHT_HOLD,
  FLARE_RADIUS,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  PREDATOR_SPEED,
  TICK_HZ,
  TILE,
} from "../../src/constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import { tileGap } from "../maze";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { startPlaying } from "../harness";

/**
 * The brightness both legs are posed at.
 *
 * `G = 1`, where `specs/predators/flarefish.md` puts `R` at its widest `320` (ten
 * tiles). Posing the top of the curve is what leaves room for a far stand that is
 * unambiguously outside it and a near stand that is unambiguously inside it and
 * still clear of `FLARE_RADIUS`. `setBrightness` "arms the `BRIGHT_HOLD` (`1.0 s`)
 * brightness hold ... so the value it poses is steady for that full second"
 * (`specs/instrumentation.md`), which is what every reading below is taken inside.
 */
const POSED_G = 1;

/** `R` at that brightness, in logical units: `128 + 192 * 1`. */
const RANGE = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * POSED_G;

/**
 * How far apart the pair stands for each leg, in tiles.
 *
 * `NEAR_TILES` is `224` units: comfortably inside `R` (`320`) and comfortably
 * outside `FLARE_RADIUS` (`192`), so a fix taken there is the light-sense's and
 * cannot be a bloom's. `FAR_TILES` is `480` units: a hundred and sixty past `R`,
 * which is more ground than the Flarefish can cover in the window below.
 */
const NEAR_TILES = 7;
const FAR_TILES = 15;

/**
 * How long the far stand is watched, in ticks.
 *
 * A hundred ticks, five sixths of a second. Two ceilings meet here. It has to be
 * short enough that the Flarefish's own travel cannot bring it inside `R` — at
 * `PREDATOR_SPEED` that is under a hundred units against a hundred and sixty of
 * margin — and short enough to sit inside the `BRIGHT_HOLD` the posed `G` is
 * steady across. It is still a hundred steps, on each of which
 * `specs/predators/flarefish.md` has the sense run.
 */
const FAR_TICKS = 100;

/**
 * How long the near stand is given to produce the fix, in ticks.
 *
 * The sense "runs whatever the Flarefish is doing" and sets the fix on the step it
 * holds, so a conforming build is chasing on the next one. A tenth of a second is
 * that step and nine to spare.
 */
const NEAR_TICKS = 12;

/** Ticks of the chase held after the reading, purely for the clip. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a fix on the forager's light inside R and none beyond it", async () => {
  await startPlaying(h);
  // One straight corridor with clear line of sight along the whole of it, so the
  // only condition of the sense that changes between the two legs is the range.
  const line = await poseSightLine(h, FAR_TILES, { lead: 1, tail: 1 });
  await parkForager(h, line.forager);

  const guard = await sceneGuard(h, { posesAgain: true });

  // The one Flarefish this point is about, on a board that holds nothing else.
  // Its travel is held, so each leg's standoff is exactly the distance the
  // fixture states for the whole of the window it is watched over.
  const index = await spawnPredator(h, "flarefish", line.pred, {
    dir: line.toForager,
    state: "wander",
    travel: false,
  });

  const read = await captureReplay(h, "light", async () => {
    // The far stand: fifteen tiles down the corridor, at the brightest the
    // forager gets.
    await poseBrightness(h, POSED_G, BRIGHT_HOLD);
    const farOpening = h.snapshot();
    const held = await h.until(
      (snap) => snap.predators[index].state === "chase",
      { maxFrames: FAR_TICKS, poll: 1 },
    );
    const far = h.snapshot();

    // The near stand: the same pair, the same brightness, seven tiles apart.
    h.debug.setPredatorTile(
      index,
      line.forager.tx + NEAR_TILES,
      line.forager.ty,
    );
    h.debug.setPredatorDir(index, line.toForager);
    h.debug.setPredatorState(index, "wander");
    await poseBrightness(h, POSED_G, BRIGHT_HOLD);
    await h.advance(NEAR_TICKS);
    const near = h.snapshot();
    // The chase it just opened, for the clip. Both readings are already taken.
    await h.advance(TAIL_TICKS);
    return { farOpening, held, far, near };
  });

  requireSceneHeld(h.snapshot(), guard);

  // The far leg. The gaps are asserted from the board the build reports rather
  // than from the fixture's own arithmetic, so a build whose grid is not the one
  // specs/overview.md fixes fails on the reading rather than on a stale number.
  const farGap = tileGap(read.far.grid, line.forager, {
    tx: line.pred.tx,
    ty: line.pred.ty,
  });
  assertLessThan(
    RANGE,
    farGap,
    `R at G = ${POSED_G} (${RANGE}), against the ${farGap} units the far stand ` +
      `put between the two centers`,
  );
  assertEqual(
    read.farOpening.brightness,
    POSED_G,
    "the forager's posed brightness, which fixes R for the far stand",
  );
  assertEqual(
    read.held.hit,
    false,
    `the Flarefish took a fix over ${FAR_TICKS} ticks standing ${farGap} units ` +
      `off, beyond the R = ${RANGE} specs/predators/flarefish.md gives it at ` +
      `G = ${POSED_G} (it can close at most ` +
      `${((PREDATOR_SPEED * FAR_TICKS) / TICK_HZ).toFixed(0)} units in that window)`,
  );
  assertEqual(
    read.far.predators[index].state,
    "wander",
    `the Flarefish's state after ${FAR_TICKS} ticks beyond R`,
  );

  // The near leg.
  const nearGap = NEAR_TILES * TILE;
  assertLessThan(
    nearGap,
    RANGE,
    `the ${nearGap} units the near stand puts between the two centers, against ` +
      `R at G = ${POSED_G}`,
  );
  assertLessThan(
    FLARE_RADIUS,
    nearGap,
    `FLARE_RADIUS (${FLARE_RADIUS}), against the ${nearGap} units of the near ` +
      `stand — so the fix below cannot be a bloom's lock`,
  );
  assertEqual(
    read.near.predators[index].state,
    "chase",
    `the Flarefish's state ${NEAR_TICKS} ticks after being stood ${nearGap} ` +
      `units from a forager at G = ${POSED_G}, inside the R = ${RANGE} ` +
      `specs/predators/flarefish.md gives it, in clear line of sight down one ` +
      `straight corridor`,
  );
});
