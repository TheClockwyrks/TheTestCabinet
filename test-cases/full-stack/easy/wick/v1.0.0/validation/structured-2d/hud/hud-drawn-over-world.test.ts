// hud/hud-drawn-over-world — the HUD is drawn over the live world, not under it.
//
// THE REQUIREMENT. `specs/ui.md` — "Presentation": "Every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`), the HUD included, which is drawn over the
// live world", and "`playing`": "The HUD is drawn over the world and reads
// against it."
//
// THE DRIVE. A moth is posed where the health bar is drawn, and the frame is
// compared with the same frame without it. `specs/instrumentation.md` gives
// `spawnEnemy(type, x, y)`, which "Spawns one enemy of `type` ... centered at
// `(x, y)` through the real spawn path"; with `enemyMotion` and `enemyContact`
// both off it stays where it was put and nothing happens to the lamplighter, so
// the only difference between the two frames is one moth standing under the bar.
//
// WHERE THE BAR IS, WITHOUT KNOWING THE LAYOUT. This point needs a place on the
// HUD to pose the moth at, and `specs/ui.md` fixes no layout, so the place is
// found rather than known. It is found through the one HUD element that file
// makes measurable, the health bar, exactly as `hud/health-bar-scales` measures
// it: the band of pixels that changed between a frame at full health and one at
// almost none is the bar's own fill and nothing else. Its centre, carried back
// through the engine's fit and the camera, is the world point the moth is posed
// at, and the scenario checks the moth really landed there by looking for its
// produced sprite inside that band rather than trusting the arithmetic. A build
// whose health bar does not scale, which `hud/health-bar-scales` is the point
// about, leaves this point nothing to pose under and fails here too.
//
// THE READING, AND THE CONTROL. A third run poses the same moth in the open, out
// in the world beside the lamplighter, and how much of the canvas it changes
// there is what one moth is worth on this build. The moth under the bar is then
// read against that, over the same part of the same sprite: a HUD drawn over the
// world leaves the bar's own pixels as they were, so almost none of that worth
// reaches them, while a HUD drawn under the world lets the moth through and
// nearly all of it does. `SHOWING_THROUGH` (a quarter) is the bound, and what it
// leaves room for is a build that draws its HUD slightly clear of the night
// beneath rather than one that draws the night on top of it. The control is also
// what makes the reading honest: a build whose moth is invisible everywhere
// changes nothing in the open and fails there rather than passing here for the
// wrong reason.

import { afterEach, it } from "vitest";
import {
  BASE_MAX_HP,
  ENEMY_FRAMES,
  STAGE_CX,
  STAGE_CY,
  TICK_HZ,
  enemyFrame,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertPointNear,
} from "../assert";
import {
  advanceTicks,
  blitsFrom,
  createHarness,
  captureStill,
  isolate,
  placeEnemy,
  type Blit,
  type DrawCall,
  type Harness,
  type PixelRect,
} from "../harness";
import { textSpansDiffering } from "./readouts";
import {
  changeEnergy,
  changedBand,
  differenceMask,
  frame,
  holds,
  roundRect,
  stagePointOf,
  withoutColumns,
  type Rect,
} from "./regions";

/** The two healths the bar is found between, as `hud/health-bar-scales` uses. */
const NEARLY_EMPTY = 1;
const FULL = BASE_MAX_HP;

/** Ticks run after each pose, so an eased bar has arrived. */
const SETTLE_TICKS = TICK_HZ;

/** The share of one moth's worth of change the bar may let through. */
const SHOWING_THROUGH = 0.25;

/** How far the posed point may land from the point it was computed for. */
const PLACEMENT_DRIFT = 1;

/**
 * How far to the side of the lamplighter the control moth stands, in world
 * units. Far enough to clear the lamplighter it would otherwise be drawn over,
 * and near enough to stay in the middle of the view, which is the part of the
 * stage a HUD leaves clear so the night can be played.
 */
const CONTROL_OFFSET = 150;

/** The enemy posed under the bar, the commonest of the night. */
const UNDER = "moth";

