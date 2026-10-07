// screens/solved-menu-up-wraps — `up` on the solved panel's first item wraps
// round to its last.
//
// THE RULE is one clause of `specs/ui.md`, The solved panel: of the menu built
// from `SOLVED_ITEMS`, "`state.menuIndex` is `0` on arriving, `up` and `down` move
// it WITH WRAPPING, and `confirm` takes the item". Wrapping is what this point
// decides in the upward direction: a press on the first item does not stop there
// and does not run below `0`, it lands on the last.
//
// THE CONFIGURATION is the first Extra, completed. The shelf "hold[s] exactly
// `EXTRA_COUNT` (`10`) challenges" (`specs/modes/extras.md`), so the mode holds a
// challenge after this one and the menu is the whole of `SOLVED_ITEMS`: three
// items, whose last is index `2`, which is where a wrap from the first lands.
// The highlight is posed to `0` through the surface, which "Sets the highlighted
// item of the menu the current screen shows" (`specs/instrumentation.md`), and
// read back before the press.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. One press of `up` from the first item leaves `menuIndex` on the
// menu's last item, and the panel is still up. A build that clamped at `0` fails,
// and so does one that let the index go negative.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The last item of the panel's menu, which the whole of SOLVED_ITEMS is here. */
const LAST = SOLVED_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the highlight from the first item round to the last on one up press", async () => {
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

  await h.debug.setMenuIndex(0);
  const posed = await h.snapshot();
  assertEqual(
    posed.menuIndex,
    0,
    "the highlight really is posed on the menu's first item before the press",
  );

  await pressAction(h, "up");
  await captureStill(h, "wrapped");

  const moved = await h.snapshot();
  assertEqual(
    moved.sim?.status,
    "complete",
    "the press left the panel up: it is a menu press, not a way out of the run",
  );
  assertEqual(
    moved.menuIndex,
    LAST,
    "up wraps past the solved panel's first item to its last, so menuIndex is SOLVED_ITEMS.length - 1",
  );
});
