// instrumentation/sim-time-accumulates — `simTime` is the sum of every update's
// delta time, on every screen, and it moves for nothing else.
//
// THE RULE. "Three fields are kept honest as the frames run: ... `simTime`
// accumulates the delta time of every update, whatever the screen"
// (`specs/instrumentation.md`, Snapshot shape), where the field is
// "`simTime: <number>` — accumulated simulation time, in seconds".
// `specs/state.md` says it in one line: "`simTime` — accumulated simulation time,
// in seconds. Every `update` adds its `dt`, whatever the screen."
//
// WHATEVER THE SCREEN is the whole of the point, so the same second of game time
// is run on each of the four screens `specs/state.md` names — `title`, `howto`,
// `select` and `editor` — and each is required to add `1.0`. A build that
// accumulated only while a run was live, or only in the editor, adds nothing on
// three of them.
//
// AND IT STANDS STILL ONLY WHEN NO FRAME IS ADVANCED. The clock is held off the
// wall clock for the whole check, so the second half poses a stretch of the surface
// — a screen change, a challenge, a machine, a run — with NO frame advanced at all,
// and requires the figure not to have moved: a pose "changes the state alone", and
// while the simulation is held "the game changes only when `advance` says so".
//
// THE READING IS A NEAR ONE. `simTime` is one of the three figures the
// specification carries as a running sum of the frames' own delta times, which
// "agree to within the rounding of that sum rather than bit for bit", so every
// comparison below is `FRACTION_TOLERANCE` wide and none of them is an equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  openHowto,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

/** The span of game time run on each screen, and the frames it is divided into. */
const SECONDS = 1;
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Run one second of game time and answer what it added to `simTime`. */
async function secondOn(screen: string): Promise<void> {
  const before = (await h.snapshot()).simTime;
  await h.advanceSeconds(SECONDS, FRAMES);
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    screen,
    `the second was run on the ${screen} screen`,
  );
  assertNear(
    after.simTime - before,
    SECONDS,
    FRACTION_TOLERANCE,
    `every update on ${screen} adds its dt to simTime, so a second adds 1.0`,
  );
}

it("adds a second of game time on every screen, and stands still without a frame", async () => {
  await openTitle(h);
  await secondOn("title");

  await openHowto(h);
  await secondOn("howto");

  await openSelect(h, "campaign");
  await secondOn("select");

  await openChallengeDocument(h, BARE);
  await secondOn("editor");
  await captureStill(h, "accumulated");

  // Nothing but an advanced frame moves it. Every call below is a pose, and the
  // clock is held, so the figure must stand exactly where the last frame left it.
  const held = (await h.snapshot()).simTime;
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(1);
  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.debug.spawnMote(ORIGIN.q + 1, ORIGIN.r, "dust");
  assertNear(
    (await h.snapshot()).simTime,
    held,
    FRACTION_TOLERANCE,
    "simTime stands still while no frame is advanced: a pose changes the state alone",
  );
});
