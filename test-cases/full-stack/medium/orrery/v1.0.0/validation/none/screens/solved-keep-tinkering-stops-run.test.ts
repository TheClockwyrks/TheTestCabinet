// screens/solved-keep-tinkering-stops-run — taking KEEP TINKERING ends the run
// and hands the editor back.
//
// THE RULE is the second row of the solved panel's `confirm` table in
// `specs/ui.md`, The solved panel: "`KEEP TINKERING` | STOPS THE RUN and returns
// to editing, machine intact." What "stops the run" leaves behind is fixed by
// `specs/state.md`: `sim` is "The whole of a run, and `null` WHILE EDITING", and
// `specs/simulation.md` says what stopping does: it "discards the motes and every
// runtime pose and returns to editing". So after the press there is no run to
// report. That the MACHINE survives is `solved-keep-tinkering-keeps-machine`;
// this point decides the run's end alone.
//
// `specs/controls.md` grants the press: the "`editor`, `faulted` or `complete`"
// row of What each screen reads carries "`up`, `down`, and `confirm` while the
// solved panel of `specs/ui.md` is up".
//
// THE CONFIGURATION is the first Extra, completed. The shelf "hold[s] exactly
// `EXTRA_COUNT` (`10`) challenges" (`specs/modes/extras.md`), so the mode holds a
// challenge after this one and the menu is the whole of `SOLVED_ITEMS` — which
// puts `KEEP TINKERING`, its second entry, at index `1`. The highlight is posed
// there through the surface and read back, so the item `confirm` takes is the one
// this point is about.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. `sim` is `null` after the press, and `screen` is still `editor`
// with the challenge still open — the editor is editing again rather than having
// left for another screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  pressAction,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** Where KEEP TINKERING sits when all three items are offered. */
const KEEP_ITEM = 1;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns sim to null and leaves the editor editing on confirm", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.debug.setMenuIndex(KEEP_ITEM);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.menuIndex,
    KEEP_ITEM,
    `the highlight stands on ${String(SOLVED_ITEMS[KEEP_ITEM])}, the second entry of SOLVED_ITEMS`,
  );

  await pressAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "stopped");

  const editing = await h.snapshot();
  assertNull(
    editing.sim,
    "KEEP TINKERING stops the run, and a stopped run is reported as null",
  );
  assertEqual(
    editing.screen,
    "editor",
    "and it returns to EDITING rather than leaving the editor",
  );
  assertNotNull(
    editing.challenge,
    "the challenge it was editing is still the one open",
  );
});
