// presentation/strike-sheet-plays-once — Spark's four-frame sheet plays through
// once, in order, over the strike's flash.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "A strike draws
// frame `floor(t / (SPARK_FLASH / 4))` ... for `t` the seconds of ticks since
// the tick the zone appeared, so each sheet plays once through over its
// flash." `SPARK_FLASH` is `0.2` seconds, so a frame lasts `0.05` seconds,
// which `specs/world.md`'s timer rule makes `round(0.05 x 60)` = 3 ticks; the
// zone's own `ttl` is `SPARK_FLASH`, 12 ticks, so the four frames fill it
// exactly. The sheet is the produced `assets/sprites/effects/spark/0.png` to
// `3.png` (`specs/assets.md`, "The weapon effects"), and a blit's file name is
// which frame is up.
//
// WHERE THE SAMPLES SIT, AND WHY MID-RUN. One reading in the MIDDLE of each
// three-tick run, at 1, 4, 7, and 10 ticks after the tick the zone appeared:
// `t` is then `1/60`, `4/60`, `7/60`, and `10/60` seconds, which the formula
// puts a third of the way into frames 0, 1, 2, and 3. Reading mid-run rather
// than on a boundary is deliberate — `0.05` and `0.1` are not exactly
// representable, so a build that accumulates `t` a tick at a time and one that
// multiplies its tick count by `TICK_DT` can land on opposite sides of a
// boundary, and neither is wrong. A third of a run is many orders of magnitude
// clear of that.
//
// THE BOUND. None: four exact frame numbers, in order, off the four produced
// file names. A build that holds one frame for the whole flash, plays the sheet
// backwards, runs it at another rate, or plays it more than once through fails
// on one of the four.
//
// THE WORLD, AND WHY. As the "drawn where its shape is" suite poses it: Spark
// alone at level 1 and one hound 200 units away, which is the only candidate
// within `SPARK_RANGE` (`600`), so exactly one strike lands and it lands on the
// hound. A hound survives the row's damage (`hp` `120` against `15`), so no
// death puff arrives over the flash, and `enemyMotion` and `enemyContact` stay
// off so the hound neither moves nor hits.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull } from "../assert";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemy,
  zonesOfKind,
  type Harness,
} from "../harness";
import { effectFiles, framesAt } from "./sprites";

/** Where the hound stands: well inside `SPARK_RANGE` and inside the view. */
const TARGET = { x: 200, y: 0 };

/** Ticks after the strike appeared, and the sheet frame owed at each. */
const SAMPLES: readonly { at: number; frame: number }[] = [
  { at: 1, frame: 0 },
  { at: 4, frame: 1 },
  { at: 7, frame: 2 },
  { at: 10, frame: 3 },
];

/** How far the drive runs: past the last sample, inside the 12-tick flash. */
const DRIVE_TICKS = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays spark frames 0 to 3 in order over the strike's flash", async () => {
  isolate(h);
  placeEnemy(h, "hound", TARGET.x, TARGET.y);
  const slot = holdWeapon(h, "spark", 1);
  armWeapon(h, slot);

  const files = effectFiles("spark");
  const drawn: (number[] | null)[] = [];
  await captureReplay(h, "strike", async () => {
    // The first frame runs the tick the strike lands on, which is `t = 0`.
    const first = await h.frameBlits();
    const [zone] = zonesOfKind(h.snapshot(), "strike");
    assertNotNull(zone, "a strike zone on the tick Spark fires");
    drawn.push(framesAt(h, first, files, zone.x, zone.y));
    for (let tick = 1; tick <= DRIVE_TICKS; tick += 1) {
      const blits = await h.frameBlits();
      drawn.push(framesAt(h, blits, files, zone.x, zone.y));
    }
  });

  for (const sample of SAMPLES) {
    const frames = drawn[sample.at];
    assertNotNull(
      frames,
      `a spark sheet frame drawn on the strike ${sample.at} ticks after it landed`,
    );
    assertContains(
      frames as number[],
      sample.frame,
      `the spark sheet frame drawn ${sample.at} ticks after the strike landed`,
    );
  }
});
