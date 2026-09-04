// screens/faulted-editor-ignores-the-menu-actions — `up`, `down` and `confirm` are
// the solved panel's, and a faulted run answers none of them.
//
// THE RULE is the What each screen reads table of `specs/controls.md`. Its
// "`editor`, `faulted` or `complete`" row reads "`back` and `mute`, and `up`,
// `down`, and `confirm` WHILE THE SOLVED PANEL OF `specs/ui.md` IS UP" — and that
// panel is up "While `sim.status` is `complete`" (`specs/ui.md`, The solved
// panel), which a faulted run is not. What a faulted run shows instead is the
// fault display, whose only key is the one the same row already grants: "`back`
// returns to editing, as `specs/simulation.md` states". The sentence under the
// table settles the rest: "An action a row omits does nothing on that screen."
//
// THE CONFIGURATION MOVES THE HIGHLIGHT FIRST, because `menuIndex` at `0` is the
// resting value and a build that wrongly moved it might land back on it. The
// title menu is showing when the game opens and `TITLE_ITEMS` holds three, so
// `setMenuIndex` — which sets the highlight "from `0` and below that menu's entry
// count" (`specs/instrumentation.md`) — puts it on the title's last item, and the
// check reads it back once the run is faulted. From a highlight of `2`, a build
// that answered `up` or `down` with the solved panel's own movement would show it
// at once.
//
// The world is otherwise the opener every isolated check uses, spelled out so the
// `reset` inside it cannot undo the posed highlight: `BARE` loaded through the
// surface, the machine cleared, the completion switch held off, a run started,
// the field emptied. The machine is one `piston` at `ARM_MAX_LEN` (`3`) whose
// tape opens on `extend`, which "raises the fault named for it" at the very first
// fetch — `overextended` — so the run is faulted before a cycle has run.
//
// THE VERDICT. After `up`, after `down`, and after `confirm`, `menuIndex` is
// still `2`, `screen` is still `editor`, and the run is still the same faulted
// run: the same status, the same fault, the same cycle and the same fraction.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, TITLE_ITEMS } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Where the highlight is posed: the title menu's last item. */
const MOVED = TITLE_ITEMS.length - 1;

/**
 * One piston at the origin at `ARM_MAX_LEN`, whose first fetch asks it to extend
 * past its bound and so faults the run as `overextended`.
 */
const FAULTING = solution([
  armPart("piston", ORIGIN.q, ORIGIN.r, 0, 3, ["extend"]),
]);

/** The three actions the row grants only while the solved panel is up. */
const MENU_ACTIONS = ["up", "down", "confirm"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Everything of the run a press must leave exactly as it found it. */
function run(snapshot: OrrerySnapshot): unknown {
  return {
    status: snapshot.sim?.status ?? null,
    cycle: snapshot.sim?.cycle ?? null,
    fault: snapshot.sim?.fault?.kind ?? null,
    parts: snapshot.sim?.fault?.parts ?? null,
    poses: snapshot.sim?.poses ?? null,
  };
}

it("leaves menuIndex, the screen and the run alone under up, down and confirm", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(MOVED);

  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.loadSolution(FAULTING);
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await advanceCycles(h, 1);
  await h.advance(1);

  const faulted = await h.snapshot();
  assertNotNull(faulted.sim, "the run is still reported once it has faulted");
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the first fetch asked a piston at ARM_MAX_LEN to extend, so the run is faulted",
  );
  assertEqual(
    faulted.screen,
    "editor",
    "the fault display is drawn on the editor rather than being a screen of its own",
  );
  assertEqual(
    faulted.menuIndex,
    MOVED,
    "the highlight really was moved off the first item, so leaving it alone says something",
  );
  const stood = run(faulted);
  const fraction = faulted.sim?.fraction ?? -1;

  const seen: { action: string; after: OrrerySnapshot }[] = [];
  for (const action of MENU_ACTIONS) {
    await pressAction(h, action);
    await h.advance(1);
    seen.push({ action, after: await h.snapshot() });
  }
  await captureStill(h, "faulted-menu-inert");

  for (const { action, after } of seen) {
    assertEqual(
      after.menuIndex,
      MOVED,
      `the editor, faulted or complete row grants ${action} only while the ` +
        "solved panel is up, so on a faulted run it moves no highlight",
    );
    assertEqual(
      after.screen,
      "editor",
      `and ${action} leaves the screen where it was`,
    );
    assertDeepEqual(
      run(after),
      stood,
      `and ${action} leaves the faulted run exactly as it stood`,
    );
    assertNear(
      after.sim?.fraction ?? -1,
      fraction,
      FRACTION_TOLERANCE,
      `and ${action} moves the clock no further`,
    );
  }
});
