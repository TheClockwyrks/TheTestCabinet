// screens/solved-menu-up-moves-highlight — `up` moves the solved panel's
// highlight one item up its menu.
//
// THE RULE is one clause of `specs/ui.md`, The solved panel: of the menu built
// from `SOLVED_ITEMS`, "`state.menuIndex` is `0` on arriving, `up` and `down` MOVE
// IT with wrapping, and `confirm` takes the item". `specs/controls.md` grants the
// press: its What each screen reads table gives the "`editor`, `faulted` or
// `complete`" row "`back` and `mute`, and `up`, `down`, and `confirm` while the
// solved panel of `specs/ui.md` is up", and `up` "Menus and select lists: moves
// the highlight up". This point decides the ORDINARY step, from the second item
// to the first; the step off the top is `solved-menu-up-wraps`.
//
// THE CONFIGURATION is the first Extra, completed. The shelf "hold[s] exactly
// `EXTRA_COUNT` (`10`) challenges" (`specs/modes/extras.md`), so the mode holds a
// challenge after this one and the menu is the whole of `SOLVED_ITEMS` — three
// items, so the second one exists to step up from. The highlight is posed to `1`
// through the surface, which "Sets the highlighted item of the menu the current
// screen shows" (`specs/instrumentation.md`), and read back, so the press starts
// from a known item rather than from wherever the arrival left it.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. One press of `up` leaves `menuIndex` at `0`, and the panel is
// still up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight from the second item to the first on one up press", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);

  const arrived = await h.snapshot();
  assertNotNull(arrived.sim, "the run is still reported once it has completed");
  assertEqual(
    arrived.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );

  await h.debug.setMenuIndex(1);
  const posed = await h.snapshot();
  assertEqual(
    posed.menuIndex,
    1,
    "the highlight really is posed on the second item before the press",
  );

  await pressAction(h, "up");
  await captureStill(h, "moved");

  const moved = await h.snapshot();
  assertEqual(
    moved.sim?.status,
    "complete",
    "the press left the panel up: it is a menu press, not a way out of the run",
  );
  assertEqual(
    moved.menuIndex,
    0,
    "up moves the solved panel's highlight one item up, from 1 to 0",
  );
});
