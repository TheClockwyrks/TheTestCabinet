// presentation/fault-effect-at-the-named-part — a fault that names no mote marks
// the part instead.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Fault |
// `assets/particles/fault.json` | the position of the mote the fault of
// `specs/simulation.md` names, lowest in `y` and then lowest in `x` among them, OR
// THE ANCHOR HEX OF THE PART IT NAMES WHEN IT NAMES NO MOTE."
//
// WHICH FAULTS NAME NO MOTE is `specs/simulation.md`'s payload table: "Every fetch
// fault | `parts`: the faulting part | `motes`: empty." So a fetch fault is exactly
// the case this clause is for, and `unmounted` is one of them: "`unmounted` |
// `advance` or `recede` on a part not on a track." The fetch step is where it is
// raised — "1. Fetch. Each part reads its tape cell for this cycle ... A non-blank
// cell the part cannot perform raises the fault named for it under Faults" — and
// "When more than one part faults at one fetch, the run raises the fault of the
// EARLIEST such part in placement order and names that part."
//
// THE WORLD IS TWO ARMS AND NO TRACK. The first, west, carries `advance` and so
// cannot perform its cell; the second, east, carries a blank, "which every part
// rests on" (`specs/instrumentation.md`) and "never faults"
// (`specs/simulation.md`). So exactly one part faults, the payload names exactly
// that one, and the second arm is a part on the field that the fault does NOT name
// — which is what the effect's position is read against. `specs/parts.md` puts an
// arm's anchor on one hex, and that is the hex the clause names.
//
// THE FIELD IS EMPTY OF MOTES, which is both the point and the isolation: the
// clause is about a fault whose `motes` are empty, and with nothing on the field
// nothing but the effect can change the picture. No rise and no set is placed, so
// no aperture turns; and "A fault freezes the run where it stood: the status
// becomes `faulted` and nothing advances further" (`specs/simulation.md`).
//
// HOW AN EFFECT IS READ. A played system goes on changing the picture over the
// frames after the one it fired on — "A play is watched rather than glimpsed: an
// instance fired on one frame goes on changing the picture at its event's position
// over the frames that follow it, decaying to empty across them rather than being
// over by the next frame" (`specs/assets.md`) — where it
// plays, and each is "authored radially symmetric", so an instance on the faulting
// arm's anchor moves more of that hex than of the other arm's, six hexes away.
//
// THE VERDICT. The run faults as `unmounted`, naming the west arm and no mote at
// all; the pixels around that arm's anchor change; and they change more than the
// pixels around the arm the fault does not name.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { HEX_PITCH, SPEEDS } from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";

/** The fastest speed step, so the frame that faults is a short one. */
const FAST = SPEEDS.length - 1;

/**
 * One arm that fetches `advance` while mounted on nothing, and one that rests.
 *
 * Neither anchor is a cell of any track, because no track is placed, so the first
 * cannot perform its cell. Placement order is the order the document lists them,
 * which is the order `sim.fault.parts` is reported in.
 */
const MACHINE = solution([
  armPart("arm", WEST.q, WEST.r, 0, 1, ["advance"]),
  armPart("arm", EAST.q, EAST.r, 0, 1, []),
]);

/** Half the hex pitch: the square read back covers one hex and no neighbour's centre. */
const PATCH_R = HEX_PITCH / 2;

/** How many frames after the fault the picture is watched over. */
const WATCHED = 6;

/** How long each of those frames is, in seconds of game time. */
const WATCH_SECONDS = 0.008;

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

it("plays the fault effect on the anchor of the part an unmounted fault names", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE, speed: FAST });
  const ids = await partIds(h);
  const faulting = ids[0] ?? -1;

  const moved = await captureReplay(h, "unmounted", async () => {
    await advanceCycles(h, 1, 1);

    const halted = await h.snapshot();
    assertEqual(
      halted.sim?.status,
      "faulted",
      "advance on a part that is on no track cannot be performed, so the run faults",
    );
    assertEqual(
      halted.sim?.fault?.kind,
      "unmounted",
      "and the fault is the unmounted of specs/simulation.md",
    );
    assertDeepEqual(
      halted.sim?.fault?.motes,
      [],
      "a fetch fault names no mote, which is the clause under test",
    );
    assertDeepEqual(
      halted.sim?.fault?.parts,
      [faulting],
      "and names the faulting part alone, the arm resting on a blank cell excepted",
    );
    assertLength(
      halted.sim?.motes ?? [],
      0,
      "the field is empty, so nothing on it can move on its own",
    );

    const measured = await churn([hexCenter(WEST), hexCenter(EAST)]);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "faulted",
      "nothing advanced while the picture was watched: a fault freezes the run",
    );
    return measured;
  });

  assertGreaterThan(
    moved[0] ?? 0,
    0,
    "a fault naming no mote is played at the anchor hex of the part it names, " +
      "so the picture on that hex changes across the frames after the fault",
  );
  assertEqual(
    moved[1] ?? 0,
    0,
    "and at THAT part rather than at the arm the fault does not name: not one " +
      "pixel of that arm's own hex, six hexes away, changes",
  );
});
