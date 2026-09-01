// handling/drop-target-highlights — the pile a held run would land on is
// reported as the drop target while the run is over it.
//
// `specs/controls.md` fixes it: "While a run is held, the pile that would accept
// it, if any, is the drop target, and it is drawn as highlighted. A pile is the
// drop target only while the release rule below would resolve the run to it and
// that pile accepts the run. The target is recomputed as the pointer moves."
// `specs/tableau.md` fixes the acceptance: a column whose lowest card is rank `r`
// and colour `c` accepts a run led by rank `r - 1` of the other colour.
//
// WHAT IS DECIDED HERE, AND WHAT IS NOT. This is the reporting rule in its
// POSITIVE direction only: a legal pile under the run is named. The refusal
// direction is `handling/no-highlight-illegal`, and whether the highlight is
// visible on the table is `presentation/drop-highlight-visible`.
//
// THE RUN IS CARRIED BY THE BUILD'S OWN OFFSET. The pointer's destination is
// worked out from the position the build reports for the lifted run, so the
// leading card's centre lands inside the target's drop rectangle
// (`specs/table.md`) whatever offset the press gave it. A build that follows the
// pointer by another rule fails `handling/held-run-follows-pointer`, not this.
//
// The run starts over its own source column, which the lift left EMPTY and which
// therefore accepts only a King-led run (`specs/tableau.md`), so nothing is
// reported before the run reaches the target it is carried to.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import {
  card,
  cardCenter,
  captureReplay,
  createHarness,
  dropRect,
  openTable,
  pileTopLeft,
  poseColumn,
  rectCenter,
  type Harness,
} from "../harness";

/** Where the run is lifted from, and the card it is: a red seven, alone. */
const SOURCE = 0;
const HELD = "7H";

/** The column it is carried to: a black eight, which accepts a red seven. */
const TARGET = 4;
const TARGET_CARD = "8S";

/** How the carry is delivered: samples, and the frames drawn between them. */
const CARRY_SAMPLES = 20;
const FRAMES_PER_SAMPLE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the legal column the held run is carried over", async () => {
  await openTable(h);
  await poseColumn(h, SOURCE, [card(HELD)]);
  await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  // The target column holds one face-up card at the moment of the carry, so its
  // drop rectangle is the one `specs/table.md` fixes for a column holding cards.
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));

  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  assertNotNull(lifted, "the run in hand on the press");
  if (lifted === null) return;

  // Where the pointer has to end for the LEADING CARD'S CENTRE to sit in the
  // target's rectangle, given the offset the build took on the press.
  const centre = cardCenter(lifted.x, lifted.y);
  const endX = press.x + (landing.x - centre.x);
  const endY = press.y + (landing.y - centre.y);

  await captureReplay(h, "highlight", async () => {
    for (let step = 1; step <= CARRY_SAMPLES; step += 1) {
      const at = step / CARRY_SAMPLES;
      await h.debug.pointerMove(
        press.x + (endX - press.x) * at,
        press.y + (endY - press.y) * at,
      );
      await h.advance(FRAMES_PER_SAMPLE);
    }
  });

  assertDeepEqual(
    (await h.snapshot()).dropTarget,
    { pile: "tableau", index: TARGET },
    "the target reported under the run carried over the column that accepts it",
  );
});
