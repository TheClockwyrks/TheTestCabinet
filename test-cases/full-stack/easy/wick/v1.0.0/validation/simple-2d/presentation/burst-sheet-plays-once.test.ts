// presentation/burst-sheet-plays-once — Flare's six-frame sheet plays through
// once, in order, over the burst's flash.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "A strike
// draws frame floor(t / (SPARK_FLASH / 4)) and a burst frame floor(t /
// (FLARE_FLASH / 6)), for t the seconds of ticks since the tick the zone
// appeared, so each sheet plays once through over its flash." FLARE_FLASH is
// 0.4 seconds, so a frame lasts 0.4 / 6, which specs/world.md's timer rule
// makes round((0.4 / 6) × TICK_HZ) = 4 ticks, and the zone's own flash of 0.4
// seconds is 24 ticks, exactly the six frames. specs/assets.md ("The weapon
// effects") gives the files: "flare burst | Flare |
// assets/sprites/effects/flare/0.png to 5.png | a sheet of 6, played once", so
// the file a blit painted is the frame that was up. WHERE the frame is drawn
// belongs to the point about the burst over its shape; this one reads which
// frame alone.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// other weapon held, every driver switch off but the one the firing needs.
// Flare "fires whether or not any enemy exists", so nothing has to stand in the
// blast and nothing else can draw. Flare alone is held at level 1 and armed, so
// the next tick fires it; its 60-second cooldown puts the next firing far
// beyond the sweep, and one sheet plays.
//
// WHAT IS READ. The frame number carried by the file the last flare blit
// painted, on the firing tick and on each of the SWEEP_TICKS ticks after it,
// against floor(t / 4) for t that many ticks. The frames those readings ran
// through, with each run collapsed to one entry, against 0 through 5 in order,
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
import { EFFECT_SPRITES, FLARE_FLASH, ticksFor } from "../constants";
import {
  armWeapon,
  blitsOf,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { assertFrameAt, drawnUnder, frameNumber } from "./drawn";

/** The level held; Flare ignores amount, so one burst fires. */
const LEVEL = 1;

/** Ticks each frame is shown: round((FLARE_FLASH / 6) × TICK_HZ). */
const FRAME_TICKS = ticksFor(FLARE_FLASH / EFFECT_SPRITES.flare.frames);

/** Ticks driven after the firing tick: one short of the flash's 24. */
const SWEEP_TICKS = ticksFor(FLARE_FLASH) - 2;

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

it("draws flare frames 0 to 5 in order over the burst's flash", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  const slot = holdWeapon(h, "flare", LEVEL);
  armWeapon(h, slot);

  const drawn = await captureReplay(h, "burst", async () => {
    const frames: number[] = [];
    const read = (tick: number): void => {
      const blit = drawnUnder(
        blitsOf(h.lastCalls()),
        EFFECT_SPRITES.flare.path,
        `burst ${tick} ticks after it fired`,
      );
      frames.push(frameNumber(blit.id, "flare"));
    };
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "burst"),
      1,
      "the bursts the firing tick fired",
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
      `the burst's drawn frame ${tick} ticks after it fired`,
    );
  }
  assertDeepEqual(
    runs(drawn),
    [0, 1, 2, 3, 4, 5],
    "the frames the burst's sheet ran through, in order",
  );
});
