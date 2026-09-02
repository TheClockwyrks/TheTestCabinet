// hurt/flash-drawn — the frame drawn while the flash runs differs from the
// frame drawn on the same state with the flash spent.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, the `playing` HUD
// table, "Hurt": "While `hurtFlash` is above `0`, a hurt cast over the view, so
// the stage drawn on a tick with `hurtFlash` above `0` differs from the stage
// drawn on the same state with `hurtFlash` at `0`. Its color, its shape, and
// its fade are yours." The requirement is a DIFFERENCE and nothing else, so
// nothing here reads a color, a place, or a shape: the cast may be a tint, a
// vignette, a border, or a shake, and every one of those answers the row.
//
// WHAT IS READ, AND WHY. Every pixel of the canvas on two frames posed to the
// same state but for the flash. A whole-frame comparison is the only reading
// the row admits, since it fixes no region the cast has to fall in.
//
// HOW TWO FRAMES ARE POSED ON THE SAME STATE. Two harnesses, each holding an
// isolated `playing` run with one rat 20 units off. In the flashed one
// `enemyContact` is on and the tick lands a hit, which sets `hurtFlash` to
// `HURT_FLASH` and takes the rat's damage off `hp` (`specs/world.md`, Contact
// damage). In the plain one contact stays off and `hp` is posed to what the
// hit left, so its tick reaches the same health with the timer at `0`. The two
// then agree on the screen, the run clock, the health, the lamplighter, and
// the rat, and disagree on `hurtFlash` alone.
//
// THE CONTROL, AND WHY IT IS HERE. A difference between two frames only means
// the flash if the two routes draw the same picture WITHOUT it. So both runs
// are carried on `HURT_FLASH_TICKS` (`18`) further ticks, the count after
// which the timer has reached `0` (`specs/world.md`, Timers), and the two
// frames are compared again: they must be identical, pixel for pixel. That
// reading is what rules out a difference the arrangement itself introduced,
// and it is what lets the flash's own comparison be made at a channel
// tolerance of zero.
//
// THE TOLERANCE. Zero on the channels: both frames come from the same build
// drawing the same scene into the same canvas, so every pixel the flash did
// not touch is written by the same calls in the same order and is identical
// byte for byte, which the control reads back. On the AREA, `CAST_PIXELS`
// (`256`), a square of sixteen pixels a side out of the 1280 x 720 stage:
// far below anything a player would call a cast over the view, so no
// conformant build is failed by it, and far above the nothing a build that
// draws no cast leaves.

import { afterEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HURT_FLASH_TICKS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  pixelsDiffering,
  type Harness,
  type PixelRect,
  type WickSnapshot,
} from "../harness";
import { armFlash, poseRat, stageFrame } from "./flash";

/**
 * How many pixels must differ for a cast to have been drawn: a square of
 * sixteen pixels a side, out of the 921600 the stage holds.
 */
const CAST_PIXELS = 256;

/** One route's two readings: the tick under test, and the tick the flash is spent on. */
interface Route {
  /** The state the tick under test left. */
  under: WickSnapshot;
  /** The pixels that tick drew. */
  pixels: PixelRect;
  /** The state `HURT_FLASH_TICKS` further ticks left. */
  spent: WickSnapshot;
  /** The pixels that later tick drew. */
  spentPixels: PixelRect;
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/** A harness this suite owns, disposed when the check ends. */
async function open(): Promise<Harness> {
  const h = await createHarness();
  harnesses.push(h);
  return h;
}

it("draws the playing frame differently while hurtFlash is above 0", async () => {
  const flashed = await open();
  const withFlash: Route = await captureReplay(flashed, "flash", async () => {
    const under = await armFlash(flashed);
    const pixels = stageFrame(flashed);
    const spent = await advanceTicks(flashed, HURT_FLASH_TICKS);
    return { under, pixels, spent, spentPixels: stageFrame(flashed) };
  });

  const plain = await open();
  poseRat(plain);
  plain.debug.setHp(withFlash.under.run.player.hp);
  const under = await advanceTicks(plain, 1);
  const pixels = stageFrame(plain);
  const spent = await advanceTicks(plain, HURT_FLASH_TICKS);
  const withoutFlash: Route = {
    under,
    pixels,
    spent,
    spentPixels: stageFrame(plain),
  };

  // The two frames are posed on one state but for the timer.
  assertGreaterThan(
    withFlash.under.run.hurtFlash,
    0,
    "hurtFlash on the frame the hit armed (specs/world.md, Contact damage)",
  );
  assertEqual(
    withoutFlash.under.run.hurtFlash,
    0,
    "hurtFlash on the frame posed without a hit",
  );
  for (const [what, a, b] of [
    ["the screen", withFlash.under.screen, withoutFlash.under.screen],
    ["the run clock", withFlash.under.run.tick, withoutFlash.under.run.tick],
    [
      "the health",
      withFlash.under.run.player.hp,
      withoutFlash.under.run.player.hp,
    ],
    [
      "the enemies on the field",
      withFlash.under.run.enemies.length,
      withoutFlash.under.run.enemies.length,
    ],
  ] as const) {
    assertEqual(b, a, `${what}, which the two frames share`);
  }

  // The control: with the flash spent, the two routes draw one picture.
  assertEqual(
    withFlash.spent.run.hurtFlash,
    0,
    `hurtFlash ${HURT_FLASH_TICKS} ticks after the hit (specs/world.md, Timers)`,
  );
  assertEqual(
    withoutFlash.spent.run.player.hp,
    withFlash.spent.run.player.hp,
    "the health both runs hold once the flash is spent",
  );
  assertEqual(
    pixelsDiffering(withFlash.spentPixels, withoutFlash.spentPixels),
    0,
    "pixels the two routes differ in once neither is flashing, which must be none",
  );

  assertGreaterThan(
    pixelsDiffering(withFlash.pixels, withoutFlash.pixels),
    CAST_PIXELS,
    "pixels the flashing frame differs from the same state drawn with hurtFlash 0 in (specs/ui.md, the playing HUD table)",
  );
});
