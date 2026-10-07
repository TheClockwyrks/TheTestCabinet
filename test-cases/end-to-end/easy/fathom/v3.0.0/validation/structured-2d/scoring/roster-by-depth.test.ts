// scoring/roster-by-depth — deeper mazes hold more hunters.
//
// specs/progression.md: "Deeper mazes hold more hunters. Depth `1` holds one
// predator of each kind, each depth beyond the first adds one more, and the roster
// caps at two of each kind, six predators in all, from depth `4` on", listed "in
// release order".
//
// FIVE DEPTHS, BECAUSE THE CAP IS PART OF THE RULE. Depths `1` to `3` each add
// one, depth `4` adds the last, and depth `5` adds nothing — a build that keeps
// adding is only caught by asking a depth past the cap.
//
// THE ROSTER IS BUILT FROM THE TWO ORDERS THE SPECIFICATION NAMES rather than
// written out, so the expectation is the rule and not a transcription of the table
// in specs/predators.md. It agrees with that table depth for depth: `1` is one of
// each, `2` adds a Gloamfin, `3` a Lanternjaw, `4` a Flarefish, and `5` and deeper
// hold at that.
//
// THE DEPTH IS POSED THROUGH `setDepth`, which specs/instrumentation.md has lay
// the depth's roster out "in the den with every `released` flag false" and leave
// the maze, the plankton, the fog and the screen alone. Nothing is loose while the
// readings are taken, so no hunter can wander into one.
//
// WHAT THIS DOES NOT DECIDE. How the pulse's reach follows depth, which is
// `scoring.sonar-range-by-depth`; that nothing ELSE follows it, which is
// `scoring.depth-scales-nothing-else`; and the order the den releases in, which is
// `den.stagger`.

import { afterEach, beforeEach, it } from "vitest";

import { assertDeepEqual } from "../assert";
import {
  DEN_ORDER,
  ROSTER_ADD_ORDER,
  ROSTER_CAP,
  ROSTER_CAP_DEPTH,
  ROSTER_PER_KIND_CAP,
} from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The depths read, which reach one past `ROSTER_CAP_DEPTH` so the cap is tested. */
const DEPTHS = [1, 2, 3, 4, 5] as const;

/** The roster depth `d` holds, in release order, from the orders the spec names. */
function rosterAt(depth: number): string[] {
  const roster: string[] = [...DEN_ORDER];
  for (let extra = 1; extra < depth; extra += 1) {
    const kind = ROSTER_ADD_ORDER[(extra - 1) % ROSTER_ADD_ORDER.length];
    if (roster.filter((held) => held === kind).length >= ROSTER_PER_KIND_CAP) {
      continue;
    }
    roster.push(kind);
  }
  return roster;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the roster each depth gives, in release order", async () => {
  startPlaying(h);

  const read: { depth: number; kinds: string[] }[] = [];
  for (const depth of DEPTHS) {
    h.debug.setDepth(depth);
    read.push({
      depth,
      kinds: h.snapshot().predators.map((one) => one.kind),
    });
  }
  // Before the assertions, so a failing check still leaves the deep maze it read.
  captureStill(h, "roster");

  for (const at of read) {
    assertDeepEqual(
      at.kinds,
      rosterAt(at.depth),
      `the roster at depth ${String(at.depth)}, in the release order a ` +
        "snapshot lists it in (specs/predators.md)",
    );
  }
  assertDeepEqual(
    read[read.length - 1].kinds.length,
    ROSTER_CAP,
    `the roster's size at depth ${String(DEPTHS[DEPTHS.length - 1])}, past ` +
      `ROSTER_CAP_DEPTH (${String(ROSTER_CAP_DEPTH)}), where it holds at ` +
      `ROSTER_CAP (${String(ROSTER_CAP)}) — ${String(ROSTER_PER_KIND_CAP)} of ` +
      "each kind (specs/predators.md)",
  );
});
