// Meltdown — waves/opening-phase-pays-no-interest: a run opens with its starting
// money and not a coin more.
//
// `specs/economy.md` pays interest "On entering a build phase between waves",
// and says so again in as many words: it is paid only there, and entering the
// opening phase pays none. `specs/modes.md` fixes what a run opens with: "A run
// that has just started is in the `opening` phase on Wave 1, with its money at
// that row's starting money".
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS ONE, through the real confirm on the
// difficulty menu (`waves/run.ts`, `openRun`), because the requirement is an
// ENTRY effect and `setPhase` runs none (`specs/instrumentation.md`): a posed
// opening phase has never been entered, so nothing could have paid for entering
// it. What this reads is the one frame on which the run actually began.
//
// THE MONEY IS COMPARED AGAINST THE BUILD'S OWN `startMoney`, not against the
// case's table. Whether a build derives `250` for Containment Medium is
// `modes.containment-medium`'s point to decide; this one asks whether the run
// opened holding the figure the build itself derived, or that figure plus a
// payment. So a build with a wrong table still passes here and fails there, and
// a grade names which of the two the build got wrong.
//
// WHY CONTAINMENT MEDIUM. `specs/modes.md` gives it `interest` `yes`, so it is a
// pair on which the payment under test would actually be made: on the specified
// `250`, `floor(0.08 * 250)` is `20`, a sixth again of the opening purse and
// impossible to mistake for rounding. A mode whose interest reads false pays
// none at all, so this reading on Deep Pockets or The Hundred would decide
// nothing.
//
// WHAT EVERY WRONG MODEL READS. A build that pays interest on entering any phase
// reads `270` against a `startMoney` of `250`; one that pays it on the run's
// first frame reads the same; one that pays a flat opening bonus reads its own
// figure. A conformant build reads exactly `startMoney`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openRun } from "./run";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run holding its starting money, with no interest paid", async () => {
  await openRun(h);

  const opened = h.snapshot();
  captureStill(h, "balance");

  assertEqual(opened.screen, "playing", "precondition: the run opened");
  assertEqual(
    opened.phase,
    "opening",
    "precondition: the run opened in the opening phase",
  );
  assertEqual(
    opened.money,
    opened.startMoney,
    "the money a run holds on the frame it opened, against the startMoney the " +
      "build itself derived",
  );
});
