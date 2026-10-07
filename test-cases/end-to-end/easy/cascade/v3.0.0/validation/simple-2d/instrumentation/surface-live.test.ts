// instrumentation/surface-live — the surface is wired to the running game rather
// than to a plausible-looking object beside it.
//
// THE RULE. specs/instrumentation.md makes the surface a deliverable: "Every
// scenario driven from code reaches the game through it", and "A pose arranges
// the table, and the game's own move rules, turning, win test, and cascade run
// from there exactly as they do in play, so a scenario driven from code behaves
// exactly like one played by hand."
//
// WHY IT IS ITS OWN POINT, AND WHY IT IS `broken`. A surface that answers every
// call and reports a state unconnected to the game passes reflection — which is
// `instrumentation/surface-present`'s reading — and then fails every other point
// in this suite for reasons that name the wrong mechanic. This is the point that
// catches it, and a grade that names it is worth more than fifty grades that name
// a mechanic.
//
// THE SURFACE IS DRIVEN BOTH WAYS ROUND: a POSE is read back, and an EVENT is
// applied by the game's own rules.
//
// WHAT THIS DOES NOT DECIDE. Not what any particular operation means — every one
// of them has its own point in this group — and not the rule the move leans on,
// which belongs to `foundations/*` or `tableau/*`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  PileKind,
  pileOf,
  poseColumn,
  topOf,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The one card the liveness pose puts on the table, and the column it goes in. */
const CARD = "AS";
const COLUMN = 2;

/** The foundation it is then moved to: an empty one, which accepts an Ace. */
const FOUNDATION = 1;

/** The named pile's top card as a spec, or `null` where it holds none. */
function topSpec(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
): string | null {
  const top = topOf(snapshot, pile, index);
  return top === null ? null : cardSpec(top);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is live: a posed card reads back and a posed move applies", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);

  // The card the pose asked for is on the column the pose named, so the surface
  // is writing to the game that is actually running.
  assertEqual(
    topSpec(h.snapshot(), "tableau", COLUMN),
    CARD,
    `addCard must put ${CARD} on tableau ${COLUMN} (specs/instrumentation.md)`,
  );

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();

  // The posed card and the applied move, as the build drew them.
  await h.advance(1);
  captureStill(h, "live");

  assertEqual(
    accepted,
    true,
    `move must apply ${CARD} onto empty foundation ${FOUNDATION}, which ` +
      "accepts an Ace of any suit (specs/foundations.md)",
  );
  assertEqual(
    topSpec(after, "foundation", FOUNDATION),
    CARD,
    `foundation ${FOUNDATION} after the move the surface drove`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    `tableau ${COLUMN}, which the moved card has left`,
  );
});
