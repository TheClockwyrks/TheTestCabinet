// presentation/arm-length-visible — the drawn shaft reaches the gripper the arm's
// live length puts on the field, and stops there.
//
// THE RULE. "An arm's spokes, its length, and whether each gripper is holding are
// visible" (`specs/parts.md`, Presentation). What length means is the same file's
// anatomy: "one gripper per spoke at `base + length * DIRS[d]`", with "Length ... a
// whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`), chosen in the
// editor". `specs/assets.md` puts "the shaft between a base and each gripper, and
// the length it stands at" among the things the build draws in code.
//
// SO THE READING IS THE SHAFT'S EXTENT. At length `L` the gripper stands
// `L * HEX_PITCH` units out along the spoke, so the shaft covers the ray out to
// there and nothing beyond it. The three stretches between consecutive hexes on
// the ray — centred `24`, `72` and `120` units from the base — are read at each of
// the three lengths, and each is inside the shaft exactly when `L` reaches past
// it. Each sample sits midway between two hex centres, so none of them lands under
// the `40`-unit hub on the base or under a `32`-unit gripper centred on a hex.
//
// THE COMPARISON IS AGAINST THE BARE FIELD, so no colour, width, or style is
// asked of the build — only that a stretch of the ray is painted where the shaft
// runs and untouched where it does not. Read that way, the same arm at
// `ARM_MIN_LEN` and at `ARM_MAX_LEN` is necessarily drawn to different extents:
// the stretch at `120` is painted at `3` and bare at `1`.
//
// ONE ARM, THREE POSES. `setPartLength` is the editor's own length change through
// the surface, so the three readings are the same arm at three lengths rather than
// three arms whose drawing might differ for some other reason.
//
// THE VERDICT. At each of `ARM_MIN_LEN` (`1`), `2` and `ARM_MAX_LEN` (`3`), every
// stretch of the ray inside the arm's reach is drawn and every stretch beyond it
// is bare.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN, HEX_PITCH } from "../constants";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  CHANNEL_EPSILON,
  colorDistance,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * Where each stretch of the spoke is read, in units from the base.
 *
 * Midway between hex `k - 1` and hex `k` along the ray, for `k` of `1`, `2`, `3`:
 * inside the shaft of an arm at length `k` or longer, and outside it below that.
 */
const STRETCHES = [0.5, 1.5, 2.5].map((hexes) => hexes * HEX_PITCH);

/** Where a stretch falls on the stage, along `DIRS[0]` from the base. */
function alongSpoke(distance: number): { x: number; y: number } {
  const base = hexCenter(ORIGIN);
  return { x: base.x + distance, y: base.y };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

async function readStretches(): Promise<Rgb[]> {
  const read: Rgb[] = [];
  for (const distance of STRETCHES) {
    const point = alongSpoke(distance);
    read.push(await sampleColor(h, point.x, point.y, 2));
  }
  return read;
}

it("draws the shaft out to the gripper at each of the three lengths and no further", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);
  const bare = await readStretches();

  const part = await placePart(h, "arm", ORIGIN, 0);
  // The editor outlines the selected part (`specs/editor.md`); this point is
  // about the shaft, so the selection is held clear.
  await h.debug.setSelected(null);

  for (let length = ARM_MIN_LEN; length <= ARM_MAX_LEN; length += 1) {
    await h.debug.setPartLength(part, length);
    await h.advance(1);
    await captureStill(h, "lengths");
    assertEqual(
      partById(await h.snapshot(), part)?.length,
      length,
      `the arm stands at length ${length}, which is the length its shaft is read against`,
    );

    const drawn = await readStretches();
    for (const [index, distance] of STRETCHES.entries()) {
      const moved = colorDistance(bare[index] as Rgb, drawn[index] as Rgb);
      const inside = distance < length * HEX_PITCH;
      if (inside) {
        assertGreaterThan(
          moved,
          CHANNEL_EPSILON,
          `an arm at length ${length} reaches ${length * HEX_PITCH} units out, so the stretch of its spoke ${distance} units from the base is drawn`,
        );
      } else {
        assertLessThanOrEqual(
          moved,
          CHANNEL_EPSILON,
          `an arm at length ${length} reaches only ${length * HEX_PITCH} units out, so the stretch of its spoke ${distance} units from the base is left bare and the three lengths are drawn to different extents`,
        );
      }
    }
  }
});
