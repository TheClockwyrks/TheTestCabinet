// presentation/no-delivery-without-a-consumption — a boundary passing over a set
// that took nothing leaves that set's hex alone.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Delivery |
// `assets/particles/deliver.json` | each set that CONSUMED AT LEAST ONE ACCEPTED
// CONSTELLATION at this boundary, on its anchor hex." The condition is the whole
// point: what the effect marks is a delivery, not the passing of a boundary. Sets
// are evaluated at every boundary — `specs/simulation.md`: "After the four waves,
// every set is evaluated, then every rise" — so a set with nothing to take is
// evaluated and takes nothing, and the table gives it no effect.
//
// HOW AN EFFECT IS READ. A played system is a picture that changes from frame to
// frame ("Each play of a system varies, and that variation is correct"), where it
// plays. So the check poses a world in which nothing else on the field can move and
// asks whether the unfed set's own hex moved at all.
//
// A FED SET STANDS BESIDE IT, and that is what makes the silence mean something. If
// the check read only the unfed set, a build that played no delivery ANYWHERE would
// pass it; the fed set is the positive control, on the same boundary, on the same
// frames, six hexes away. So the verdict reads as one sentence: the delivery
// happened, and it happened only where something was delivered.
//
// WHY NOTHING ELSE CAN MOVE, AND THE ONE THING THAT COULD. The machine is two sets:
// no arm, no wheel, no track, no sigil, no rise, and — after the boundary — no
// mote. The single exception is each set's own APERTURE, which "draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet". So every frame sampled is driven inside ONE aperture frame time, and the
// check asserts the index the formula names never moved.
//
// THE CHALLENGE IS `TWO_AND_TWO`, whose two products are a lone `dust` and a lone
// `nova`. Only the `dust` set is given a mote, so the `nova` set is evaluated at the
// same boundary and accepts nothing — its tally stays `0`, which the check reads
// before it reads the pixels.
//
// THE VERDICT. The fed set's tally rose and its hex moved; the unfed set's tally
// stayed `0` and NOT ONE PIXEL of its hex changed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { APERTURE_FRAME_TIME, HEX_PITCH, SPEEDS } from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { EAST, TWO_AND_TWO, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  pixelsDiffering,
  placeSet,
  spawnMote,
  tallyOf,
  type Harness,
  type PixelRect,
} from "../harness";

/** The fastest speed step, so the whole scenario fits inside one frame time. */
const FAST = SPEEDS.length - 1;

/** Half the hex pitch: the square read back covers one hex and no neighbour's centre. */
const PATCH_R = HEX_PITCH / 2;

/** How many frames after the boundary the picture is watched over. */
const WATCHED = 4;

/** How long each of those frames is, in seconds of game time. */
const WATCH_SECONDS = 0.015;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The square of the stage around a point, read back as pixels. */
function patch(point: StagePoint): Promise<PixelRect> {
  return h.pixelRect(
    point.x - PATCH_R,
    point.y - PATCH_R,
    PATCH_R * 2,
    PATCH_R * 2,
  );
}

/** How many pixels of each patch changed over the frames driven. */
async function churn(points: readonly StagePoint[]): Promise<number[]> {
  let before = await Promise.all(points.map(patch));
  const moved = points.map(() => 0);
  for (let frame = 0; frame < WATCHED; frame += 1) {
    await h.advanceSeconds(WATCH_SECONDS, 1);
    const now = await Promise.all(points.map(patch));
    for (const [index, rect] of now.entries()) {
      moved[index] =
        (moved[index] ?? 0) + pixelsDiffering(rect, before[index] as PixelRect);
    }
    before = now;
  }
  return moved;
}

it("leaves the unfed set's hex unchanged while the fed set beside it delivers", async () => {
  await openBareRun(h, { challenge: TWO_AND_TWO, speed: FAST });
  await placeSet(h, 0, WEST, 0);
  await placeSet(h, 1, EAST, 0);
  await spawnMote(h, WEST, "dust");

  const moved = await captureReplay(h, "quiet", async () => {
    await advanceCycles(h, 1, 1);

    const passed = await h.snapshot();
    assertEqual(
      tallyOf(passed, 0),
      1,
      "the fed set took its constellation at this boundary",
    );
    assertEqual(
      tallyOf(passed, 1),
      0,
      "and the set beside it accepted no constellation, though the same boundary passed over it",
    );
    assertEqual(
      moteAt(passed, EAST),
      null,
      "there was nothing on its footprint for it to take",
    );
    assertLength(
      passed.sim?.motes ?? [],
      0,
      "and nothing is left on the field that could move on its own",
    );

    const opened = Math.floor(passed.simTime / APERTURE_FRAME_TIME);
    const measured = await churn([hexCenter(WEST), hexCenter(EAST)]);
    assertEqual(
      Math.floor((await h.snapshot()).simTime / APERTURE_FRAME_TIME),
      opened,
      "every frame watched fell inside one APERTURE_FRAME_TIME, so neither " +
        "aperture changed its frame and neither can be what moved a picture",
    );
    return measured;
  });

  assertGreaterThan(
    moved[0] ?? 0,
    0,
    "the set that consumed plays its delivery, so this reading can see one at all",
  );
  assertEqual(
    moved[1] ?? 0,
    0,
    "and the set that consumed nothing plays none: not one pixel of its hex " +
      "changes, so the effect marks a delivery rather than every boundary",
  );
});
