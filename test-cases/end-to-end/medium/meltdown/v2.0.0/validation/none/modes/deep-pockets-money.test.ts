// modes/deep-pockets-money — Deep Pockets opens on ten thousand money.
//
// THE RULE. `specs/modes.md`'s table gives Deep Pockets `10000` starting money,
// and its own section repeats it: "Deep Pockets opens on `10000` money". The
// figure is reported as the derived snapshot field `startMoney`, so this check
// chooses the mode and reads it.
//
// WHY THE FIGURE IS DISTINGUISHING ON ITS OWN. `10000` is two orders of magnitude
// past every other row of the table, and it is the whole of what the mode is for:
// a build that fell back to Containment reads `250`, one that borrowed The
// Hundred's row reads `600`, and one that dropped a digit reads `1000`. All four
// are different numbers, so a failure names the wrong model.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the mode pays no interest is
// `modes.deep-pockets-no-interest`'s, the twenty waves it runs are the
// Containment Medium figure the table repeats, and what money BUYS is the
// building group's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEEP_POCKETS_MONEY } from "../constants";
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

it("derives 10000 starting money from Deep Pockets", async () => {
  await startRun(h, "deeppockets");
  // One frame so the canvas holds the posed run rather than whatever the loop
  // last drew. The run's own release is off, so the frame changes nothing read
  // below.
  await h.advance(1);
  await captureStill(h, "flush");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "deeppockets", "the mode the run was posed on");
  assertEqual(
    snapshot.startMoney,
    DEEP_POCKETS_MONEY,
    "Deep Pockets' starting money",
  );
});
