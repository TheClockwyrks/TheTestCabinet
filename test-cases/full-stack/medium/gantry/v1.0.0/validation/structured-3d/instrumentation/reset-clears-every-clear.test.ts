// instrumentation/reset-clears-every-clear — a reset marks every site uncleared.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] every site
// uncleared with no recorded score". § Snapshot shape reports the marks as
// `cleared`, "`[<boolean>]`, one per site", so every one of the `SITE_COUNT` (`6`)
// entries reads `false`.
//
// Two sites are marked first, and two rather than one because the field is per
// site and a build that cleared only the open one would pass with a single entry.
// `specs/ui.md` gives what the mark carries — "the site at index `n + 1` opens
// once the site at index `n` is cleared" — so this is also what puts the session
// back to only site 1 reachable. Whether a site carries a best score is a separate
// fact, `specs/state.md`: "The two are set independently", and is its own point.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { SITE_COUNT } from "../constants";
import { createHarness, type Harness } from "../harness";

/** Two sites, so a build that cleared only the open one is caught. */
const MARKED = [0, 1] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks every site uncleared", async () => {
  for (const site of MARKED) await h.debug.setCleared(site, true);
  const marked = await h.snapshot();
  for (const site of MARKED) {
    assertTrue(
      marked.cleared[site] === true,
      `the mark setCleared(${site}, true) left, which is the scenario this ` +
        "point rests on",
    );
  }

  await h.debug.reset();
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(s.cleared, SITE_COUNT, "the cleared marks, one per site");
  assertTrue(
    s.cleared.every((one) => one === false),
    "every site uncleared after a reset (specs/instrumentation.md)",
  );
});
