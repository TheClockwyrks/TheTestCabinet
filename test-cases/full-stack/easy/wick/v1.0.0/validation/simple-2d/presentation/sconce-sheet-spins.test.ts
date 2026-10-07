// presentation/sconce-sheet-spins — Sconce's four-frame sheet advances one
// frame every six ticks, in order, and wraps for as long as the sconce lives.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "A sconce
// draws frame floor(t / WALK_FRAME_TIME) mod 4, for t the seconds of ticks
// since it was fired, so it spins for its life." WALK_FRAME_TIME is 0.1
// seconds, which specs/world.md's timer rule makes round(0.1 × TICK_HZ) = 6
// ticks a frame, and the `mod 4` is the wrap. specs/assets.md ("The weapon
// effects") gives the files: "sconce | Sconce |
// assets/sprites/effects/sconce/0.png to 3.png | a sheet of 4, spinning", so
// the file a blit painted is the frame that was up. WHERE the frame is drawn
// belongs to the point about the sconce over its shape; this one reads which
// frame alone.
//
// THE WORLD. An isolated playing run (`isolate`): nothing else on the field, no
// other weapon held, every driver switch off but the one the firing needs. The
// sconce is FIRED by the weapon rather than posed, because the specification
// counts t "since it was fired" and a firing tick is the only tick that fixes
// which one that is. Sconce "needs at least one enemy to fire", so one hound
// stands 400 units away to give the launch its direction; `enemyMotion` and
// `enemyContact` are off, so it neither moves nor touches anything, and it
// stands far outside a sconce that `effectMotion` holds at the launch point, so
// nothing is hit and nothing dies while the sheet spins. Sconce is held at
// level 1, whose amount is 1, so one sconce spins.
//
// WHAT IS READ. The frame number carried by the file the last sconce blit
// painted, on the firing tick and on each of the SWEEP_TICKS ticks after it,
// against floor(t / 6) mod 4 for t that many ticks. The sweep covers frames 0,
// 1, 2, 3 and back to 0 and 1, which is the advance and the wrap together, and
// sits far inside the level-1 row's duration of 2.5 seconds (150 ticks). A
// build that holds one frame, spins backwards, runs at another rate, or stops
// at frame 3 instead of wrapping fails on one of the readings.
//
// TOLERANCE. Each tick's frame is asserted exactly, except a tick whose t falls
// exactly on a frame boundary, where the frame before it is also accepted:
// `assertFrameAt` states why.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  EFFECT_SPRITES,
  SCONCE_LEVELS,
  WALK_FRAME_TIME,
  ticksFor,
} from "../constants";
import {
  armWeapon,
  blitsOf,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  projectilesOf,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { assertFrameAt, drawnUnder, frameNumber } from "./drawn";

/** Where the hound stands: the launch direction, clear of the launch point. */
const HOUND_AT = { x: 400, y: 0 };

/** The level held: amount 1, so the firing tick launches one sconce. */
const LEVEL = 1;

/** Ticks each frame is shown: round(WALK_FRAME_TIME × TICK_HZ). */
const FRAME_TICKS = ticksFor(WALK_FRAME_TIME);

/** Ticks driven after the firing tick: a full cycle and two frames past it. */
const SWEEP_TICKS = 6 * FRAME_TICKS - 1;

/** The frame the sheet shows `ticks` ticks after the sconce was fired. */
function expected(ticks: number): number {
  return Math.floor(ticks / FRAME_TICKS) % EFFECT_SPRITES.sconce.frames;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the sconce sheet one frame every six ticks and wraps", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  assertEqual(SCONCE_LEVELS[LEVEL - 1].amount, 1, "Sconce's amount at level 1");
  assertEqual(
    ticksFor(SCONCE_LEVELS[LEVEL - 1].duration) > SWEEP_TICKS,
    true,
    "the ticks a level-1 sconce lives, against the ticks driven",
  );
  spawnEnemyAt(h, "hound", HOUND_AT.x, HOUND_AT.y);
  const slot = holdWeapon(h, "sconce", LEVEL);
  armWeapon(h, slot);

  const drawn = await captureReplay(h, "spin", async () => {
    const frames: number[] = [];
    const read = (tick: number): void => {
      const blit = drawnUnder(
        blitsOf(h.lastCalls()),
        EFFECT_SPRITES.sconce.path,
        `sconce ${tick} ticks after it was fired`,
      );
      frames.push(frameNumber(blit.id, "sconce"));
    };
    const fired = await h.tick(1);
    assertLength(
      projectilesOf(fired, "sconce"),
      1,
      "the sconces the firing tick launched",
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
      `the sconce's drawn frame ${tick} ticks after it was fired`,
    );
  }
});
