// presentation/deliver-effect-per-consuming-set — two sets that both took something
// at one boundary each play a delivery, each on its own hex.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Delivery |
// `assets/particles/deliver.json` | EACH SET that consumed at least one accepted
// constellation at this boundary, ON ITS ANCHOR HEX." "Each" and "its own" are the
// two words this point turns on: the effect belongs to the set, not to the
// boundary, so a boundary at which two sets consumed raises two of them, in two
// places. `specs/simulation.md` puts them at one moment: "After the four waves,
// EVERY SET IS EVALUATED, then every rise, each in the same reading order."
//
// HOW AN EFFECT IS READ. Not by which module a build calls — that is the build's —
// but by what the frames DO. "A play is watched rather than glimpsed: an instance
// fired on one frame goes on changing the picture at its event's position over the
// frames that follow it, decaying to empty across them rather than being over by
// the next frame" (`specs/assets.md`). So the check poses a world in which nothing
// else on the field can move and counts the pixels that changed inside each set's
// own hex over the frames AFTER the boundary.
//
// WHY NOTHING ELSE CAN MOVE, AND THE ONE THING THAT COULD. The machine is two sets:
// no arm, no wheel, no track, no sigil, no rise, and — after the boundary consumed
// them — no mote. The single exception is each set's own APERTURE, which "draws
// frame `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet". So every frame sampled is driven inside ONE aperture frame time, and the
// check asserts the index the formula names never moved. What is left that can
// change either picture is a delivery.
//
// THE CHALLENGE IS `TWO_AND_TWO`, whose two products are a lone `dust` and a lone
// `nova`, so each set accepts one mote of its own type and neither can take the
// other's. The two stand `WEST` and `EAST` — six hexes apart, further than any
// instance a radially symmetric system places on one of them reaches the other's
// hex in the frames watched, so the two readings are of two effects rather than of
// one big one.
//
// THE VERDICT. Both tallies rose at the one boundary; the aperture frame index
// never moved; and the pixels inside EACH set's anchor hex changed. A build that
// played one delivery for the boundary rather than one per consuming set leaves one
// of the two hexes still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { APERTURE_FRAME_TIME, HEX_PITCH, SPEEDS } from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { EAST, TWO_AND_TWO, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
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

it("changes the picture on both anchor hexes when both sets consumed", async () => {
  await openBareRun(h, { challenge: TWO_AND_TWO, speed: FAST });
  await placeSet(h, 0, WEST, 0);
  await placeSet(h, 1, EAST, 0);
  await spawnMote(h, WEST, "dust");
  await spawnMote(h, EAST, "nova");

  const moved = await captureReplay(h, "pair", async () => {
    await advanceCycles(h, 1, 1);

    const consumed = await h.snapshot();
    assertEqual(
      tallyOf(consumed, 0),
      1,
      "the dust set took its constellation at this boundary",
    );
    assertEqual(
      tallyOf(consumed, 1),
      1,
      "and the nova set took its own, at the same boundary",
    );
    assertLength(
      consumed.sim?.motes ?? [],
      0,
      "both motes have left the field, so nothing on it can move on its own",
    );
    assertLength(
      consumed.editor.parts,
      2,
      "the machine is those two sets alone",
    );

    const opened = Math.floor(consumed.simTime / APERTURE_FRAME_TIME);
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
    "the first consuming set plays a delivery on its own anchor hex",
  );
  assertGreaterThan(
    moved[1] ?? 0,
    0,
    "and so does the second, at the same boundary — the effect is per consuming " +
      "set rather than one for the boundary",
  );
});
