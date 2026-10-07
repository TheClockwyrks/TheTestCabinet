// automove/starts-a-foundation — an Ace auto-moves onto an empty foundation.
//
// specs/foundations.md: a foundation holding nothing accepts an Ace of any suit, and
// an Ace belongs on an empty foundation. Any suit may be started on any empty
// foundation, so the suits are not tied to fixed slots.
// specs/instrumentation.md: `autoMove` sends the playable card home when that is
// legal and returns `true` when it went.
//
// WHICH SLOT IS NOT ASSERTED, AND MUST NOT BE. The specification leaves the slot to
// the build, so this reads that exactly one foundation ends up holding cards and
// that it holds the Ace alone. A build that started the Ace on slot 3 is as correct
// as one that started it on slot 0, and both pass; a build that sent nothing, sent
// something else, or dealt the Ace onto two slots fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the Ace waits in. */
const COLUMN = 5;
/** The Ace in play. Its suit is arbitrary: an empty foundation takes any Ace. */
const ACE = "AD";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts an empty foundation with the Ace", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [ACE]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${ACE} there and four empty ` +
      "foundations (specs/instrumentation.md)",
  );
  // Every foundation that ended up holding anything, whichever slots they are.
  const started = after.foundations
    .map((cards) => pileSpecs(cards))
    .filter((specs) => specs.length > 0);
  assertDeepEqual(
    started,
    [[ACE]],
    "the foundations holding cards: one of them, started by the Ace and " +
      "holding it alone (specs/foundations.md)",
  );
  assertLength(
    after.tableau[COLUMN],
    0,
    `the cards left in column ${COLUMN}: the Ace has left it ` +
      "(specs/tableau.md)",
  );
});
