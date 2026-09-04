// screens/check-display-names-empty-program — the check display names
// `empty-program` when the tape is empty.
//
// specs/ui.md § Build, the check's table: with "No readiness issue, and the
// structure stands" the screen shows "The issues by name, `empty-program` among
// them when the tape is empty, that the structure stands, and each member colored
// by its static utilization". specs/structure.md § The static check makes the
// same list what the check reports: "The issues that would refuse a run: the
// readiness issues above, and `empty-program` for an empty tape".
//
// The crane is the minimal one that stands, so nothing else is on the list and
// `empty-program` is the whole of what the screen has to name. The tape is
// emptied through `clearProgram` rather than left as the site opened it, because
// a site's stored tape is a state a check must not inherit.
//
// `empty-program` IS AN IDENTIFIER, and the screen is read for that identifier
// rather than for a sentence: specs/structure.md gives each issue "a stable
// identifier, reported wherever readiness is reported", and how a build sets it —
// `empty-program`, `EMPTY PROGRAM`, `Empty program` — is its own. Matching
// therefore ignores case, spacing and punctuation.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The issue an empty tape raises (specs/program.md). */
const ISSUE = "empty-program";

/** Every run of text the last closed frame drew, in draw order. */
async function frameText(harness: Harness): Promise<string[]> {
  const ops = (await harness.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** Letters and digits alone, lowercased. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names empty-program on the check display when the tape is empty", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  await h.press("KeyC");
  await h.advance(1);

  const runs = await frameText(h);
  await h.capture(
    "empty-program-shown",
    "The check display naming empty-program",
  );

  if (!bare(runs.join(" ")).includes(bare(ISSUE))) {
    fail(
      `the check display to name "${ISSUE}", the issue an empty tape raises ` +
        "(specs/ui.md § Build)",
      `the build screen drew ${JSON.stringify(runs)}`,
    );
  }
});
