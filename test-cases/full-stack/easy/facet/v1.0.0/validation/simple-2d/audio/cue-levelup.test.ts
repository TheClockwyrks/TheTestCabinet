// Facet — audio/cue-levelup: the `levelup` cue sounds on the frame a level is
// completed, and on no frame before it.
//
// specs/ui.md's CUES table: "`levelup` — `CUES.levelUp` — A level is completed",
// with "Each is played on the frame its event happens … and at most once on that
// frame". specs/rules.md fixes WHICH frame that is: "When `phase` returns to
// `idle` and `levelScore` is at or past the target, the level is over: `screen`
// becomes `levelclear` with `menuIndex` at `0`." The event is therefore the chain
// SETTLING, not the swap that opened it and not the step that banked the points.
//
// WHAT THAT FRAME IS ENTITLED TO RAISE, AND WHY IT IS THE CLEANEST ONE HERE. It
// clears nothing: it is the frame a step's hold ended on and the board it read
// seeded no clear set. It lands nothing either: `land` belongs to `LAND_AT`,
// which specs/rules.md puts a whole `STEP_SECONDS` earlier inside the hold that
// just ended. And it ends no round, since a legal swap stands on the board the
// chain settled onto. So `levelup` is the one cue in the table that frame can
// answer for.
//
// HOW THE SETTLING FRAME IS PUT WHERE THE CHECK CAN NAME IT. `levelScore` is
// posed at level 1's target before the swap, so the level is already complete
// while the chain runs and nothing may happen until `phase` returns to `idle` —
// specs/instrumentation.md says as much of `setLevelScore`: "a level score posed
// at or past the target advances the level as the next chain settles."
//
// WHY THE BOARD IS REWRITTEN UNDER THE RUNNING STEP. R9 refills from the game's
// own seeded generator, so what drops in behind the clear is the build's
// business and could seed a second chain step — which would put another
// clearing frame between the swap and the settle and make "no frame before it"
// unreadable. So while step 1 is still holding, every cell is rewritten to the
// run-free filler, which carries a legal swap and no maximal run at all.
// specs/instrumentation.md says `setGem` leaves "the screen, the phase, and the
// selection" where they were, so the step keeps holding and reads that board when
// its hold is up: it seeds nothing, `phase` returns to `idle`, and the ONLY
// condition left to meet is the level rule. The filler's legal swap is what keeps
// the end-of-round rule out of it.
//
// AND IT SHORTENS THE HOLD, WHICH THE DRIVE READS RATHER THAN ASSUMES. `setGem`
// gives the cell it writes a `fell` of `0`, so a board rewritten cell by cell
// reports a `lastFall` of `0` and the `stepHold` derived from it shrinks to what
// the waves and `STEP_SECONDS` alone are worth. The frames left to drive are
// therefore counted off the snapshot AFTER the rewrite, through the harness's own
// `stepDriveFrames`, rather than from a figure written down here.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`.
// specs/rules.md completes a level when the level score reaches "the target", and
// `levelTarget` is the figure the round is playing to; what that figure ought to
// be is `levels/level-target-derived`'s point. Posing the level score at the
// target the round reports leaves this point deciding the cue alone.
//
// The swap is posed rather than played with a pointer, because the event this
// point reads is raised by a FRAME: `requestSwap` goes "through the same
// acceptance path a player's release takes" (specs/instrumentation.md) and puts
// no pointer surface between this point and the thing it decides. The chain is
// then walked ONE FRAME AT A TIME rather than a step at a time, so the frame the
// level was completed on is the frame the check reads — a cue a build raised a
// frame early or a frame late is a different frame here, not the same step.
//
// WHAT THIS ENGINE READS. The cue's name is the engine bus's own, so the check
// asserts that the settling frame carried `CUES.levelUp` and that no frame in
// the whole watched drive carried it before. Containment, never exclusivity:
// specs/ui.md lets a frame raise more than one cue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  fail,
} from "../assert";
import { CUES } from "../constants";
import {
  hasAnyRun,
  legalSwapExists,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  cueNames,
  cuesOnFrame,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  writeBoard,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 3, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap drops it into. */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * Frames allowed beyond the drive a boundary needs.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry the game past the boundary it stands before, sized so a build
 * comparing `>=` and one comparing `>` both read alike; two frames beyond it is
 * room for a build that acts on the next frame, and no room for a second step.
 */
const SEARCH_MARGIN = 2;

let h: Harness;

/** Run frames one at a time until `chainStep` reaches `step`, and name the frame. */
async function stepFrame(step: number): Promise<number> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    if (h.snapshot().chainStep >= step) return h.frame();
  }
  return fail(
    `chain step ${step} within ${cap} frames of the boundary before it`,
    `phase ${h.snapshot().phase} at chain step ${h.snapshot().chainStep}`,
  );
}

