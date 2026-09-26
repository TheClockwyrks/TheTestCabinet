// audio/playable-muted — a muted game plays exactly as a sounding one does.
//
// specs/ui.md § Audio: "The `mute` action toggles all sound from any screen, and
// the game stays fully playable muted." Sound is presentation, so no rule, no
// verdict and no readout may read the mute bit: a muted site is built, programmed
// and cleared exactly as a sounding one is.
//
// TWO PLAYTHROUGHS OF THE SAME GAME, ONE MUTED. The same site is opened, the same
// crane stood up, the same tape appended and the same run driven to its end twice,
// once with `mute` pressed and once without. What is compared is everything the
// run decides — the phase it ended in, its cause, the tick it ended on, the screen
// it left showing, which sites are cleared, and the score recorded — so a build
// whose muting changed a tolerance, a clock, a verdict or a recorded figure by any
// amount at all reports two different playthroughs.
//
// ONE PAGE, WITH A `reset` BETWEEN THEM. `specs/instrumentation.md` gives `reset`
// exactly one exception: it "restores every field the snapshot reports to its
// title-screen value, bar one" — `muted`, "which `reset` leaves as it stands
// rather than turning a player's preference off". So a reset between the two
// playthroughs puts back the cleared flags, the recorded bests, the screen, the
// menu, the sites' stored structures and tapes and the clock, and leaves the one
// bit the two playthroughs are meant to differ in under this check's control. A
// second browser page would buy nothing but the second page.
//
// THE PLAYTHROUGH IS A CLEAR, not merely a run: `specs/ui.md` says a cleared run
// moves to `results` and records the site's best score, which is the deepest chain
// of consequences a single run has, and the one a silent build would be most
// likely to break. The tape attaches the crate the cable hangs over and sets it
// down on its own pad, so every load ends `placed` and the site clears.
//
// THE RUN IS DRIVEN IN BATCHES, because none of the figures compared is read off
// the tick it is sampled on: a run that has ended "is left as it ended until the
// next one starts" (`specs/state.md`), so the clock, the verdict and the loads
// read after the batch that ended it are the ones the ending tick left.
//
// `mute` is pressed as a player presses it, since the surface poses no mute bit,
// and the press is read back from `snapshot().muted` before anything is built.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the bare hook comes to rest once the cable is drawn in to HOIST_MIN. */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

/** Ticks driven between two readings of the run, and the ceiling on them. */
const BATCH = 10;
const CAP = 600;

/** Everything the site's build, program and run decided, as one reading. */
async function playthrough(harness: Harness): Promise<string> {
  await openSite(harness, 0);
  await clearAll(harness);
  await standMinimalCrane(harness);
  await addOneLoad(harness, "crate", 40, HOOK, HOOK);
  await poseTape(harness, TAPE);
  let ended: GantrySnapshot = await startRun(harness);
  for (
    let driven = 0;
    driven < CAP && ended.run.phase === "running";
    driven += BATCH
  ) {
    ended = await runTicks(harness, BATCH);
  }
  const after = await harness.snapshot();
  return JSON.stringify({
    phase: ended.run.phase,
    cause: ended.run.cause,
    tick: ended.run.tick,
    time: ended.run.time,
    loads: ended.run.loads,
    screen: after.screen,
    menuIndex: after.menuIndex,
    cleared: after.cleared,
    best: after.best,
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears a site muted exactly as it clears it sounding", async () => {
  try {
    await h.press(BINDINGS.mute[0]!);
    // The mute bit is the audio bus's, which the state mirrors on the next update.
    await h.advance(1);
    assertTrue(
      (await h.snapshot()).muted,
      "the mute the `mute` action toggled",
    );

    const muted = await playthrough(h);
    assertTrue(
      (await h.snapshot()).muted,
      "the game still muted at the end of the playthrough",
    );
    assertTrue(
      JSON.parse(muted).phase === "cleared",
      "the muted run cleared the site, so there is a verdict to compare",
    );

    // Sound back on, and the game back where this harness's own reset left it —
    // bar the mute bit, which `reset` leaves alone (specs/instrumentation.md).
    await h.press(BINDINGS.mute[0]!);
    await h.advance(1);
    assertTrue(
      !(await h.snapshot()).muted,
      "the mute the second press turned back off",
    );
    await h.debug.reset();

    assertEqual(
      muted,
      await playthrough(h),
      "the run a muted build decides, against the same run sounding " +
        "(specs/ui.md: the game stays fully playable muted)",
    );
  } finally {
    // In a `finally`, so a check that fails still leaves the picture that
    // shows why.
    await h.capture("muted", "The results the muted run reached");
  }
});
