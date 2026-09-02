// presentation/delivery-plays-at-a-consuming-set — a set that took a constellation
// plays the delivery effect, on its own anchor hex.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Delivery |
// `assets/particles/deliver.json` | EACH SET THAT CONSUMED AT LEAST ONE ACCEPTED
// CONSTELLATION AT THIS BOUNDARY, ON ITS ANCHOR HEX." The systems are "played
// live", each "authored radially symmetric, so an instance reads correctly wherever
// on the field it plays", and the build's own code places "an instance at its
// event's position". When the boundary evaluates its sets is
// `specs/simulation.md`: "the sigil phase, then sets, then rises".
//
// HOW AN EFFECT IS READ. Not by which module a build calls — that is the build's —
// but by what the frames DO. "Each play of a system varies, and that variation is
// correct" (`specs/assets.md`), so a played effect is a picture that changes from
// frame to frame; and it is placed, so it changes the picture WHERE it plays. The
// check therefore poses a world in which nothing else on the field can move, and
// then counts the pixels that changed inside the set's own hex, and inside a bare
// hex four hexes away.
//
// WHY NOTHING ELSE CAN MOVE, AND THE ONE THING THAT COULD. The machine is one set:
// no arm, no wheel, no track, no sigil, no rise, and — after the boundary consumed
// it — no mote. A run whose parts all rest changes nothing from frame to frame.
// The single exception is the set's own APERTURE, which "draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet" and so changes when `simTime` crosses a frame time. So every frame
// sampled is driven inside ONE aperture frame time, and the check asserts that the
// index the formula names did not move across the whole sample. What is left that
// can change the picture is the delivery.
//
// THE SPEED IS THE FASTEST STEP, `SPEEDS[3]` (`30` cycles per second), so the whole
// boundary and the frames watched after it fit comfortably inside one
// `APERTURE_FRAME_TIME` (`0.12`).
//
// THE SET DOES NOT STAND ON `(0, 0)`, and the hex it is read against is `(0, 0)`.
// The completion effect of the same table is fired at hex `(0, 0)` whatever raised
// it, so a build that fired every effect over the middle of the field would satisfy
// a check whose set stood there. Here it would light the hex the delivery must NOT
// be on and leave the set's own hex dark, and fail both readings.
//
// THE VERDICT. The set's tally rose and its mote is gone, so it consumed; the
// aperture frame index never moved; the pixels inside the set's anchor hex changed;
// and they changed more than the pixels of a hex four hexes away, which is what a
// radially symmetric system played AT THAT ANCHOR does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { APERTURE_FRAME_TIME, HEX_PITCH, SPEEDS } from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { BARE, ORIGIN, WEST } from "../fixtures";
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

/**
 * The bare hex the set's own hex is read against: the middle of the field, three
 * hexes from the set, which is also where the completion effect of the same table
 * would play if a build fired every effect from one place.
 */
const AWAY = ORIGIN;

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

it("changes the picture on the anchor hex of the set that consumed", async () => {
  await openBareRun(h, { challenge: BARE, speed: FAST });
  const set = await placeSet(h, 0, WEST, 0);
  await spawnMote(h, WEST, "sol");

  const moved = await captureReplay(h, "deliver", async () => {
    await advanceCycles(h, 1, 1);

    const consumed = await h.snapshot();
    assertEqual(
      tallyOf(consumed, 0),
      1,
      "the boundary's set phase took the constellation, so this set consumed",
    );
    assertEqual(
      moteAt(consumed, WEST),
      null,
      "and the mote it accepted has left the field",
    );
    assertLength(
      consumed.sim?.motes ?? [],
      0,
      "so nothing is left on the field that could move on its own",
    );
    assertEqual(
      consumed.editor.parts[0]?.id,
      set,
      "the machine is that one set, so no part is moving either",
    );

    const opened = Math.floor(consumed.simTime / APERTURE_FRAME_TIME);
    const measured = await churn([hexCenter(WEST), hexCenter(AWAY)]);
    assertEqual(
      Math.floor((await h.snapshot()).simTime / APERTURE_FRAME_TIME),
      opened,
      "every frame watched fell inside one APERTURE_FRAME_TIME, so the aperture " +
        "drew the same frame throughout and cannot be what changed the picture",
    );
    return measured;
  });

  assertGreaterThan(
    moved[0] ?? 0,
    0,
    "the delivery is played at the consuming set, so the picture on its anchor " +
      "hex changes across the frames after the boundary",
  );
  assertGreaterThan(
    moved[0] ?? 0,
    moved[1] ?? 0,
    "and it is played THERE: a radially symmetric system on the set's anchor " +
      "moves more of that hex than of a bare hex three hexes away",
  );
});
