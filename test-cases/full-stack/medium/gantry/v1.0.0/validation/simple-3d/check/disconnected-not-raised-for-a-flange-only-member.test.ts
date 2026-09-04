// check/disconnected-not-raised-for-a-flange-only-member — a member joined only
// to a flange node is not disconnected.
//
// specs/structure.md § Readiness: `disconnected-members` is raised when "Some
// member belongs to neither the tower nor the arm: it has no member path to an
// anchor OR TO A FLANGE NODE". § The slew ring says why a flange node is enough:
// "The ring divides the structure in two. Everything connected through intact
// members to the top flange is the arm ... everything connected to the bottom
// flange or to an anchor is the tower", and "Members attach to flange nodes like
// any other node". So a strut hanging off a top-flange node belongs to the arm
// however little else holds it, and readiness has nothing to say about it —
// whether it stands is the solve's verdict rather than the editor's.
//
// TWO READINGS AROUND ONE EDIT. The first is a braced tower carrying the ring and
// nothing above it, which raises no `disconnected-members`; the second is that
// same tower with one strut added from the top-flange node `(0, 4, 0)` out to
// `(-2, 6, 0)`, a node nothing else uses. Reading the first is what makes the
// second mean anything: the issue is absent before the edit and absent after it,
// so its absence is attributable to the member rather than to a check that never
// raises it.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type StartIssue,
} from "../harness";

/** A top-flange node of a ring cornered at `(0, 2, 0)`. */
const FLANGE = { x: 0, y: 4, z: 0 } as const;
/** Free space: a lattice node inside site 1's envelope that nothing else uses. */
const FREE = { x: -2, y: 6, z: 0 } as const;

/**
 * The minimal crane's tower and its ring, and nothing above the ring.
 *
 * Every member of it runs between nodes at `y` `0` and `y` `2` — the anchors and
 * the bottom flange — so every one has a member path to an anchor and the first
 * reading carries no `disconnected-members`.
 */
const TOWER: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Tower and ring",
  members: MINIMAL_CRANE.members.filter(
    ([a, b]: DesignMember) => a[1] <= 2 && b[1] <= 2,
  ),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no disconnected-members for a strut hanging off a flange node", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, TOWER);

  assertLacks(
    (await h.check()).issues,
    "the issues of the tower and its ring, every member of which ends at an " +
      "anchor or the bottom flange (specs/structure.md)",
  );

  await h.debug.addMember(
    FLANGE.x,
    FLANGE.y,
    FLANGE.z,
    FREE.x,
    FREE.y,
    FREE.z,
    "strut",
  );
  const structure = (await h.snapshot()).structure;
  if (structure.members.length !== TOWER.members.length + 1) {
    fail(
      `the strut from the top-flange node (${FLANGE.x}, ${FLANGE.y}, ` +
        `${FLANGE.z}) out to (${FREE.x}, ${FREE.y}, ${FREE.z}) to be ` +
        "accepted (specs/structure.md)",
      `the structure carries ${structure.members.length} members`,
    );
  }

  assertLacks(
    (await h.check()).issues,
    `the issues with a strut joined only to the top-flange node (${FLANGE.x}` +
      `, ${FLANGE.y}, ${FLANGE.z}), which gives it a member path to a flange ` +
      "node and so a place in the arm (specs/structure.md)",
  );

  await h.advance(1);
  await h.capture(
    "flange-only",
    "the strut hanging off a top-flange node and touching nothing else",
  );
});

/** `issues` does not carry `disconnected-members`. */
function assertLacks(issues: readonly StartIssue[], context: string): void {
  if (issues.includes("disconnected-members")) {
    fail(`${context}: no "disconnected-members"`, `[${issues.join(", ")}]`);
  }
}
