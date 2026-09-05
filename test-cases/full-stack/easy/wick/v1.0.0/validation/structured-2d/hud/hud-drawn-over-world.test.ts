// hud/hud-drawn-over-world — the HUD is drawn over the live world, not under it.
//
// THE REQUIREMENT. `specs/ui.md` — "Presentation": "Every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`), the HUD included, which is drawn over the
// live world", and "`playing`": "The HUD is drawn over the world and reads
// against it."
//
// WHAT "OVER" IS READ AS. The order the frame drew them in, which is what "over"
// means to a canvas and the one reading that does not assume a style: `specs/ui.md`
// fixes "no palette, no font, and no styling for any screen", so a build is free
// to draw its bar solid, outlined, or part transparent, and a reading that asked
// whether the moth's colours survived under the bar would fail a perfectly
// legible translucent HUD. So the frame is read as the sequence it is: the moth
// is found among the bitmaps the frame blitted, and something must paint over
// the bar AFTER the last of them, so a build that lays the HUD down and then
// draws the world again over it answers no. Every way a build has of painting
// over a rectangle counts — a rectangle filled outright, a path filled or
// stroked, a bitmap blitted, a run of text anchored inside — so a HUD drawn as
// shapes and a HUD composed offscreen and blitted in one call both answer.
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
// THE CONTROL. The moth's own blit must be there to find, which is the moth
// being drawn at all, so a build that draws no enemy passes nothing here.

import { afterEach, it } from "vitest";
import {
  BASE_MAX_HP,
  ENEMY_FRAMES,
  STAGE_CX,
  STAGE_CY,
  TICK_HZ,
  assetFile,
  enemyFrame,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
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
  changedBand,
  differenceMask,
  frame,
  holds,
  lastBlitIndex,
  paintsIn,
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

/** How far the posed point may land from the point it was computed for. */
const PLACEMENT_DRIFT = 1;

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

/** The ids of every frame of the moth's produced sheet, as the loader names them. */
const MOTH_IDS = new Set(
  Array.from({ length: ENEMY_FRAMES }, (_, at) =>
    assetFile(enemyFrame(UNDER, at)),
  ),
);

it("paints the HUD over the world", async () => {
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

  const overlap = roundRect({
    x: Math.max(hiddenBox.x, bar.x),
    y: Math.max(hiddenBox.y, bar.y),
    w:
      Math.min(hiddenBox.x + hiddenBox.w, bar.x + bar.w) -
      Math.max(hiddenBox.x, bar.x),
    h:
      Math.min(hiddenBox.y + hiddenBox.h, bar.y + bar.h) -
      Math.max(hiddenBox.y, bar.y),
  });
  assertGreaterThanOrEqual(
    overlap.w * overlap.h,
    1,
    "the overlap of the moth's sprite and the bar, in pixels",
  );

  const drewMoth = lastBlitIndex(covered.calls, (blit) =>
    MOTH_IDS.has(blit.id),
  );
  assertNotNull(
    drewMoth,
    `a blit of ${UNDER}'s produced sheet among the frame's recorded calls`,
  );
  assertGreaterThan(
    paintsIn(covered.calls, overlap) -
      paintsIn(covered.calls.slice(0, drewMoth ?? 0), overlap),
    0,
    "the drawing operations that painted inside the health bar after the frame had finished drawing the moth beneath it",
  );
});
