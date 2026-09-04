// instructions/reset-runs-the-track-the-shorter-way — the track run is whichever
// of `advance` and `recede` reaches the rest cell in fewer steps.
//
// THE RULE. `reset` writes, fourth and last, "`advance` or `recede`, repeated,
// whichever direction reaches the rest cell in fewer steps along the track,
// wrapping counted on a closed track" (`specs/instructions.md`, `reset`). The
// step each names is `specs/parts.md`'s: "The `advance` instruction carries a
// mounted arm's base to the next cell of the path and `recede` to the previous
// one", and an arm is mounted when "its anchor hex is a cell of a track".
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// closed six-cell track — the ring around `(0, 0)` — with two arms anchored on
// it, at cells `1` and `4` of the path. The first carries two `advance` and the
// second two `recede`, so one walk stands two cells FORWARD of its rest cell and
// the other two cells BACK of its. Each is therefore returned by the opposite
// direction from the one that carried it, and the two rows answer the rule in
// its two directions. Nothing else is placed, no run is started, and the focus is
// posed to `tape` with the cursor at column `2` on each row in turn, so each walk
// reads exactly its own two cells.
//
// THE TWO CHOICES ARE TWO AGAINST FOUR. On a six-cell loop a walk two cells from
// rest is four cells from rest the other way round, so "fewer steps" is a real
// choice with a two-cell answer and a four-cell alternative, and neither of the
// two-cell answers passes through the join — this point is about the DIRECTION
// chosen rather than about how wrapping is counted. A build that always advanced
// would write four `advance` on the first row; one that always receded would
// write four `recede` on the second.
//
// THE VERDICT. The arm two cells forward of rest is answered `drop`, `recede`,
// `recede`; the arm two cells back is answered `drop`, `advance`, `advance`; and
// each keeps the two cells before its cursor.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The ring around (0, 0): six cells, each adjacent to the next and the last to the first. */
const RING: readonly Hex[] = [
  at(1, 0),
  at(0, 1),
  at(-1, 1),
  at(-1, 0),
  at(0, -1),
  at(1, -1),
];

/** The arm whose walk runs two cells FORWARD of its rest cell. */
const FORWARD_REST = RING[1] ?? at(0, 0);

/** The arm whose walk runs two cells BACK of its rest cell. */
const BACKWARD_REST = RING[4] ?? at(0, 0);

/** Two steps out, which is four steps out the other way round the loop. */
const FORWARD = ["advance", "advance"] as const;
const BACKWARD = ["recede", "recede"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes the two-step run rather than the four-step one, in both directions", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      trackPart(RING, true),
      armPart("arm", FORWARD_REST.q, FORWARD_REST.r, 0, 1, [...FORWARD]),
      armPart("arm", BACKWARD_REST.q, BACKWARD_REST.r, 0, 1, [...BACKWARD]),
    ]),
  );
  const [track = -1, wentForward = -1, wentBack = -1] = await partIds(h);

  const placed = partById(await h.snapshot(), track);
  assertNotNull(placed, "the track is on the machine");
  assertEqual(placed?.closed, true, "the six-cell track is closed into a loop");

  await h.debug.setFocus("tape");
  await h.debug.setCursor(wentForward, FORWARD.length);
  await pressAction(h, "ins-reset");
  await h.debug.setCursor(wentBack, BACKWARD.length);
  await pressAction(h, "ins-reset");
  await captureStill(h, "track-run");

  const written = await h.snapshot();
  assertDeepEqual(
    partById(written, wentForward)?.tape,
    [...FORWARD, "drop", "recede", "recede"],
    "two cells forward of the rest cell is reached in two recedes and in four advances, so reset writes the recedes",
  );
  assertDeepEqual(
    partById(written, wentBack)?.tape,
    [...BACKWARD, "drop", "advance", "advance"],
    "two cells back of the rest cell is reached in two advances and in four recedes, so reset writes the advances",
  );
});
