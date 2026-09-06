// screens/refused-start-names-the-issues — a refused start shows the issues that
// refused it, by name.
//
// specs/ui.md § Build: "A refused start (specs/program.md) stays on the screen
// and shows the refusing issues by name." specs/program.md refuses a start on the
// readiness issues and on an empty tape; specs/structure.md § Readiness gives
// each issue "a stable identifier, reported wherever readiness is reported", and
// names `no-ring` for "The crane has no slew ring." and `no-rail` for "The crane
// has no rail members."
//
// The structure is two struts standing on two of the site's anchors: no ring and
// no rail members, and every member reaching an anchor, so the issues refusing the
// start are exactly `no-ring` and `no-rail` and neither is drowned in a longer
// list. The start is asked for with the `run` action itself (specs/controls.md
// binds it to `KeyG`), because a refused start is what this point is about.
//
// The identifiers are what is looked for, spelled as specs/structure.md spells
// them, off the text the last frame drew on the screen layer — which
// `h.screenCalls()` answers with every text call measured — with the shared
// harness's `drewTextAnywhere`: the frame's logical runs joined in reading order
// with the whitespace folded out, matched as a substring ignoring case. How a
// build sets the line around an issue's name is its own, and what
// specs/structure.md fixes is the name.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { assertContains, fail } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The two issues this structure's start is refused on. */
const ISSUES = ["no-ring", "no-rail"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the issues that refused the start", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut");

  const found = await h.check();
  await h.press("KeyG");
  await h.advance(1);

  const calls = await h.screenCalls();
  await h.capture("refused-issues", "The named refusing issues");

  for (const issue of ISSUES) {
    assertContains(
      found.issues,
      issue,
      `the issues a crane with no ring and no rails raises, so "${issue}" is ` +
        "one of the issues that refused the start (specs/structure.md)",
    );
  }
  for (const issue of ISSUES) {
    if (!drewTextAnywhere(calls, issue)) {
      fail(
        `the refused start to name the issue "${issue}" that refused it ` +
          "(specs/ui.md § Build)",
        `the build screen drew ${JSON.stringify(drawnTextLines(calls))}`,
      );
    }
  }
});
