// screens/check-display-says-it-stands — with a sound crane the check display
// says the structure stands.
//
// specs/ui.md § Build, the check's table: with "No readiness issue, and the
// structure stands" the screen shows "The issues by name, `empty-program` among
// them when the tape is empty, that the structure stands, and each member colored
// by its static utilization". specs/structure.md § The static check fixes what
// standing is: with no readiness issue "the two solves of specs/statics.md run at
// the run-start posture ... and the structure stands when both solves are
// regular".
//
// The crane is the minimal one that stands, posed on an isolated site: no loads,
// no obstacles, and nothing built but the crane, so the verdict on screen is the
// verdict of the structure this check posed. The check is put on screen with
// `showCheck`, which poses the `check` action, because what this point is about
// is what the SCREEN shows and not what the `check` reading answers.
//
// THE COPY IS NOT FIXED BY THE SPECIFICATION — no `STANDS_TEXT` is named — so the
// screen is read for a verdict rather than for a sentence: a run that says the
// structure stands, and does not say it does not. Case, spacing and punctuation
// are ignored, and "stable" is taken as the same verdict as "stands".

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertTrue, fail } from "../assert";
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
  const ops = (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
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

/** Whether the verdict it carries is the negative one. */
function saysItDoesNot(text: string): boolean {
  const said = words(text);
  return (
    /\bunstable\b/.test(said) ||
    /\b(not|never|cannot|cant|wont|no|fails|fail|falls|collapse|collapses)\b[a-z ]*\b(stand|stands|standing|stable)\b/.test(
      said,
    )
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("says the structure stands when the check finds a sound crane", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  const found = await h.check();
  await h.debug.showCheck();
  await h.advance(1);

  const runs = await frameText(h);
  await h.capture("check-stands", "The stands verdict");

  assertTrue(
    found.stable,
    "the minimal crane to stand, so the verdict the screen owes below is the " +
      "standing one (specs/structure.md § The static check)",
  );
  const verdict = runs.find((run) => statesVerdict(run) && !saysItDoesNot(run));
  if (verdict === undefined) {
    fail(
      "the check display to say that the structure stands (specs/ui.md " +
        "§ Build)",
      `the build screen drew ${JSON.stringify(runs)}`,
    );
  }
});
