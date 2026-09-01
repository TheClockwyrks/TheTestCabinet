// lamplighter/ground-fixed-in-world — the ground pattern keeps its place in the
// world as the lamplighter walks, so it slides under the figure by the opposite
// of the movement.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The ground is drawn as a pattern fixed in world space and repeating on both
// axes, so that the lamplighter's motion reads against it. What the pattern
// looks like is yours." specs/overview.md says the same from the player's side:
// "The ground carries a repeating pattern fixed in world space, so the
// lamplighter's movement reads as the ground sliding beneath a figure held at
// the stage center." The camera formula fixes the slide exactly: a world point
// draws at `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`, so after the
// lamplighter has moved `dx` units right the ground that stood at stage `x`
// stands at stage `x - dx`. Two things follow and both are asserted: the
// picture of the ground after the move is the picture before it shifted `dx`
// units left, and the two pictures differ at the same stage points, which is
// what "motion reads against it" needs at all.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive and nothing held, so the world under
// the camera is the ground and the figure. One frame renders the posed night
// and is read; a real held ArrowRight then runs `MOVE_TICKS` frames, and the
// last is read. `MOVE_TICKS` is `11`, so the move is `33` units, a distance
// that is not a multiple of the `64`-unit tile (specs/assets.md) nor of the
// halves, quarters, eighths, or sixteenths a pattern is likely drawn on, so a
// pattern fixed to the SCREEN cannot pass by periodicity.
//
// WHERE IT IS READ. A `REGION` of the stage to the lamplighter's right on its
// own row, clear of the sprite at the center and of anything a build is likely
// to lay over the ground there in screen space; the specification fixes no
// layout for the HUD, so the read tolerates a tenth of the region being
// something other than ground. The before-picture is read `SHIFT_REACH` units
// wider than the after-picture so the shifted comparison has ground to compare
// against.
//
// TOLERANCES. The movement is read from the snapshot rather than assumed, and
// the shift is tried at its floor and its ceiling, because a build may round a
// fractional camera offset either way before it blits: that is `BLIT_TOL`'s
// allowance, applied to a whole picture. `GROUND_SHIFT_MATCH_MIN` (`0.9`) is
// the share of the region that has to match under the better of the two, and
// `GROUND_CHANGE_MIN` (`0.005`) the share that has to differ with no shift
// applied; both are stated in `constants.ts` with their reasons.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { GROUND_CHANGE_MIN, GROUND_SHIFT_MATCH_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  displacement,
  isolate,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";

/** The frames of the held ArrowRight: `11`, so the move is `33` units. */
const MOVE_TICKS = 11;

/** The stage rectangle read, right of the lamplighter on its row. */
const REGION = { x: 760, y: 300, width: 400, height: 120 } as const;

/** How much wider the before-picture is read: past the greatest shift tried. */
const SHIFT_REACH = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The columns of `rect` from `from`, `width` of them, as a rectangle of their own. */
function columns(rect: PixelRect, from: number, width: number): PixelRect {
  const data = new Uint8ClampedArray(width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const row = (y * rect.width + from) * 4;
    data.set(rect.data.subarray(row, row + width * 4), y * width * 4);
  }
  return { width, height: rect.height, data };
}

/** The share of `after`'s pixels that match `before` shifted `shift` columns. */
function matchShifted(
  before: PixelRect,
  after: PixelRect,
  shift: number,
): number {
  const slice = columns(before, shift, after.width);
  const differing = pixelsDiffering(after, slice);
  return 1 - differing / (after.width * after.height);
}

it("slides the ground under the lamplighter by the opposite of its movement", async () => {
  const opened = await isolate(h);

  const read = await captureReplay(h, "ground", async () => {
    await h.step(1);
    const before = await h.pixelRect(
      REGION.x,
      REGION.y,
      REGION.width + SHIFT_REACH,
      REGION.height,
    );
    await h.hold("ArrowRight");
    let moved;
    try {
      moved = await h.step(MOVE_TICKS);
    } finally {
      await h.release("ArrowRight");
    }
    const after = await h.pixelRect(
      REGION.x,
      REGION.y,
      REGION.width,
      REGION.height,
    );
    return { before, after, moved };
  });

  assertEqual(read.moved.screen, "playing", "the screen the move ran on");
  const dx = displacement(opened, read.moved).x;
  assertGreaterThan(dx, 0, "the lamplighter's movement along x, in units");
  assertGreaterThanOrEqual(
    SHIFT_REACH,
    Math.ceil(dx),
    "the reach of the before-picture, against the movement",
  );

  const shifts = [...new Set([Math.floor(dx), Math.ceil(dx)])];
  const matched = Math.max(
    ...shifts.map((shift) => matchShifted(read.before, read.after, shift)),
  );
  assertGreaterThanOrEqual(
    matched,
    GROUND_SHIFT_MATCH_MIN,
    `the share of the region matching the ground that stood ${dx} units further right before the move`,
  );

  const changed = 1 - matchShifted(read.before, read.after, 0);
  assertGreaterThanOrEqual(
    changed,
    GROUND_CHANGE_MIN,
    "the share of the region that changed at the same stage points over the move",
  );
});
