// presentation/burst-sheet-plays-once — Flare's six-frame sheet plays through
// once, in order, over the burst's flash.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "a burst [draws]
// frame `floor(t / (FLARE_FLASH / 6))`, for `t` the seconds of ticks since the
// tick the zone appeared, so each sheet plays once through over its flash."
// `FLARE_FLASH` is `0.4` seconds, so a frame lasts `0.4 / 6` seconds, which
// `specs/world.md`'s timer rule makes 4 ticks; the zone's own `ttl` is
// `FLARE_FLASH`, 24 ticks, so the six frames fill it exactly. The sheet is the
// produced `assets/sprites/effects/flare/0.png` to `5.png`
// (`specs/assets.md`, "The weapon effects"), and a blit's file name is which
// frame is up.
//
// WHERE THE SAMPLES SIT, AND WHY MID-RUN. One reading in the MIDDLE of each
// four-tick run, at 1, 5, 9, 13, 17, and 21 ticks after the tick the zone
// appeared, which the formula puts a quarter of the way into frames 0 through
// 5. Reading mid-run rather than on a boundary is deliberate: `0.4 / 6` is not
// exactly representable, so a build that accumulates `t` a tick at a time and
// one that multiplies its tick count by `TICK_DT` can land on opposite sides of
// a boundary, and neither is wrong.
//
// THE BOUND. None: six exact frame numbers, in order, off the six produced file
// names. A build that holds one frame for the whole flash, plays the sheet
// backwards, runs it at another rate, or loops it fails on one of the six.
//
// THE WORLD, AND WHY. An isolated world holding Flare alone at level 1 and no
// enemy: `specs/weapons.md` says "Flare fires whether or not any enemy exists,
// and amount is ignored", so the empty field is the cleanest firing and nothing
// else is drawn over the stage. Flare's level-1 cooldown is `60` seconds, so no
// second burst can start inside the flash.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull } from "../assert";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { effectFiles, framesAt } from "./sprites";

/** Ticks after the burst appeared, and the sheet frame owed at each. */
const SAMPLES: readonly { at: number; frame: number }[] = [
  { at: 1, frame: 0 },
  { at: 5, frame: 1 },
  { at: 9, frame: 2 },
  { at: 13, frame: 3 },
  { at: 17, frame: 4 },
  { at: 21, frame: 5 },
];

/** How far the drive runs: past the last sample, inside the 24-tick flash. */
const DRIVE_TICKS = 22;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays flare frames 0 to 5 in order over the burst's flash", async () => {
  isolate(h);
  const slot = holdWeapon(h, "flare", 1);
  armWeapon(h, slot);

  const files = effectFiles("flare");
  const drawn: (number[] | null)[] = [];
  await captureReplay(h, "burst", async () => {
    // The first frame runs the tick the burst fires on, which is `t = 0`.
    const first = await h.frameBlits();
    const [zone] = zonesOfKind(h.snapshot(), "burst");
    assertNotNull(zone, "a burst zone on the tick Flare fires");
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
      `a flare sheet frame drawn on the burst ${sample.at} ticks after it fired`,
    );
    assertContains(
      frames as number[],
      sample.frame,
      `the flare sheet frame drawn ${sample.at} ticks after the burst fired`,
    );
  }
});
