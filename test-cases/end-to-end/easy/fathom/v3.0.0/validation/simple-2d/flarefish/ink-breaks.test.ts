// flarefish/ink-breaks — ink drops a chasing Flarefish's fix at once, and it takes
// no new one while the cloud blinds it.
//
// `specs/predators/flarefish.md`: "Ink drops the fix at once with no linger, for
// as long as the cloud blinds it", and its state table gives `"chase"` to
// `"wander"` on "`LINGER_TIME` runs out with nothing sensed, or ink blinds it".
// `specs/sensing.md` fixes what blinding is: "A Lanternjaw or a Flarefish is
// blinded while its center is inside a cloud, or while the segment joining its
// center to the forager's center passes within `INK_RADIUS` of that cloud's
// center. A blinded hunter drops any fix it holds, takes no new one, and wanders
// until it is clear of the cloud or the cloud expires."
//
// TWO CLAIMS, AND THE SECOND IS THE ONE A BUILD FAILS QUIETLY. "At once" is a
// timing, and a build that merely walks to the stale fix and lingers there is
// caught by it. "Takes no new one" is the harder half: a build that drops the fix
// on the tick the cloud lands and then re-acquires on the next, through the cloud,
// has honoured the letter of the first claim and none of the second.
//
// THE CLOUD IS ALWAYS ON THE LINE, WHICH IS WHAT MAKES THE SECOND CLAIM READABLE.
// The forager releases the cloud where it stands and stays there, so the cloud's
// center IS the forager's center: the segment from the Flarefish to the forager
// ends at that center, whatever the Flarefish does and wherever it drifts. There is
// therefore no moment in the window below at which the specification lets it see
// again, and a fix taken in that window is a fix taken blind.
//
// AND THE FORAGER IS SQUARELY INSIDE THE RANGE THROUGHOUT, which is what stops the
// second claim passing for the wrong reason: a hunter that lost the forager to
// DISTANCE rather than to ink would also read `"wander"`. The stand is eight tiles
// (`256`) with `G` posed at `1`, where `R` is `320`, and the check reads `R` back
// off the brightness the build reports at the end of the window and confirms the
// pair is still inside it.
//
// THE WINDOW IS BOUNDED BY THE GROUND THE HUNTER CAN COVER. At `PREDATOR_SPEED`
// (`116`) everything driven here closes some two hundred units of the `288` the
// stand opens with — so the hunter cannot reach the forager's tile, and what the
// reading is of is the item's own subject rather than a caught life.
//
// WHAT THIS DOES NOT DECIDE. How long a cloud lasts or how wide it is, which are
// `ink/cloud`'s; and what breaks a fix that is not ink, which is
// `flarefish/chase-like-lanternjaw`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  BINDINGS,
  BRIGHT_HOLD,
  INK_RADIUS,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
  TILE,
} from "../../src/constants";
import { poseInkStandoff, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  ticks,
  type Harness,
} from "../harness";
import {
  parkForager,
  requireSceneHeld,
  sceneGuard,
  separation,
} from "../scene";
import { startPlaying } from "../harness";

/** The key `specs/movement.md` binds the `b` action, which releases ink, to. */
const INK_KEY = BINDINGS.b[0];

/**
 * The brightness the stand is posed at, and the range it buys.
 *
 * `G = 1` puts `R` at `LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN` (`320`), ten
 * tiles, so an eight-tile stand is unambiguously inside the sense and the fix
 * below is the light-sense's own.
 */
const POSED_G = 1;
const RANGE = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * POSED_G;

/**
 * How far apart the pair stands, in tiles.
 *
 * Nine (`288` units): inside the `320` of `R` at the posed `G`, and far enough
 * that everything this check drives — the acquisition, the cloud, the break, the
 * blinded window and the tail held for the clip — leaves the hunter short of the
 * forager's tile at `PREDATOR_SPEED`.
 */
const GAP_TILES = 9;

/** Ticks the pair stands before the ink, so the fix is taken first. */
const ACQUIRE_TICKS = 12;

/**
 * How long the fix may take to drop after the cloud appears, in seconds.
 *
 * The item's bound: a tenth of a second. `specs/sensing.md` has a blinded hunter
 * drop its fix rather than linger, so this is twelve steps of margin on a claim the
 * page states as immediate — and it is a twentieth of the `LINGER_TIME` (`2 s`) a
 * hunter that lost the forager any OTHER way is allowed.
 */
const BREAK_MAX = 0.1;

/**
 * How long the Flarefish is then watched for a new fix, in seconds.
 *
 * A second and a half: well short of the `INK_LIFE` (`3 s`) the cloud stands for,
 * so the cloud is still blinding it at the last step read.
 */
const BLIND_WATCH = 1.5;

/**
 * How often the blinded window is read, in ticks.
 *
 * Four, which is a thirtieth of a second — far finer than anything the claim
 * turns on, and the beat the forager's glow is re-posed on.
 */
const BLIND_POLL = 4;

