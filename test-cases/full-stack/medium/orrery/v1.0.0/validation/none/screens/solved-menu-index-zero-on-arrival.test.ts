// screens/solved-menu-index-zero-on-arrival — arriving at the solved panel puts
// the highlight on the panel's first item, wherever it had been left.
//
// THE RULE is one clause of `specs/ui.md`, The solved panel: of the menu built
// from `SOLVED_ITEMS`, "`state.menuIndex` is `0` on arriving, `up` and `down`
// move it with wrapping, and `confirm` takes the item". Arriving is the moment
// the run completes, because the panel is not a screen: "the solved panel and the
// fault display are drawn on `editor` from `sim.status` rather than being
// screens" (`specs/state.md`). So the boundary that sets `sim.status` to
// `complete` is the boundary that sets `menuIndex` to `0`.
//
// THE CONFIGURATION ARRIVES AT THE PANEL TWICE, because `0` is the resting value
// and a build that never touches `menuIndex` would pass a check that started
// there. The first run completes; the highlight is then moved to the menu's LAST
// item through `setMenuIndex`, which sets it "from `0` and below that menu's
// entry count" (`specs/instrumentation.md`) and is in range because the shelf
// "hold[s] exactly `EXTRA_COUNT` (`10`) challenges"
// (`specs/modes/extras.md`), so this challenge has one after it and the whole of
// `SOLVED_ITEMS` is offered. Then the run is stopped through the surface —
// `stopRun` "Return[s] `sim` to `null` and the machine to the editor", and that
// is the whole of what its row says it does, so the highlight it was left on
// stands — and a second run is started and completed. The highlight is read back
// as still on the last item on the frame before that second completing cycle, so
// the pose really did reach the game.
//
// The machine is the set for the challenge's one product and nothing else, and
// each run's tally is posed straight to the `target`, because what completes a
// run is the boundary's own test: "After the rises, if every set's tally has
// reached the challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. `menuIndex` is `0` once the second run is `complete`, from a
// highlight that stood on the last item of the menu before it.

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
  stopRun,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** Where the highlight is moved to between the two runs: the menu's last item. */
const MOVED = SOLVED_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the highlight on the panel's first item however far it had moved", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);

  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);

  const first = await h.snapshot();
  assertNotNull(first.sim, "the run is still reported once it has completed");
  assertEqual(
    first.sim?.status,
    "complete",
    "the first run completed, which is the panel this check moves the highlight on",
  );

  await h.debug.setMenuIndex(MOVED);
  await stopRun(h);

  const editing = await h.snapshot();
  assertNull(
    editing.sim,
    "stopRun returns sim to null and the machine to the editor, and says nothing of the highlight",
  );
  assertEqual(
    editing.menuIndex,
    MOVED,
    "so the highlight is still on the last item of the menu it was moved on",
  );

  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);

  const running = await h.snapshot();
  assertEqual(
    running.menuIndex,
    MOVED,
    "and it is still there as the second run begins, so arriving at 0 says something",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "arrived");

  const arrived = await h.snapshot();
  assertNotNull(arrived.sim, "the second run is reported once it has completed");
  assertEqual(
    arrived.sim?.status,
    "complete",
    "the boundary that reached the target completed it, which is arriving at the panel",
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "menuIndex is 0 on arriving at the solved panel, however far the highlight " +
      "had moved on the menu before it",
  );
});
