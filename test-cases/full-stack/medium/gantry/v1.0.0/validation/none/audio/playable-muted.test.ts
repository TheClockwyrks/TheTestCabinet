// audio/playable-muted — a muted game plays exactly as a sounding one does.
//
// specs/ui.md § Audio: "The `mute` action toggles all sound from any screen, and
// the game stays fully playable muted." Sound is presentation, so no rule, no
// verdict and no readout may read the mute bit: a muted site is built, programmed
// and cleared exactly as a sounding one is.
//
// TWO BUILDS OF THE SAME GAME, ONE MUTED. The same site is opened, the same crane
// stood up, the same tape appended and the same run driven to its end in two
// harnesses, one of which pressed `mute` first. What is compared is everything the
// run decides — the phase it ended in, its cause, the tick it ended on, the screen
// it left showing, which sites are cleared, and the score recorded — so a build
// whose muting changed a tolerance, a clock, a verdict or a recorded figure by any
// amount at all reports two different playthroughs.
//
// THE PLAYTHROUGH IS A CLEAR, not merely a run: `specs/ui.md` says a cleared run
// moves to `results` and records the site's best score, which is the deepest chain
// of consequences a single run has, and the one a silent build would be most
// likely to break. The tape attaches the crate the cable hangs over and sets it
// down on its own pad, so every load ends `placed` and the site clears.
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
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the bare hook comes to rest once the cable is drawn in to HOIST_MIN. */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }] },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

/** Everything the site's build, program and run decided, as one reading. */
async function playthrough(harness: Harness): Promise<string> {
  await openSite(harness, 0);
  await clearAll(harness);
  await standMinimalCrane(harness);
  await addOneLoad(harness, "crate", 40, HOOK, HOOK);
  await poseTape(harness, TAPE);
  await startRun(harness);
  const ended = await runUntil(
    harness,
    (s) => s.run.phase !== "running",
    600,
    "the run to end",
  );
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
  await h.press(BINDINGS.mute[0]!);
  // The mute bit is the audio bus's, which the state mirrors on the next update.
  await h.advance(1);
  assertTrue((await h.snapshot()).muted, "the mute the `mute` action toggled");

  const muted = await playthrough(h);
  assertTrue(
    (await h.snapshot()).muted,
    "the game still muted at the end of the playthrough",
  );
  assertTrue(
    JSON.parse(muted).phase === "cleared",
    "the muted playthrough cleared the site, so there is a verdict to compare",
  );

  const other = await createHarness();
  try {
    assertEqual(
      muted,
      await playthrough(other),
      "the run a muted build decides, against the same run sounding " +
        "(specs/ui.md: the game stays fully playable muted)",
    );
  } finally {
    await other.dispose();
  }

  await h.capture("muted", "The results the muted playthrough reached");
});
