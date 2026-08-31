// Meltdown — economy/no-early-send-bonus-in-the-opening-phase: sending from the
// opening phase pays nothing.
//
// `specs/economy.md`: "The early-send bonus is paid on sending from a build phase
// alone. Sending from the untimed opening phase, which carries no timer, pays
// nothing." `specs/waves.md` fixes what the opening phase is: "The opening phase
// runs before Wave 1. It carries no countdown, reports a `buildTimer` of `0`, and
// never starts a wave on its own however long it runs. Sending is what begins
// Wave 1."
//
// WHY A TIMER IS POSED ON A PHASE THAT HAS NONE. Read on a phase reporting the
// `0` it is required to report, this point would decide nothing: `floor(0)` is
// `0`, so a build that pays `floor(buildTimer)` on every send — the defect the
// item exists to catch — would pass without ever consulting the phase. So the
// timer is posed to the same `9.4` `economy.early-send-bonus` reads `9` from, and
// the phase is the opening one. `setBuildTimer` "sets the seconds left in the
// current build phase" and poses that field alone
// (`specs/instrumentation.md`), so what the game is handed is a phase that is
// `opening` with a number on its clock, and the requirement for that state is not
// ambiguous: the bonus "is paid on sending from a build phase alone".
//
// A BUILD THAT KEEPS ITS OPENING TIMER AT `0` PASSES JUST THE SAME, and that is
// deliberate. Nothing here asserts that the posed timer stuck: a build entitled
// to hold the opening phase's timer at `0` reads `0` on the send and pays
// nothing, exactly as one that consults the phase does. The only build this fails
// is one that pays for time left without asking which phase it is leaving.
//
// THE SEND IS THE PLAYER'S SEND, through the key `specs/controls.md` binds the
// action to, read out of `BINDINGS`, because the debug surface carries no send.
//
// THE PURSE IS POSED EMPTY, so any payment at all shows up as the whole balance,
// and the WORLD GATE STAYS SHUT, so the wave the send begins releases nothing
// that could be killed or leaked and move the money underneath the reading
// (`specs/instrumentation.md`).
//
// WHAT EVERY WRONG MODEL READS. A build that pays `floor(buildTimer)` whatever
// the phase reads `9`; one that pays the full `BUILD_PHASE_TIME` on any send
// reads `15`; one that pays the timer itself reads `9.4`. Anything but `0` is a
// build paying for a countdown that was never running.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The seconds posed on the opening phase's clock: the same figure
 * `economy.early-send-bonus` reads `9` from, so a build that pays without
 * consulting the phase pays `9` here and is caught.
 */
const TIMER = 9.4;

/** The money the run holds going into the send: nothing at all. */
const PURSE = 0;

/**
 * What the send must pay, to the point: nothing at all.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number
 * and `specs/economy.md` fixes the figure exactly, so the assertion is equality.
 */
const EXPECTED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays nothing for the send that begins Wave 1 from the opening phase", async () => {
  startRun(h);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(TIMER);
  h.debug.setMoney(PURSE);

  const before = h.snapshot().money;
  await tapAction(h, "send");
  await h.advance(1);

  captureStill(h, "opening");
  const after = h.snapshot().money;

  assertEqual(
    after - before,
    EXPECTED,
    "the money the send from the opening phase paid",
  );
});
