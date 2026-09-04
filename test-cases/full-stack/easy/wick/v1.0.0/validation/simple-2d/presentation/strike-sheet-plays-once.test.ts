// presentation/strike-sheet-plays-once — Spark's four-frame sheet plays through
// once, in order, over the strike's flash.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "A strike
// draws frame floor(t / (SPARK_FLASH / 4)) and a burst frame floor(t /
// (FLARE_FLASH / 6)), for t the seconds of ticks since the tick the zone
// appeared, so each sheet plays once through over its flash." SPARK_FLASH is
// 0.2 seconds, so a frame lasts 0.05, which specs/world.md's timer rule makes
// round(0.05 × TICK_HZ) = 3 ticks, and the zone's own flash of 0.2 seconds is
// 12 ticks, exactly the four frames. specs/assets.md ("The weapon effects")
// gives the files: "strike | Spark | assets/sprites/effects/spark/0.png to
// 3.png | a sheet of 4, played once", so the file a blit painted is the frame
// that was up. WHERE the frame is drawn belongs to the point about the strike
// over its shape; this one reads which frame alone.
//
// THE WORLD. An isolated playing run (`isolate`): every driver switch off but
// the one the firing needs, and no other weapon held. Spark needs a target, so
// one owl stands clear of the lamplighter and well inside SPARK_RANGE (600),
// with `enemyMotion` and `enemyContact` off so it neither moves nor touches
// anything; its health outlasts a level-1 strike's damage many times over, so
// no death puff plays over the flash. Spark is held at level 1, whose amount is
// 1, so the firing tick lands exactly one strike and one sheet is playing.
//
// WHAT IS READ. The frame number carried by the file the last spark blit
// painted, on the firing tick and on each of the SWEEP_TICKS ticks after it,
// against floor(t / 3) for t that many ticks. The frames those readings ran
// through, with each run collapsed to one entry, against 0, 1, 2, 3 in order,
// which is the sheet playing once through: a build that holds one frame, runs
// the sheet backwards, plays it at another rate, or restarts it inside the
// flash fails on one of the two.
//
// TOLERANCE. Each tick's frame is asserted exactly, except a tick whose t falls
// exactly on a frame boundary, where the frame before it is also accepted:
// `assertFrameAt` states why. The sweep stops one tick short of the flash's
// last, so a build whose zone is removed on the tick its ttl reaches zero and
// one whose zone is removed the tick after both read the same way here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  ENEMIES,
  EFFECT_SPRITES,
  SPARK_FLASH,
  SPARK_LEVELS,
  SPARK_RANGE,
  ticksFor,
} from "../constants";
import {
  armWeapon,
  blitsOf,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  zonesOfKind,
  type Harness,
} from "../harness";
import { assertFrameAt, drawnUnder, frameNumber } from "./drawn";

/** Where the owl stands: well inside SPARK_RANGE and clear of everything. */
const OWL_AT = { x: 300, y: 0 };

/** The level held: amount 1, so the firing tick lands one strike. */
const LEVEL = 1;

/** Ticks each frame is shown: round((SPARK_FLASH / 4) × TICK_HZ). */
const FRAME_TICKS = ticksFor(SPARK_FLASH / EFFECT_SPRITES.spark.frames);

/** Ticks driven after the firing tick: one short of the flash's 12. */
const SWEEP_TICKS = ticksFor(SPARK_FLASH) - 2;

/** The frame the sheet shows `ticks` ticks after the zone appeared. */
function expected(ticks: number): number {
  return Math.floor(ticks / FRAME_TICKS);
}

/** A sequence with each run of repeats collapsed to one entry. */
function runs(frames: readonly number[]): number[] {
  return frames.filter((frame, index) => frame !== frames[index - 1]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws spark frames 0 to 3 in order over the strike's flash", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  assertEqual(SPARK_LEVELS[LEVEL - 1].amount, 1, "Spark's amount at level 1");
  assertEqual(
    Math.hypot(OWL_AT.x, OWL_AT.y) < SPARK_RANGE,
    true,
    "the owl's distance from the lamplighter, against SPARK_RANGE",
  );
  assertEqual(
    ENEMIES.owl.hp > SPARK_LEVELS[LEVEL - 1].damage,
    true,
    "an owl's health against a level-1 strike's damage",
  );
  spawnEnemyAt(h, "owl", OWL_AT.x, OWL_AT.y);
  const slot = holdWeapon(h, "spark", LEVEL);
  armWeapon(h, slot);

  const drawn = await captureReplay(h, "strike", async () => {
    const frames: number[] = [];
    const read = (tick: number): void => {
      const blit = drawnUnder(
        blitsOf(h.lastCalls()),
        EFFECT_SPRITES.spark.path,
        `strike ${tick} ticks after it landed`,
      );
      frames.push(frameNumber(blit.id, "spark"));
    };
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "strike"),
      1,
      "the strikes the firing tick landed",
    );
    read(0);
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      await h.tick(1);
      read(tick);
    }
    return frames;
  });

  for (let tick = 0; tick <= SWEEP_TICKS; tick += 1) {
    assertFrameAt(
      drawn[tick],
      tick,
      FRAME_TICKS,
      expected,
      `the strike's drawn frame ${tick} ticks after it landed`,
    );
  }
  assertDeepEqual(
    runs(drawn),
    [0, 1, 2, 3],
    "the frames the strike's sheet ran through, in order",
  );
});
