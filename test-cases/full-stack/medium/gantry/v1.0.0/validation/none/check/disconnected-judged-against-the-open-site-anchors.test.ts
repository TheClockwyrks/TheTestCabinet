// check/disconnected-judged-against-the-open-site-anchors — a member's path to an
// anchor is judged against the open site's anchors.
//
// specs/structure.md § Readiness gives `disconnected-members` as "Some member
// belongs to neither the tower nor the arm: it has no member path to an anchor or
// to a flange node", and specs/world.md § Anchors says whose anchors those are:
// "Each site fixes its anchor nodes". specs/instrumentation.md says the same from
// the reading's side — "`site.anchors` ... are the open site's own figures, read
// by `siteIndex`" — so the same lone strut is disconnected on one site and part
// of the tower on another, and nothing about the strut decides which.
//
// THE SAME STRUT, TWICE, ON TWO SITES CHOSEN FOR THEIR ANCHOR SETS. It stands on
// `(4, 0, 0)`, which specs/sites.md gives to site 6 (Heavy Haul, nine anchors)
// and withholds from site 1 (First Lift, whose four are `(0,0,0)`, `(2,0,0)`,
// `(0,0,2)` and `(2,0,2)`). Both sites' envelopes hold both its nodes, so the
// placement itself is identical and only the ground under it differs.
//
// EACH SITE IS OPENED FRESH AND ITS YARD EMPTIED. A site opened on a game that
// has been `reset` carries nothing built and no tape (specs/instrumentation.md),
// so the strut is the whole crane on both — the reading below checks that it is
// the structure's only member — and the issue can come from nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue, fail } from "../assert";
import { SITES } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type StartIssue,
} from "../harness";

/** The lone strut: from a ground node out of the ground, touching nothing else. */
const FOOT = { x: 4, y: 0, z: 0 } as const;
const HEAD = { x: 4, y: 2, z: 0 } as const;

/** Site 1, whose anchors do not include `(4, 0, 0)`. */
const WITHOUT = 0;
/** Site 6, whose nine anchors do. */
const WITH = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("calls the same lone strut disconnected only on the site that does not anchor it", async () => {
  assertTrue(
    !anchors(WITHOUT).some(same) && anchors(WITH).some(same),
    `site ${WITHOUT + 1} to withhold the anchor (${FOOT.x}, ${FOOT.y}, ` +
      `${FOOT.z}) that site ${WITH + 1} gives (specs/sites.md)`,
  );

  await openSite(h, WITHOUT);
  await emptyYard(h);
  await standTheStrut();
  const unanchored = (await h.check()).issues;
  assertContains(
    unanchored,
    "disconnected-members",
    `the issues on site ${WITHOUT + 1}, whose anchors leave the strut with ` +
      "no member path to one (specs/structure.md)",
  );

  await h.advance(1);
  await h.capture(
    "against-the-anchors",
    "the lone strut on the site that does not anchor it",
  );

  await openSite(h, WITH);
  await emptyYard(h);
  await standTheStrut();
  const anchored = (await h.check()).issues;
  assertLacks(
    anchored,
    "disconnected-members",
    `the issues on site ${WITH + 1}, which anchors (${FOOT.x}, ${FOOT.y}, ` +
      `${FOOT.z}), so the strut ends at an anchor and belongs to the tower`,
  );
});

/** The strut, placed as the one thing the open site's structure holds. */
async function standTheStrut(): Promise<void> {
  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  assertTrue(
    (await h.snapshot()).structure.members.length === 1,
    "the strut standing as the whole of the structure (specs/structure.md)",
  );
}

/** The anchors specs/sites.md gives a site. */
function anchors(
  index: number,
): readonly { x: number; y: number; z: number }[] {
  return SITES[index]!.anchors;
}

/** Whether an anchor is the node the strut stands on. */
function same(node: { x: number; y: number; z: number }): boolean {
  return node.x === FOOT.x && node.y === FOOT.y && node.z === FOOT.z;
}

/** `issues` does not carry `issue`. */
function assertLacks(
  issues: readonly StartIssue[],
  issue: StartIssue,
  context: string,
): void {
  if (issues.includes(issue)) {
    fail(`${context}: no "${issue}"`, `[${issues.join(", ")}]`);
  }
}
