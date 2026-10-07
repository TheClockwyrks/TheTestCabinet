// audio/no-complete-cue-with-the-switch-off — with the completion switch held
// off, a satisfied target sounds no complete cue and the run carries on.
//
// THE RULE. The switch is the surface's: "`setCompletion(on)` — Whether a
// boundary that satisfies every set's target completes the run. Held off, a run
// that reaches its target carries on running" (`specs/instrumentation.md`,
// the `completion` faculty gate). `CUES.complete` is the cue of one event and one
// event only — "`complete` | `CUES.complete` | The run completes" (`specs/ui.md`)
// — so where the run does not complete there is nothing for it to sound on, and a
// build that plays it off the tallies rather than off the completion sounds it
// here.
//
// THE WORLD IS SILENT BY CONSTRUCTION, WHICH IS WHAT MAKES THE POINT DECIDABLE
// UNDER EVERY ENGINE. The one part on the field is the set for the challenge's
// only product; its tally is posed AT the challenge's target with `setTally`, and
// nothing is spawned for it to consume. So the boundary satisfies every target
// while consuming nothing: the only cue that could sound at it is `complete`, and
// a build that sounds nothing at all there is reporting exactly what this point
// requires — which holds under no engine, where a cue's NAME cannot be read, as
// firmly as under either engine, where it can.
//
// AND THE SAME WORLD IS POSED AGAIN WITH THE SWITCH ON, as the control: a build
// that is simply inaudible would pass the reading above for the wrong reason, and
// the second boundary is where the cue this point requires withheld is heard.
//
// EACH RUN IS OPENED PAUSED AND GIVEN A FRAME OR TWO BEFORE THE WINDOW OPENS.
// "A paused run advances no fraction" (`specs/simulation.md`), so those frames
// cost the boundary nothing; what they are for is to put anything the RUN'S OWN
// START sounded — which a pose may not sound at all, and which
// `start-run-pose-plays-no-cue` is the point that decides — outside this point's
// window rather than inside it.
//
// THE VERDICT. With the switch off the boundary sounds nothing, `sim.status` is
// still `running`, and the run goes on turning cycles afterwards. With the switch
// on the same boundary sounds, and completes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CONSTELLATION_TARGET, CUES } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  openTitle,
  resumeRun,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import { TAIL_FRAMES, openSilence, soundingFrames } from "./silence";

/** Frames the paused run is given before a window opens, to clear it. */
const FLUSH = 2;

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing at a satisfied target with the completion switch off", async () => {
  await openTitle(h);
  await openSilence(h);

  // The point's own world: the target satisfied, the switch held off.
  await openRun(h, { challenge: BARE, machine: ONE_SET, paused: true });
  await h.debug.setCompletion(false);
  await h.debug.setTally(0, CONSTELLATION_TARGET);
  await h.advance(FLUSH);
  await resumeRun(h);
  const posed = await h.snapshot();
  assertEqual(
    posed.challenge?.target,
    CONSTELLATION_TARGET,
    "the challenge asks for CONSTELLATION_TARGET constellations",
  );
  assertEqual(
    tallyOf(posed, 0),
    CONSTELLATION_TARGET,
    "and the only set's tally already stands at it, so the next boundary satisfies every target",
  );
  assertEqual(posed.completion, false, "with the completion switch held off");

  const held = watchCues(h);
  const carried = await captureReplay(h, "silent", async () => {
    await advanceCycles(h, 1);
    await h.advance(TAIL_FRAMES);
    const at = await h.snapshot();
    await advanceCycles(h, 1);
    return { at, on: await h.snapshot() };
  });
  const heard = [...held];

  assertLength(
    soundingFrames(heard, CUES.complete),
    0,
    "a boundary that satisfies every target with the switch off sounds nothing: no CUES.complete, and nothing was consumed for CUES.constellation either",
  );
  assertEqual(
    carried.at.sim?.status,
    "running",
    "the run carries on rather than completing",
  );
  assertGreaterThan(
    carried.at.sim?.cycle ?? 0,
    0,
    "the boundary really was reached, so the silence is the withheld cue rather than a run that never got there",
  );
  assertGreaterThan(
    carried.on.sim?.cycle ?? 0,
    carried.at.sim?.cycle ?? 0,
    "and it goes on turning cycles past it",
  );

  // The control: the same boundary with the switch on is where the cue is heard.
  await openRun(h, { challenge: BARE, machine: ONE_SET, paused: true });
  await h.debug.setTally(0, CONSTELLATION_TARGET);
  await h.advance(FLUSH);
  await resumeRun(h);
  const allowed = watchCues(h);
  await advanceCycles(h, 1);
  await h.advance(TAIL_FRAMES);

  assertEqual(
    (await h.snapshot()).sim?.status,
    "complete",
    "the same world with the switch on completes at that boundary",
  );
  assertGreaterThan(
    allowed.length,
    0,
    "and sounds there, so the silence above is a cue this build has and withheld rather than a build that cannot be heard",
  );
  assertLength(
    heard,
    0,
    "and nothing else sounded in that window either, so the reading above is the whole of what the boundary played",
  );
});
