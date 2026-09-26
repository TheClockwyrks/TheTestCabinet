// audio/no-cue-but-motor-loops — `motor` is the ONE loop.
//
// specs/ui.md § Audio: "A cue plays once for the event that raises it, and at
// most once on a given tick or edit; `motor` is the one loop." specs/assets.md §
// The sound says the same from the production side, authoring "`motor` as the one
// loop". So of the eleven cues exactly one is started as a loop, and the other
// ten are one-shots: a `place` that loops is a clack that never stops, and a
// `collapse` that loops is a crane that keeps falling.
//
// EVERY ONE OF THE ELEVEN IS RAISED, in four scenarios that between them reach
// each of them once:
//
//   - the build screen: one member placed (`place`) and removed (`delete`);
//   - a run that clears the site (`run-start`, `attach`, `placed`, `complete`);
//   - a run that hangs a load heavy enough to take a member across
//     `CREAK_THRESHOLD` (`creak`), driving the grip so an axis turns (`motor`);
//   - a run that hangs a load heavy enough to break a member (`break`,
//     `collapse`, `fail`).
//
// WHAT IS READ IS THE LOOP FLAG, cue by cue. The harness's `loopingCues()`
// reports the sources that are live AND set to loop, by name, so after each event
// the question asked is which names are looping — and the answer must never carry
// a name but `motor`. The music bed is not a cue: specs/ui.md's sentence is about
// the cues, and specs/assets.md commits the bed as a piece "under the title and
// select screens", so `music` is allowed to loop and is excluded by name.
//
// EACH SCENARIO IS ISOLATED. Every run opens its site afresh — which puts the run
// back to its idle placeholder and restores the site's yard (specs/state.md) —
// and then clears the world and poses back exactly what the scenario needs.
//
// AND THE SWEEP IS CHECKED FOR VACUITY: the eleven cues are collected as they
// sound, and a cue that never sounded is reported rather than passed over, so
// this point cannot be met by a build that simply never played the cue in
// question.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES, GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** A move whose target is the axis's value: one tick, and nothing moves. */
const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** A long grip move: an axis turning, loading nothing. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Takes the crane's worst utilization across `CREAK_THRESHOLD`, intact. */
const CREAKING_MASS = 170;

/** Past what the crane carries: a member breaks and the crane comes down. */
const BREAKING_MASS = 290;

/** The bed of specs/assets.md, which is not one of the cues and may loop. */
const MUSIC = "music";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no cue but motor as a loop", async () => {
  /** Every cue name heard across the sweep. */
  const heard = new Set<string>();
  /** Every event that found a name other than `motor` looping. */
  const looped: string[] = [];

  /**
   * Read the sounds since the last read, and what is looping now.
   *
   * `where` names the event the reading follows, so a failure says which cue's
   * own event had a loop standing under it.
   */
  const read = async (where: string): Promise<void> => {
    for (const name of await h.cues()) heard.add(name);
    const looping = (await h.loopingCues()).filter(
      (name) => name !== "motor" && name !== MUSIC,
    );
    for (const name of looping) looped.push(`${name} (after ${where})`);
  };

  /* ---- The build screen: `place` and `delete` ---------------------------- */

  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  await h.cues();

  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.advance(1);
  await read("a member placed");

  await h.debug.removeMember(0);
  await h.advance(1);
  await read("a member removed");

  /* ---- A run that clears: `run-start`, `attach`, `placed`, `complete` ---- */

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, [
    NOOP,
    { kind: "action", action: "attach" },
    { kind: "action", action: "release" },
  ]);
  await startRun(h);
  await read("a run started");
  for (let i = 0; i < 4; i += 1) {
    const tick = await runTicks(h, 1);
    await read(`tick ${tick.run.tick} of the clearing run`);
  }
  assertEqual(
    (await h.snapshot()).run.phase,
    "cleared",
    "the run that attaches its one load and sets it down on its own pad " +
      "(specs/program.md § The tick pipeline)",
  );

  /* ---- A run that creaks, with an axis turning: `creak` and `motor` ------ */

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", CREAKING_MASS, HOOK, HOOK);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await runTicks(h, 2);
  await read("a run driving its grip");
  await h.debug.setLoadPhase(0, "attached");
  await runTicks(h, 1);
  await read("a member crossing CREAK_THRESHOLD");
  await h.debug.abortRun();

  /* ---- A run that comes down: `break`, `collapse`, `fail` ---------------- */

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", BREAKING_MASS, HOOK, HOOK);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await runTicks(h, 2);
  await h.cues();
  await h.debug.setLoadPhase(0, "attached");
  const collapsed = await runTicks(h, 1);
  await read("the crane coming down");
  await h.capture("cues", "Each cue raised in turn");
  assertEqual(
    collapsed.run.phase,
    "failed",
    "the run under a load past what the crane carries (specs/statics.md)",
  );

  /* ---- The verdict ------------------------------------------------------- */

  const missing = CUES.filter((cue) => !heard.has(cue));
  assertLength(
    missing,
    0,
    "the cues this sweep raised: each of the eleven specs/ui.md § Audio names " +
      "is raised by one of the four scenarios, and a cue that never sounded " +
      `leaves nothing to read a loop flag off. Heard ` +
      `${JSON.stringify([...heard])}`,
  );
  assertLength(
    looped,
    0,
    'the cues started as a loop other than `motor`: "`motor` is the one ' +
      'loop" (specs/ui.md § Audio), authored as such (specs/assets.md § The ' +
      "sound), so each of the other ten is a one-shot that ends with its " +
      `event. Looping: ${JSON.stringify(looped)}`,
  );
});
