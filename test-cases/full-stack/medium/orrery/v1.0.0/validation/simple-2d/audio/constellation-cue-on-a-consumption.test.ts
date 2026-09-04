// audio/constellation-cue-on-a-consumption — the boundary at which a set takes
// its product sounds `constellation`, once, on the frame that boundary ran.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `constellation` |
// `CUES.constellation` | A set consumes one or more constellations. |", played
// "on the frame its event happens, from `update`, and at most once on that
// frame". What consuming is, is `specs/sigils.md`: "For a plain product, a
// constellation is accepted when it is unheld and is exactly the placed pattern
// ... An accepted constellation is consumed whole, and the set's tally rises by
// `1` for a plain product". When it happens is `specs/simulation.md`'s cycle
// order: "Boundary ... the sigil phase, then sets, then rises".
//
// THE CONFIGURATION. `BARE`, whose one product is a lone `sol` on `(0, 0)`,
// opened as a bare run — the completion switch held off, so the delivery ends
// nothing — with ONE part on the field: the set for product `0` on `ORIGIN`. One
// `sol` is spawned on `ORIGIN`, unheld and unbonded, which is exactly the placed
// pattern. Nothing else is placed: no rise refills the hex, no sigil acts on the
// mote, and no other set can raise a tally. The run is opened PAUSED, so the
// whole of the delivery happens inside the window the check is listening to.
//
// WHICH FRAME THE CONSUMPTION IS ON. The check drives the cycle one frame at a
// time and reads the tally after each, so the frame the set consumed on is named
// by the snapshot — the tally is the observable the specification gives for it —
// rather than computed from the clock. The cue is then judged against that frame.
//
// THE VERDICT. The tally rises by one and the field is empty, so a delivery
// really happened; the cue sounds on the frame it happened on; and no frame
// before it and none after it sounds.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { CUES } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  placeSet,
  resumeRun,
  spawnMote,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
} from "./silence";

/** Which of the challenge's products this set receives. */
const PRODUCT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds constellation once, on the frame the set consumed its product on", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await placeSet(h, PRODUCT, ORIGIN, 0);
  await spawnMote(h, ORIGIN, "sol");

  const posed = await h.snapshot();
  assertNotNull(
    tallyOf(posed, PRODUCT),
    "sim.tallies carries one entry per product, so this set's entry is reported",
  );
  assertEqual(
    tallyOf(posed, PRODUCT),
    0,
    "nothing has been delivered before the run advances",
  );

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.constellation),
    0,
    "the paused run crosses no boundary, so nothing sounds before the resume",
  );

  const consumed = await captureReplay(h, "consumed", async () => {
    await resumeRun(h);
    const frame = await driveUntil(
      h,
      (snapshot) => (tallyOf(snapshot, PRODUCT) ?? 0) > 0,
      2,
    );
    await h.advance(TAIL_FRAMES);
    return frame;
  });

  assertGreaterThan(
    consumed,
    0,
    "the set consumed the constellation at a boundary, which is the event the cue is for",
  );
  const after = await h.snapshot();
  assertEqual(
    tallyOf(after, PRODUCT),
    1,
    "a plain product's tally rises by 1 on the delivery",
  );
  assertLength(
    after.sim?.motes ?? [],
    0,
    "and the accepted constellation was consumed whole, so the field is empty",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.constellation),
    [consumed],
    "the constellation cue sounds on the frame the consumption happened on, and on no other",
  );
});
