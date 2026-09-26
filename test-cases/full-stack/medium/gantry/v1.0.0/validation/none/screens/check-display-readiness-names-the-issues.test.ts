// screens/check-display-readiness-names-the-issues — with a readiness issue the
// check display names the issues.
//
// specs/ui.md § Build, the check's table: with "A readiness issue" the screen
// shows "The issues by name, and no verdict". specs/structure.md § Readiness
// gives each issue "a stable identifier, reported wherever readiness is
// reported", and names `no-ring` as the one "The crane has no slew ring."
// raises.
//
// The scenario is the minimal crane that stands with its ring taken away, which
// is the one edit that "is always allowed" (specs/structure.md § Editing) and
// leaves every member standing, so the crane is a crane with rails and no ring
// and `no-ring` is on the list the check display has to name.
//
// The identifier is what is looked for, spelled as specs/structure.md spells
// it, off the text the last frame drew on the screen layer — which
// `h.screenCalls()` answers with every text call measured — with the shared
// harness's `drewTextAnywhere`: the frame's logical runs joined in reading order
// with the whitespace folded out, matched as a substring ignoring case. How a
// build sets the line around an issue's name is its own, and what
// specs/structure.md fixes is the name.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/index";
import { assertContains, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The readiness issue a crane with no slew ring raises. */
const ISSUE = "no-ring";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the readiness issues on the check display", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.clearRing();

  const found = await h.check();
  await h.debug.showCheck();
  await h.advance(1);

  const calls = await h.screenCalls();
  await h.capture("check-issues", "The named readiness issues");

  assertContains(
    found.issues,
    ISSUE,
    `the readiness issue a crane with no slew ring raises, so "${ISSUE}" is ` +
      "one of the issues the screen has to name (specs/structure.md)",
  );
  if (!drewTextAnywhere(calls, ISSUE)) {
    fail(
      `the check display to name the readiness issue "${ISSUE}" ` +
        "(specs/ui.md § Build)",
      `the build screen drew ${JSON.stringify(drawnTextLines(calls))}`,
    );
  }
});
