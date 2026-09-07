// extras/solved-lasts-the-session — a solved Extra stays solved through the rest
// of the session.
//
// THE RULE. "Completing a challenge marks it solved FOR THE SESSION"
// (`specs/modes/extras.md`, Progression), which is the campaign's rule the Extras
// adopt: "A challenge stays unlocked, and STAYS MARKED SOLVED, for the rest of
// the session" (`specs/modes/campaign.md`, Progression) — for the rest of it,
// rather than for as long as the game stays on the shelf. `specs/ui.md` says it
// again of the screen the detour goes through: "Reaching `title` discards
// nothing: progress, records, and the per-challenge machines of
// `specs/editor.md` are unchanged by the visit."
//
// THE MARK IS PLAYED, NOT POSED. The challenge is completed on the build's own
// reference machine with the completion switch on, so what the detour has to
// carry is a mark the COMPLETION wrote, which is what the point's sentence names.
// Then the detour: away to the title, into the campaign and one of its challenges,
// back to the title, and back to the Extras select screen.
//
// THE VERDICT. `extras.solved` after the detour is exactly the set that stood
// when the run completed, and it still holds the challenge that was run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS } from "../constants";
import type { Solution } from "../formats";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  openSelect,
  referenceSolution,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Extras 4, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 3;

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: a cycle is `1 / SPEEDS[speed]` seconds, so it is the shortest span of
 * game time the budget's cycles can be driven as.
 */
const FAST_SPEED = SPEEDS.length - 1;

/**
 * How many cycles one call to the clock covers, in ONE frame: "a frame may
 * complete several cycles; each runs in full, in order" (`specs/simulation.md`),
 * and "the span is the same however it is divided" (`specs/instrumentation.md`),
 * so nothing the run decides turns on the division. The budget is walked in steps
 * rather than in one span so a run that finishes early costs only the steps it
 * needed.
 */
const CYCLES_PER_STEP = 25;

/**
 * Open a SHIPPED Extras challenge on `machine`, completion allowed, and start it.
 *
 * `openChallenge` is what makes this the shelf's own challenge rather than a
 * document: "The snapshot reports it under that `mode` and `index`"
 * (`specs/instrumentation.md`), where `loadChallenge` "reports its `source` as
 * `"custom"`" and "Completing a challenge whose source is `"custom"` touches no
 * progress and no record". This point is about progress, so it opens the
 * challenge this way.
 */
async function startExtrasRun(index: number, machine: Solution): Promise<void> {
  await openChallenge(h, "extras", index);
  await loadMachine(h, machine);
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
}

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, 1);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

/**
 * Complete a shipped Extras challenge on `machine`, and answer the finished run.
 *
 * The completion itself is a posing step here rather than a verdict: every Extras
 * challenge "ships a reference solution under the requirement
 * `specs/modes/campaign.md` states for a course challenge"
 * (`specs/modes/extras.md`), which is one "whose run completes without faulting
 * within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start" — so a
 * build whose reference never completes leaves this point's world unposed, which
 * fails it.
 */
async function complete(
  index: number,
  machine: Solution,
): Promise<OrrerySnapshot> {
  await startExtrasRun(index, machine);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `Extras challenge ${index + 1} completes within CAMPAIGN_REFERENCE_CYCLES ` +
      `(${CAMPAIGN_REFERENCE_CYCLES}) cycles on the machine this point runs, ` +
      "which is the world it decides in",
  );
  return finished;
}

/**
 * Leave for the title, spend a while in the campaign, and come back to the Extras
 * select screen.
 *
 * The detour the point's sentence names, driven through the surface: "`setScreen`
 * Enters the screen `name` ... exactly as the real transition into it enters it",
 * and "`setMode(mode)` Sets the course the select and editor screens serve"
 * (`specs/instrumentation.md`) — a change of what is SHOWN and nothing more, the
 * two modes' progress standing side by side in the snapshot throughout. The
 * campaign is entered rather than merely looked at, because leaving the editor is
 * the transition that stops a run and stashes a machine, and this point is about
 * a figure that survives all of it.
 */
async function detourThroughTheCampaign(): Promise<void> {
  await h.debug.setScreen("title");
  await h.advance(1);
  await h.debug.setMode("campaign");
  await h.debug.setScreen("select");
  await h.advance(1);
  await openChallenge(h, "campaign", 0);
  await h.debug.setScreen("title");
  await h.advance(1);
  await openSelect(h, "extras");
}

it("still reports the Extra solved after a detour through the campaign", async () => {
  await h.debug.reset();
  await complete(INDEX, await referenceSolution(h, "extras", INDEX));
  const stood = (await h.snapshot()).extras.solved;
  assertEqual(
    stood.includes(INDEX),
    true,
    "the completing run marked the challenge solved, which is the mark the " +
      "detour below has to carry",
  );

  await detourThroughTheCampaign();
  await captureStill(h, "still-solved");

  const after = (await h.snapshot()).extras.solved;
  assertEqual(
    after.includes(INDEX),
    true,
    "a solved Extra stays marked solved for the rest of the session, so the " +
      "title and the campaign in between leave the mark standing",
  );
  assertDeepEqual(
    after,
    stood,
    "the detour writes no mark of its own either, so the mode's solved set is " +
      "exactly the one the completion left",
  );
});
