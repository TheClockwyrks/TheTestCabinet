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
// identifier, reported wherever readiness is reported", and the identifier is
// what is looked for, spelled as the specification spells it. The reading is
// the text the last frame drew on the screen layer, which `h.screenCalls()`
// answers with every text call measured, read with the shared harness's
// `drewTextAnywhere`: the frame's logical runs joined in reading order with the
// whitespace folded out, matched as a substring ignoring case — so
// `EMPTY-PROGRAM`, an identifier letter-spaced a glyph per call, or one set in a
// longer line all read as the identifier, and how a build sets the line around
// it is its own.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/index";
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

  await h.debug.showCheck();
  await h.advance(1);

  const calls = await h.screenCalls();
  await h.capture(
    "empty-program-shown",
    "The check display naming empty-program",
  );

  if (!drewTextAnywhere(calls, ISSUE)) {
    fail(
      `the check display to name "${ISSUE}", the issue an empty tape raises ` +
        "(specs/ui.md § Build)",
      `the build screen drew ${JSON.stringify(drawnTextLines(calls))}`,
    );
  }
});