/** Run frames one at a time until the chain is idle, and name the frame it was. */
async function settleFrame(): Promise<number> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    if (h.snapshot().phase === "idle") return h.frame();
  }
  return fail(`the chain to settle within ${cap} frames`, h.snapshot().phase);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the level-up cue on the frame the level is completed", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const quiet = quietRowsWithEscape([]);

  // Both boards are what the check claims before the build is asked anything.
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertEqual(
    swapIsLegal(posed, FROM, TO),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  assertLength(
    maximalRuns(swapped(posed, FROM, TO)),
    1,
    "maximal runs the exchange produces",
  );
  assertEqual(
    hasAnyRun(quiet),
    false,
    "a maximal run on the board written under the step",
  );
  assertEqual(
    legalSwapExists(quiet),
    true,
    "a legal swap on the board written under the step",
  );

  // The build has to have opened its audio and decoded its produced `.wav`s
  // before a frame can be read for a cue at all.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  const cues = watchCues(h);

  loadBoard(h, posed);
  h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned.
  const standing = h.snapshot();
  assertEqual(standing.level, 1, "the level the round stands at");
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  const target = standing.levelTarget;

  h.debug.setLevelScore(target);
  const before = h.snapshot();
  assertEqual(
    before.levelScore,
    target,
    "the level score posed at the target the round reports",
  );

  const settled = await captureReplay(h, "levelup", async () => {
    requestSwap(h, FROM, TO);
    const clearFrame = await stepFrame(1);
    const opened = h.snapshot();
    assertEqual(
      opened.phase,
      "resolving",
      "the phase the step that resolved left",
    );
    assertEqual(opened.level, 1, "the level while the chain runs");
    assertGreaterThanOrEqual(
      opened.levelScore,
      target,
      "the level score standing against the target the round reports",
    );

    // The board goes quiet under the running step, so the read that ends the
    // chain seeds nothing and the settle is the next thing that happens.
    writeBoard(h, quiet);
    assertEqual(
      h.snapshot().phase,
      "resolving",
      "the phase setGem left standing",
    );

    return { clearFrame, at: await settleFrame() };
  });

  // The settle is a later frame than the clear, so "before it" has frames in it.
  assertGreaterThan(
    settled.at,
    settled.clearFrame,
    "the frame the chain settled on, against the frame its last step cleared on",
  );

  const after = h.snapshot();
  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(
    after.screen,
    "levelclear",
    "the screen a completed level raises",
  );
  assertEqual(
    after.menuIndex,
    0,
    "the highlighted item the screen arrives with",
  );
  assertEqual(after.level, 1, "the level the finished level is reported as");

  // The cue sounded on the frame the level was completed.
  assertEqual(
    cueNames(cuesOnFrame(cues, settled.at)).includes(CUES.levelUp),
    true,
    "the cues on the frame the level was completed",
  );

  // And on no frame before it: every level-up cue in the whole watched drive —
  // the swap's own frames, the step's, and each frame the hold ran for — is that
  // one frame.
  const early = cues
    .filter((cue) => cue.cue === CUES.levelUp && cue.frame !== settled.at)
    .map((cue) => cue.frame);
  assertDeepEqual(
    early,
    [],
    `frames other than ${settled.at} that sounded the level-up cue`,
  );
});
