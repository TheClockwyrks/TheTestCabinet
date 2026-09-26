// presentation/completion-effect-plays-on-completion — the boundary that completes
// a run lights up the middle of the field.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Completion |
// `assets/particles/complete.json` | HEX `(0, 0)`, ON THE BOUNDARY THE RUN
// COMPLETES." When that boundary is, is `specs/simulation.md`: "After the rises, if
// every set's tally has reached the challenge's `target`, the run completes: the
// status becomes `complete` and the metrics are recorded."
//
// HOW AN EFFECT IS READ. "A play is watched rather than glimpsed: an instance
// fired on one frame goes on changing the picture at its event's position over the
// frames that follow it, decaying to empty across them rather than being over by
// the next frame" (`specs/assets.md`), and each system is "authored radially
// symmetric", so an instance centered on a hex moves more of that hex than of one
// three hexes away. A completed run is the quietest place there is to read one:
// nothing of the machine advances once the status is `complete`.
//
// AND THE PANEL DOES NOT HIDE IT. Hex `(0, 0)` is the middle of the field, which
// is where the solved panel is drawn, so this point turns on `specs/ui.md`'s
// "Neither panel hides what it covers: at every hex under a panel the machine, the
// motes, and any effect playing there show through it, so what changes beneath a
// panel changes the frame." A build whose panel painted over the middle of the
// field would still be showing the effect there.
//
// THE COMPLETION IS REACHED WITH NOTHING DELIVERED, which is what isolates this
// effect from the delivery one. `setTally(index, n)` "Sets the tally of the open
// challenge's product `index` to `n`" (`specs/instrumentation.md`), so the tally is
// posed at the challenge's `target` before the boundary and the boundary then
// completes the run without any set consuming anything at it. The field holds no
// mote at all, so no delivery could be raised, nothing can move, and no rise
// spawns. The one set is placed three hexes east, well clear of hex `(0, 0)` and of
// the bare hex the reading is taken against, so its turning aperture reaches
// neither patch.
//
// THE VERDICT. The boundary completes the run — status `complete`, metrics recorded
// — with no mote on the field and so no delivery anywhere; the pixels around hex
// `(0, 0)` change across the frames that follow; and they change more than the
// pixels around a hex three away, which is what a radially symmetric system played
// AT `(0, 0)` does.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { HEX_PITCH, SPEEDS } from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  pixelsDiffering,
  placeSet,
  tallyOf,
  type Harness,
  type PixelRect,
} from "../harness";

/** The fastest speed step, so the completing boundary arrives in one short frame. */
const FAST = SPEEDS.length - 1;

/** Half the hex pitch: the square read back covers one hex and no neighbour's centre. */
const PATCH_R = HEX_PITCH / 2;

/**
 * How many frames after the completing boundary the picture is watched over.
 *
 * Ten frames of `WATCH_SECONDS` cover half a second of game time, which is longer
 * than a one-shot system takes to decay — `specs/assets.md` authors each "with
 * `set-timeline --loop false`, so it decays to empty rather than settling into a
 * steady state" — so the whole of the play is watched however it is paced.
 */
const WATCHED = 10;

/** How long each of those frames is, in seconds of game time. */
const WATCH_SECONDS = 0.05;

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

it("changes the picture on hex (0, 0) across the boundary the run completes", async () => {
  await openRun(h, { challenge: BARE, speed: FAST });
  await placeSet(h, 0, EAST, 0);

  const posed = await h.snapshot();
  const target = posed.challenge?.target ?? -1;
  assertGreaterThan(
    target,
    0,
    "the open challenge asks for at least one delivery",
  );
  await h.debug.setTally(0, target);

  const armed = await h.snapshot();
  assertEqual(
    tallyOf(armed, 0),
    target,
    "the one set's tally already stands at the challenge's target",
  );
  assertLength(
    armed.sim?.motes ?? [],
    0,
    "and the field holds no mote, so the boundary consumes nothing and no " +
      "delivery can be raised at it",
  );
  assertEqual(
    armed.sim?.status,
    "running",
    "the run has not completed yet: the check runs at a boundary",
  );

  const moved = await captureReplay(h, "complete", async () => {
    await advanceCycles(h, 1, 1);

    const completed = await h.snapshot();
    assertEqual(
      completed.sim?.status,
      "complete",
      "every set's tally has reached the target, so this boundary completes the run",
    );
    assertNotNull(
      completed.sim?.metrics,
      "and the metrics are recorded, which is what a completing boundary does",
    );
    assertLength(
      completed.sim?.motes ?? [],
      0,
      "the field is still empty, so nothing on it can move while the picture is watched",
    );

    const measured = await churn([hexCenter(ORIGIN), hexCenter(WEST)]);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "complete",
      "nothing advanced while the picture was watched: the run is over",
    );
    return measured;
  });

  assertGreaterThan(
    moved[0] ?? 0,
    0,
    "the completion effect is played on hex (0, 0) on the boundary the run " +
      "completes, so the picture there changes across the frames that follow",
  );
  assertEqual(
    moved[1] ?? 0,
    0,
    "and it is played THERE: not one pixel of a hex three hexes away changes " +
      "across those same frames",
  );
});
