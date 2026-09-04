// instrumentation/invalid-site-index-fails-loudly — an index no site carries is
// a bad argument.
//
// specs/instrumentation.md § The operations: "An argument outside the domain its
// operation states is invalid, and the call fails loudly rather than guessing
// what was meant. So is an index no site, load, or tape step carries." The four
// operations that take a site index are `openSite`, `setCleared`, `setBest` and
// `clearBest`, and `specs/sites.md` fixes the domain: `SITE_COUNT` (`6`) sites,
// counted from `0`, so `0..5` and nothing else.
//
// Each of the four is called once with an index outside that, and both edges are
// tried: one past the top and one below the bottom, which is the same rule from
// the other side.
//
// The scenario stands a site open, a site marked cleared and a site scored before
// any of it, because the reading afterwards is what says nothing was guessed at:
// an `openSite(6)` that clamped to the last site would move `siteIndex`, and a
// `setBest(6, ...)` that wrapped would land on a site that already carries a
// score of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import { SITE_COUNT } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The site left open, so a stray `openSite` shows in `siteIndex`. */
const OPEN = 1;
/** The site marked cleared, and the site carrying a score. */
const MARKED = 0;
const SCORED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails loudly on a site index outside 0..SITE_COUNT-1, and sets nothing", async () => {
  await openSite(h, OPEN);
  await h.debug.setCleared(MARKED, true);
  await h.debug.setBest(SCORED, 1234, 56);

  const before = await h.snapshot();
  assertEqual(before.siteIndex, OPEN, "the site the scenario opened");

  const strangers: readonly [string, () => Promise<void>][] = [
    [`openSite(${SITE_COUNT})`, () => h.debug.openSite(SITE_COUNT)],
    ["openSite(-1)", () => h.debug.openSite(-1)],
    ["setCleared(9, true)", () => h.debug.setCleared(9, true)],
    [`setBest(${SITE_COUNT}, 1, 1)`, () => h.debug.setBest(SITE_COUNT, 1, 1)],
    ["clearBest(-1)", () => h.debug.clearBest(-1)],
  ];

  for (const [what, call] of strangers) {
    let threw = false;
    try {
      await call();
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(
        `${what} to fail loudly, no site carrying that index ` +
          `(specs/instrumentation.md; specs/sites.md gives ${SITE_COUNT} ` +
          "sites)",
        "the call returned instead",
      );
    }
    const after = await h.snapshot();
    assertEqual(after.siteIndex, before.siteIndex, `siteIndex across ${what}`);
    assertDeepEqual(after.cleared, before.cleared, `cleared across ${what}`);
    assertDeepEqual(after.best, before.best, `best across ${what}`);
  }

  await h.advance(1);
  await h.capture(
    "site-indices-intact",
    "The open site the five refused calls left standing",
  );
});
