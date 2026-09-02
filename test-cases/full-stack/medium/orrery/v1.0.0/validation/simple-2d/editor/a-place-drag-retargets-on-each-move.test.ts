// editor/a-place-drag-retargets-on-each-move — every pointer move during a place
// drag re-evaluates the hex the ghost stands on.
//
// THE RULE. "Placing and moving run through one drag shape: a press begins it,
// EACH POINTER MOVE RETARGETS IT, and the release commits or cancels it"
// (`specs/editor.md`, Dragging). `specs/controls.md` says the same from the
// pointer's side: "Each pointer position is resolved on its own, IN THE ORDER THE
// POSITIONS ARRIVE, so a drag's ghost and a track being laid follow the pointer
// hex by hex." Which hex a position resolves to is `specs/field.md`'s: "The
// pointer targets the field hex whose center is nearest to the pointer position,
// provided that distance is at most `HEX_HIT_R` (`26`)", the centres being
// `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` and `hexY(q, r) = FIELD_CY +
// HEX_PITCH * (sqrt(3) / 2) * r`. `specs/instrumentation.md` reports the answer as
// the drag's `at: { q, r } | null`.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine empty, and one drag
// opened by a press on tray entry `0`, the arm. The pointer is then moved onto the
// CENTRES of three hexes in turn — `(-1, 0)`, `(0, 0)`, `(1, 0)`, three distinct
// hexes in a row across the middle of the field, each an exact centre and so
// nearer its own hex than `HEX_PITCH / 2` to any other. A frame is drawn after
// each move, which is what the replay records; the moves themselves take effect at
// the call, so no frame is needed to deliver one.
//
// WHAT WOULD FAIL IT. A build that resolved the hex once, at the press, reports
// the same `at` — `null`, since the press was in the tray — for all three moves; a
// build that resolved it at the first MOVE reports `(-1, 0)` three times. So the
// check reads all three answers in order and requires each to be its own hex.
//
// THE VERDICT. The drag stays live across the three moves and reports `(-1, 0)`,
// then `(0, 0)`, then `(1, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, hexCenter, traySlot, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: the one permitted kind, `arm`, then its rise and its set. */
const ARM_SLOT = 0;

/** Three distinct hexes in a row across the middle of the field. */
const PATH: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a different hex for each move rather than holding the one the press began on", async () => {
  await openChallengeDocument(h, BARE);

  const seen: (string | null)[] = [];
  let live = 0;

  await captureReplay(h, "track", async () => {
    await pressAt(h, centerOf(traySlot(ARM_SLOT)));
    for (const hex of PATH) {
      await moveTo(h, hexCenter(hex));
      await h.advance(1);
      const drag = (await h.snapshot()).editor.drag;
      if (drag !== null) live += 1;
      const target = drag?.kind === "place" ? drag.at : null;
      seen.push(
        target === null || target === undefined
          ? null
          : `${target.q},${target.r}`,
      );
    }
    await releasePointer(h);
  });

  assertEqual(
    live,
    PATH.length,
    "the place drag is live across all three moves: a drag ends at its release",
  );
  assertNotNull(
    seen[0],
    "the drag reports a targeted hex after the first move",
  );
  assertDeepEqual(
    seen,
    PATH.map((hex) => `${hex.q},${hex.r}`),
    "each pointer move retargets the drag, so the three moves report the three hexes in the order the positions arrived",
  );
});
