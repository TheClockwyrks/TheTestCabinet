// results — the results screen arrives with `menuIndex` `0`.
//
// `specs/ui.md` § Results: the screen shows the menu `RESULTS_ITEMS` "with
// `menuIndex` `0` on arriving". This check decides that one requirement: however
// the highlight stood before the run, arriving at results puts it on the menu's
// first entry.
//
// THE HIGHLIGHT IS PUT SOMEWHERE ELSE FIRST, on the select screen, which is one
// of the three screens `specs/instrumentation.md` says `setMenuIndex` applies on
// ("`title`, `select`, and `results`"). Site `2` is a real entry of that menu, so
// the index posed is one the game holds rather than one it has nowhere to put.
// Opening a site does not touch `menuIndex` (`specs/state.md` lists what a site
// opening sets, and the highlight is not among them), so the index is still `2`
// when the run starts — which is what makes the reading afterwards a reading of
// arriving at results rather than of a value that was already `0`.
//
// THE SCREEN IS REACHED BY CLEARING THE SITE, because `setScreen` "shows the
// screen and sets nothing else" (`specs/instrumentation.md`) and arriving is
// exactly what this is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
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

/**
 * One short move: enough for a tape to run out and clear an empty yard.
 *
 * A degree of grip and no more. Which move it is decides nothing here — the yard
 * is empty, so the run clears at the top of the first tick that finds the tape
 * complete with no step left (`specs/program.md`) — and a degree at
 * `GRIP_MAX_RATE` is a whole ordinary move, issued, accelerated, braked and
 * arrived, in a sixth of a second of run clock. The grip is the axis
 * `specs/rigging.md` says "applies no force to anything", so nothing on the way
 * to results is anything but the tape running out.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 1, rate: GRIP_MAX_RATE }],
  },
];

/** Where the highlight is put before the run: not the results menu's first. */
const POSED_INDEX = 2;

/** Ticks the run is given to reach its verdict: many times the move's own. */
const END_CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the highlight on the first entry on arriving at results", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(POSED_INDEX);
  assertEqual(
    (await h.snapshot()).menuIndex,
    POSED_INDEX,
    "the highlight posed on the select screen (specs/instrumentation.md)",
  );

  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertEqual(
    started.menuIndex,
    POSED_INDEX,
    "the highlight still standing where it was posed when the run starts",
  );

  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the tape to run out and the site to clear",
  );
  assertEqual(
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );
  assertEqual(
    ended.menuIndex,
    0,
    "the highlighted entry on arriving at results (specs/ui.md)",
  );

  await h.advance(1);
  await h.capture("results-index", "The results highlight on arriving");
});