/**
 * Ticks held after the reading, so the clip shows the standoff rather than cutting
 * on it. Every reading is already taken, and they are counted into the ground the
 * hunter may cover before it would reach the forager.
 */
const TAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the Flarefish's fix the moment ink lands, and it takes no new one while the cloud blinds it", async () => {
  await startPlaying(h);
  const line = await poseInkStandoff(h, { gap: GAP_TILES, clearTiles: 3 });
  await parkForager(h, line.ink);

  // Its light sense is what the cloud breaks, so its mind runs and its travel is
  // held: it stands the standoff the fixture laid out for the whole reading, and
  // the cloud stays squarely on the line between the two.
  const index = await spawnPredator(h, "flarefish", line.pred, {
    dir: "left",
    state: "wander",
    travel: false,
  });
  await poseBrightness(h, POSED_G, BRIGHT_HOLD);
  const guard = await sceneGuard(h);

  const run = await captureReplay(h, "ink", async () => {
    // The fix, earned through the build's own light-sense rather than posed.
    await h.advance(ACQUIRE_TICKS);
    const fixed = h.snapshot();

    // The cloud, released where the forager stands and squarely on the line.
    h.debug.setInkCooldown(0);
    await h.tap(INK_KEY);
    const inked = h.snapshot();

    const broke = await h.until(
      (snap) => snap.predators[index].state === "wander",
      { maxFrames: ticks(BREAK_MAX), poll: 1 },
    );
    // And then the harder half: a whole blinded window with no new fix in it.
    // The forager's glow is re-posed as the window runs. `G` decays on its own
    // curve once the hold expires and `R` shrinks with it (specs/sensing.md), so
    // a window left to decay would end with the forager out of the reach the
    // Flarefish would otherwise have sensed it at — and "it took no new fix"
    // would be a reading of distance rather than of ink.
    const blindTicks = ticks(BLIND_WATCH);
    let refixed = false;
    for (let spent = 0; spent < blindTicks; spent += BLIND_POLL) {
      await poseBrightness(h, POSED_G, BRIGHT_HOLD);
      await h.advance(Math.min(BLIND_POLL, blindTicks - spent));
      if (h.snapshot().predators[index].state !== "wander") {
        refixed = true;
        break;
      }
    }
    const ended = h.snapshot();
    await h.advance(TAIL_TICKS);
    return { fixed, inked, broke, refixed, ended };
  });

  requireSceneHeld(h.snapshot(), guard);

  // The premise: it was chasing, and there was a cloud. Both are what this
  // point's own claim runs from, so a scenario that reached neither fails here.
  assertEqual(
    run.fixed.predators[index].state,
    "chase",
    `the Flarefish fixed on a forager standing ${GAP_TILES * TILE} units ` +
      `away at G = ${POSED_G}, inside the R = ${RANGE} ` +
      "specs/predators/flarefish.md gives it, which is the fix ink breaks",
  );
  assertGreaterThan(
    run.inked.inkClouds.length,
    0,
    `ink clouds standing after ${INK_KEY} was pressed with the cooldown at 0, ` +
      "which is the cloud the fix is broken by",
  );

  // At once, and nowhere near the linger a fix lost any other way is allowed.
  assertEqual(
    run.broke.hit,
    true,
    `the Flarefish returned to wander within ${BREAK_MAX} s of the cloud ` +
      `appearing, which specs/predators/flarefish.md gives it with no linger`,
  );
  assertLessThanOrEqual(
    run.broke.snapshot.simTime - run.inked.simTime,
    BREAK_MAX,
    `the seconds between the cloud appearing and the fix dropping, against the ` +
      `LINGER_TIME (${LINGER_TIME} s) a fix lost any other way holds for`,
  );

  // And no new fix while it is blind.
  assertEqual(
    run.refixed,
    false,
    `the Flarefish took a fresh fix during the ${BLIND_WATCH} s the cloud ` +
      `blinded it — the cloud is centered on the forager, so the segment ` +
      `between the two ends at the cloud's own center and never leaves the ` +
      `INK_RADIUS (${INK_RADIUS}) specs/sensing.md blinds inside of`,
  );

  // The reading that stops the last one passing for the wrong reason: the forager
  // never left the range the Flarefish would otherwise have sensed it at.
  const endGap = separation(run.ended, index);
  const endRange =
    LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * run.ended.brightness;
  assertLessThan(
    endGap,
    endRange,
    `the units between the two centers at the end of the blinded window, ` +
      `against the R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G the ` +
      `build's own reported brightness (${run.ended.brightness.toFixed(3)}) ` +
      `gives — so a wandering Flarefish here is one the ink blinded, not one ` +
      `that lost the forager to distance`,
  );
  assertGreaterThan(
    endGap,
    TILE,
    `the units between the two centers at the end of the window, against the ` +
      `${TILE}-unit tile contact is decided on — the hunter's travel is held, ` +
      `so the pair still stands the ${GAP_TILES * TILE} units the fixture laid ` +
      `out`,
  );
});
