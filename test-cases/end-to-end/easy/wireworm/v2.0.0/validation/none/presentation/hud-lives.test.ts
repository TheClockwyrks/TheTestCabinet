// Wireworm — presentation/hud-lives: the HUD shows the lives remaining.
//
// specs/ui.md's HUD table: the lives readout shows "the lives remaining, as a
// row of icons or as a count". specs/board.md puts every readout inside the
// bar's own region, `y` in `[0, HUD_H]` (`[0, 80]`). Lives are what the run has
// left (specs/progression.md), so a player who cannot see how many are left
// cannot tell a safe mistake from a fatal one.
//
// THE FILE ALLOWS TWO SPELLINGS, SO THE POINT READS BOTH.
//
// AS A COUNT. Some run of text inside the bar names the posed figure as a
// standalone number — `2`, `x2`, `LIVES 2` all read as two, and the digits `12`
// do not, which is what the standalone reading is for. That settles it outright.
//
// AS A ROW OF ICONS. Otherwise the bar is read as a picture, three times: with
// the lives posed at `0`, at `1`, and at the figure this point decides. The
// pixels that CHANGED against the baseline are exactly the marks the readout
// draws for those lives, and they are counted as connected clusters. Whatever
// one life's mark costs in clusters — one blob, or an outline and a fill drawn
// apart — two lives must cost exactly twice, and that is the reading of "two
// lives shown": the bar draws one more mark per life, and at two it has drawn
// two of them. A build that drew a fixed row of icons, or drew the wrong number
// of them, does not scale that way.
//
// THE `0` BASELINE IS SAFE TO POSE. specs/progression.md ends a run on "a
// contact takes lives to `0`" — the game over is the contact's, not a state the
// build is free to notice on its own — and `startPlaying` holds the cursor's
// contact test off with nothing on the board to touch it. So the baseline frame
// is the same board with no lives drawn on it.
//
// THE SCORE IS POSED AT `0` AND THE LEVEL AT `1`, so no other readout on the bar
// can carry a standalone `2` and be read as the lives.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HUD_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";
import { readRect, type Patch } from "./reading";

/** The lives posed: the figure the point decides. */
const POSED_LIVES = 2;

/** The score and level posed beside them, so no other run carries a 2. */
const POSED_SCORE = 0;
const POSED_LEVEL = 1;

/**
 * How much a pixel must change between two readings to count as drawn, as a sum
 * over the three channels out of `765`.
 *
 * The readings are the same board rendered three times, so a pixel that is not
 * part of the lives readout is identical in all of them and this is a floor
 * under nothing but a build whose bar carries a faint animation of its own. `24`
 * is an average of `8` a channel, well under any mark a player could see.
 */
const CHANGED_MIN = 24;

/**
 * The smallest cluster of changed pixels that counts as a mark, in device
 * pixels.
 *
 * `16` is a four-by-four square, which is below anything legible in an
 * `80`-unit bar and above the stray pixel an anti-aliased edge leaves behind.
 */
const CLUSTER_MIN = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** Pose the lives, run one frame, and read the HUD bar back off the canvas. */
async function barAtLives(lives: number): Promise<Patch> {
  await h.debug.setLives(lives);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).lives,
    lives,
    `the posed lives (${lives}) landed`,
  );
  return readRect(h, 0, 0, STAGE_W, HUD_H);
}

/** How many connected clusters of changed pixels separate two readings. */
function clustersChanged(before: Patch, after: Patch): number {
  const { width, height } = after;
  const changed = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const a = after.pixels[index];
    const b = before.pixels[index];
    if (a === undefined || b === undefined) continue;
    const delta =
      Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    changed[index] = delta > CHANGED_MIN ? 1 : 0;
  }

  const taken = new Uint8Array(width * height);
  let clusters = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (changed[index] === 0 || taken[index] === 1) continue;
    taken[index] = 1;
    let size = 0;
    const pending = [index];
    while (pending.length > 0) {
      const at = pending.pop() as number;
      size += 1;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (changed[next] === 1 && taken[next] === 0) {
            taken[next] = 1;
            pending.push(next);
          }
        }
      }
    }
    if (size >= CLUSTER_MIN) clusters += 1;
  }
  return clusters;
}

/** A standalone occurrence of `figure` in a run: not part of a longer number. */
function names(draw: TextDraw, figure: number): boolean {
  return new RegExp(`(?<![0-9])${figure}(?![0-9])`).test(draw.text);
}

it("shows two lives on the HUD bar, as a count or as two icons", async () => {
  await startPlaying(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLevel(POSED_LEVEL);

  const none = await barAtLives(0);
  const one = await barAtLives(1);
  const posed = await barAtLives(POSED_LIVES);
  // The HUD bar carrying two lives.
  await captureStill(h, "hud");

  // As a count: a run of text on the bar naming the figure on its own.
  const onBar = textDraws(await h.frameCalls()).filter(
    (draw) => draw.y >= 0 && draw.y <= HUD_H,
  );
  if (onBar.some((draw) => names(draw, POSED_LIVES))) return;

  // As a row of icons: one more mark per life, and two of them at two lives.
  const perLife = clustersChanged(none, one);
  if (perLife === 0) {
    fail(
      `the HUD bar to show the lives remaining, as a count among its text or ` +
        `as a row of icons (specs/ui.md); with one life posed the bar drew ` +
        `nothing it does not draw with none, and no run of its text named ` +
        `${POSED_LIVES} on its own`,
      `the bar's runs were ${JSON.stringify(onBar.map((draw) => draw.text))}`,
    );
  }
  assertEqual(
    clustersChanged(none, posed),
    perLife * POSED_LIVES,
    `the HUD bar's lives readout to draw ${POSED_LIVES} marks with ` +
      `${POSED_LIVES} lives posed, where it draws 1 with one (specs/ui.md: ` +
      `the lives remaining, as a row of icons or as a count) — one life's ` +
      `mark measured ${perLife} cluster(s) of changed pixels, so two lives ` +
      `must measure ${perLife * POSED_LIVES}`,
  );
});