interface Frame {
  h: Harness;
  pixels: PixelRect;
  blits: Blit[];
  calls: DrawCall[];
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/** An isolated run posed at `hp`, settled, and the frame it left. */
async function frameAt(
  hp: number,
  pose: (h: Harness) => void = () => {},
): Promise<Frame> {
  const h = await createHarness();
  harnesses.push(h);
  isolate(h);
  h.debug.setHp(hp);
  pose(h);
  const settled = await advanceTicks(h, SETTLE_TICKS);
  assertEqual(settled.screen, "playing", `the screen at ${hp} health`);
  const blits = await h.frameBlits();
  return { h, pixels: frame(h), blits, calls: h.lastCalls() };
}

/** Pose one moth at the world point a STAGE point stands over. */
function mothAtStage(x: number, y: number): (h: Harness) => void {
  return (h) => {
    const { player } = h.snapshot().run;
    placeEnemy(h, UNDER, player.x + x - STAGE_CX, player.y + y - STAGE_CY);
  };
}

/** Where the frame drew the moth's produced sheet, whichever frame of it. */
function mothBox(drawn: Frame): Rect {
  const blits: Blit[] = [];
  for (let at = 0; at < ENEMY_FRAMES; at += 1) {
    blits.push(...blitsFrom(drawn.blits, enemyFrame(UNDER, at)));
  }
  assertGreaterThan(blits.length, 0, `blits of ${UNDER}'s produced sheet`);
  const sprite = blits[blits.length - 1];
  return roundRect({ x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h });
}

/** The rectangle two rectangles share. */
function overlapOf(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.min(a.x + a.w, b.x + b.w) - x,
    h: Math.min(a.y + a.h, b.y + b.h) - y,
  };
}

it("draws the HUD over the world", async () => {
  const full = await frameAt(FULL);
  const empty = await frameAt(NEARLY_EMPTY);
  const bar = changedBand(
    withoutColumns(
      differenceMask(full.pixels, empty.pixels),
      textSpansDiffering(full.calls, empty.calls),
    ),
  );
  assertGreaterThan(bar.w, 0, "the width of the health bar the frames found");
  assertGreaterThan(bar.h, 0, "the height of the health bar the frames found");

  const centre = { x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 };
  const over = stagePointOf(full.h, centre.x, centre.y);
  const covered = await frameAt(FULL, mothAtStage(over.x, over.y));
  captureStill(covered.h, "over");
  const beside = await frameAt(
    FULL,
    mothAtStage(STAGE_CX + CONTROL_OFFSET, STAGE_CY),
  );

  const posed = covered.h.snapshot();
  assertEqual(posed.run.enemies.length, 1, "the enemies the posed world holds");
  assertPointNear(
    covered.h.device(posed.run.enemies[0].x, posed.run.enemies[0].y),
    centre,
    PLACEMENT_DRIFT,
    "where the posed moth landed on the canvas",
  );

  const hiddenBox = mothBox(covered);
  assertEqual(
    holds(bar, hiddenBox.x + hiddenBox.w / 2, hiddenBox.y + hiddenBox.h / 2),
    true,
    "the moth's sprite drawn inside the health bar",
  );

  const overlap = roundRect(overlapOf(hiddenBox, bar));
  assertGreaterThanOrEqual(
    overlap.w * overlap.h,
    1,
    "the overlap of the moth's sprite and the bar, in pixels",
  );

  // The same part of the same sprite, out in the open: the overlap's offset
  // inside the hidden moth's box, carried onto the control moth's box.
  const openBox = mothBox(beside);
  const slice: Rect = {
    x: openBox.x + (overlap.x - hiddenBox.x),
    y: openBox.y + (overlap.y - hiddenBox.y),
    w: overlap.w,
    h: overlap.h,
  };
  const worth = changeEnergy(full.pixels, beside.pixels, slice);
  assertGreaterThan(worth, 0, "how much one moth changes standing in the open");

  assertLessThanOrEqual(
    changeEnergy(full.pixels, covered.pixels, overlap) / worth,
    SHOWING_THROUGH,
    `the share of one moth's change the bar let through (${overlap.w} x ${overlap.h} pixels of overlap, ${worth.toFixed(1)} of change in the open)`,
  );
});
