// Volute — audio/extraction-cue: a cue sounds on the tick a run is drawn out.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("Audio"): `extract-1` is played when "An extraction
//     resolves at chain step `1`", and "Each sounds on the tick its event
//     happens, and at most once on that tick."
//   - `specs/extraction.md` ("Extraction on a merge"): "When a segment merges
//     with the segment ahead of it, and the merging segment's head core and the
//     segment ahead's tail core carry the same charge, take the maximal
//     same-charge run spanning that join within the merged segment. That run is
//     extracted on the tick the merge occurs when it holds at least 3 cores."
//     So a segment catching the one ahead of it is an extraction, and it is the
//     `extract-k` event.
//   - `specs/extraction.md` ("Score"): "The score updates on the tick the
//     extraction resolves." That sentence is what makes the score the marker for
//     WHICH tick the run was drawn out on — the one field of the snapshot the
//     specification pins to the resolving tick itself.
//   - `specs/instrumentation.md`: "Audio belongs to the ticks. A pose changes the
//     state alone and sounds nothing" — so the hall is arranged by poses and
//     every cue read below comes from a stepped tick.
//
// WHAT IS READ. The engine's cue bus announces every play at the moment it
// happens and the harness stamps each announcement with the tick that was
// running, so this decides that the hall SOUNDED on the tick the run was drawn
// out. The cue's NAME is not asserted, though this engine offers it: an
// engineless build owns its whole audio layer and has no bus to ask, and the
// three validator projects of this case decide the same eighty-three points, so
// the reading is the one every engine can make. Whether it was the extraction's
// own cue and not another is the reviewer's, by ear.
//
// WHY A MERGE AND NOT AN INSERTION. The reading is "a cue sounded on the tick the
// run was drawn out", so the tick has to be one the specification puts NO other
// cue on — otherwise a build that plays every cue but the extraction's still
// passes. `specs/ui.md`'s table binds `seat` to "A projectile is inserted into
// the train", and an insertion that completes a run resolves the seat and the
// extraction on the SAME tick, so an insertion drive cannot separate the two.
// `specs/extraction.md`'s merge extraction resolves on a tick with no projectile
// in the hall at all: no `seat`, no `fire`, no `denied`, no `swap`; the posed
// cores carry no mark, so no `machinery`; two cores are left standing behind, so
// no `level-clear`; the train stands far short of the intake, so no `intake` and
// no `cell-lost`; and the bed is already up before the pose, so no bed starts on
// it either. `extract-k` is the only cue the specification permits on the tick
// this check reads.
//
// THE RUN IS DRAWN OUT BY THE BUILD'S OWN RULES, not posed. Two segments are
// placed on the straight top run: a lead segment of halide, cobalt, cobalt, and a
// detached segment of cobalt, halide one further gap behind it. `specs/channel.md`
// ("Advance") rides the lead segment at the effective feed speed and "Every other
// segment" at the fixed 180 units/s, so the trailing segment closes on its own,
// merges, and the maximal same-charge run spanning the join is three cobalt with
// a halide stopping it at each end. The quota is exhausted (`specs/channel.md`,
// "Emission") so the inlet puts nothing into the gap, and the two halide left
// standing keep the channel occupied so the level does not clear on the
// extraction's tick.
//
// TOLERANCE. None on the tick, and none would be honest: the specification fixes
// the cue to "the tick its event happens", both the extraction and the score
// change resolve on that tick by `specs/extraction.md`, and the probe reads whole
// ticks. A build a tick out has broken the stated rule. The only spans chosen are
// drive lengths — how long the catch-up is swept for, and how much of the recoil
// is recorded afterwards — and neither decides anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { MIN_RUN, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedRun,
  startRun,
  stepUntilBed,
  stepUntilSound,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Where the lead segment's head stands: `(540, 40)` on `specs/channel.md`'s first
 * leg, well clear of both the inlet and the first vertex at arc 880.
 */
const LEAD_HEAD_S = 500;

/** A halide ahead of the two cobalt, so the run spanning the join stops there. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** A cobalt at the head, with a halide behind it, so the run stops there too. */
const TRAIL = ["cobalt", "halide"] as const;

/**
 * How far behind the merge position the trailing segment starts.
 *
 * Room for the catch-up to be the thing that closes it: at 180 - 22 = 158 units/s
 * of closing, 60 units is about 23 ticks of real approach rather than a merge the
 * pose all but made itself.
 */
const GAP = 60;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/**
 * How long the catch-up is swept for, in ticks.
 *
 * About 23 ticks of it at the rates `specs/channel.md` fixes; the cap is many
 * times that, so a build whose advance differs within the specification's
 * latitude still arrives, and the sweep stops on the tick the score moves
 * whatever that tick is.
 */
const APPROACH_TICKS = 180;

/**
 * Ticks recorded after the extraction, so the evidence shows the recoil.
 *
 * `specs/extraction.md` holds a recoiled group for `RECOIL_HOLD` (0.4 s, 24
 * ticks) before it advances again, and what tells a reviewer a run was drawn out
 * is the gap opening and the cores behind it falling back. This decides nothing.
 */
const AFTERMATH_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the tick the run is drawn out", async () => {
  await h.armAudio();
  await startRun(h);

  // The music bed's own start is a sound; letting it get up BEFORE the scenario
  // is posed keeps it out of the reading and, more importantly, keeps the wait
  // out of the scenario. A produced `.wav` decodes asynchronously
  // (`specs/assets.md` has the build load its own files), so the tick a
  // conformant build's bed starts on is a fact about the host's decode rather
  // than about the build — and the ticks spent waiting for it are ticks the
  // train advances on. Waiting here means the pose below is laid on a hall that
  // is standing still afterwards, however long the decode took.
  // A build whose bed is no looping source at all fails `audio/music-bed`, which
  // is the point about the bed; here the wait simply falls back to any sound the
  // hall makes rather than spending its whole budget on a bed that never comes.
  const looping = await stepUntilBed(h);
  if (looping === 0) await stepUntilSound(h);

  await poseHall(h, {
    // Two detached segments on the straight top run, each head first and spaced
    // by SPACING, with the trailing one a gap short of the merge position.
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
    // The inlet stopped, so nothing arrives to join either segment.
    quotaRemaining: 0,
  });

  const posed = await h.snapshot();
  // The two really are detached, so what follows is a merge rather than a train
  // that was already joined: "A segment is a maximal run of consecutive cores in
  // the train whose arc positions differ by exactly `SPACING`".
  assertLength(posed.segments, 2, "segments the pose left standing apart");

  const played = watchCues(h);
  const extraction = await captureReplay(h, "extract", async () => {
    const drawn = await h.stepUntil((s) => s.score > posed.score, {
      maxTicks: APPROACH_TICKS,
      poll: 1,
    });
    // Read HERE, on the tick the score moved, which `specs/extraction.md` fixes
    // as the tick the extraction resolved. The recoil below is recorded after
    // the reading, so it cannot reach it.
    const measured = { drawn, tick: h.tick(), cues: [...played] };
    await h.step(AFTERMATH_TICKS);
    return measured;
  });

  assertEqual(
    extraction.drawn.hit,
    true,
    "whether the segment catching the one ahead of it drew a run out",
  );
  assertEqual(
    coreCount(extraction.drawn.snapshot),
    LEAD.length + TRAIL.length - MIN_RUN,
    "the cores left on the channel after the run was drawn out",
  );
  assertGreaterThan(
    extraction.cues.filter((cue) => cue.tick === extraction.tick).length,
    0,
    "the sounds the hall emitted on the tick the run was drawn out",
  );
});
