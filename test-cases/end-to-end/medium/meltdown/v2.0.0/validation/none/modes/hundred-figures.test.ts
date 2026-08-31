// modes/hundred-figures — The Hundred opens with 600 money, 20 lives, and pays no
// interest.
//
// THE RULE. `specs/modes.md`'s table gives The Hundred `600` starting money,
// `20` starting lives, and `no` under interest. All three are reported as derived
// snapshot fields — `startMoney`, `startLives`, `interest` — so this check
// chooses the mode and reads the row.
//
// WHY THE THREE TOGETHER. They are what the row states beyond the wave count and
// the build phases, which are `modes.hundred-has-no-build-phases`'s business, and
// each of them is distinguishing on its own. `600` is a figure no other row
// carries, so a build that fell back to Containment reads `250`, one that
// confused The Hundred with Deep Pockets reads `10000`, and one that treated the
// hundred units as a hundred money reads `100`. The lives are `START_LIVES` here
// and NOT Sudden Death's `1`, which is the one row that lowers them. And a build
// that left interest on would pay it — but only if it also opened a build phase,
// which The Hundred never does, so the flag itself is the honest reading and the
// money across a clear is not.
//
// WHAT THIS ITEM DOES NOT DECIDE. What interest is worth and when it is paid is
// `economy.interest-paid`'s; that a mode reading `interest` false pays none is
// `modes.deep-pockets-no-interest`'s, on the one mode where a build phase exists
// to pay it in.
//
// The run is posed live at its own `opening` phase rather than the between-wave
// build phase `startRun` leaves, because The Hundred has no build phase: the
// picture kept as evidence should be a state the mode can actually be in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUNDRED_MONEY, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives 600 money, 20 lives and no interest from The Hundred", async () => {
  await startRun(h, "hundred");
  // The Hundred's one untimed opening phase, in place of the between-wave build
  // phase `startRun` poses: `specs/waves.md` gives the opening phase a
  // `buildTimer` of `0`.
  await h.debug.setPhase("opening");
  await h.debug.setBuildTimer(0);

  await h.advance(1);
  await captureStill(h, "figures");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "hundred", "the mode the run was posed on");
  assertEqual(
    snapshot.startMoney,
    HUNDRED_MONEY,
    "The Hundred's starting money",
  );
  assertEqual(
    snapshot.startLives,
    START_LIVES,
    "The Hundred's starting lives",
  );
  assertEqual(snapshot.interest, false, "The Hundred pays no interest");
});
