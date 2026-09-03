// screens/check-display-readiness-shows-no-verdict — with a readiness issue the
// check display shows no verdict.
//
// specs/ui.md § Build, the check's table: with "A readiness issue" the screen
// shows "The issues by name, and no verdict: with a readiness issue the structure
// is not solved, and the check reports no member, so nothing is colored".
// specs/structure.md § The static check says the same from the solve's side:
// "With any readiness issue the structure is not solved."
//
// The scenario is the minimal crane that stands with its ring taken away — the
// one edit that "is always allowed" and leaves every member standing — so the
// only thing between this crane and a verdict is the readiness issue itself.
//
// WHAT IS ASSERTED IS THAT THE CHECK ADDED NO VERDICT, and the reading is
// deliberately differential: the frame's runs are taken before the `check` action
// and again after it, and only the runs the check PUT ON THE SCREEN are held to
// the requirement. A build is free to word a hint, a legend or a control line
// with the word "stands" in it, and copy that was already on screen before the
// check ran is not the check display saying anything.
//
// THE COPY IS NOT FIXED BY THE SPECIFICATION, so a verdict is recognized by the
// words a verdict is stated in — "stands", "does not stand", "stable",
// "unstable" — with case, spacing and punctuation ignored.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall } from "../case-harness/index";
import { assertContains, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The page global the shared harness installs its draw recorder on. */
const RECORDER = "__tcabRec";

/** Every run of text the last closed frame drew, in draw order. */
async function frameText(harness: Harness): Promise<string[]> {
  const ops = await harness.screenOps();
  return drawnText(ops.map(toDrawCall));
}

/** The run's words, lowercased, everything but letters turned to spaces. */
function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()} `;
}

/** Whether a run carries a verdict on whether the structure stands. */
function statesVerdict(text: string): boolean {
  return /\b(stand|stands|standing|stable|unstable)\b/.test(words(text));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts no verdict on the screen when the check finds a readiness issue", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.clearRing();

  await h.advance(1);
  const before = new Set(await frameText(h));

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);
  const after = await frameText(h);
  await h.capture("check-no-verdict", "The check display with no verdict");

  assertContains(
    found.issues,
    "no-ring",
    "the readiness issue a crane with no slew ring raises, so the screen is " +
      "showing the readiness row of the check's table (specs/ui.md § Build)",
  );
  const verdict = after.find((run) => !before.has(run) && statesVerdict(run));
  if (verdict !== undefined) {
    fail(
      "the check display to show no verdict at all with a readiness issue, " +
        "because the structure is not solved (specs/ui.md § Build)",
      `the check put "${verdict}" on the screen`,
    );
  }
});
