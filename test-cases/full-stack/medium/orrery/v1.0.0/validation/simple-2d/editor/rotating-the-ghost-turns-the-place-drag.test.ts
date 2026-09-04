// editor/rotating-the-ghost-turns-the-place-drag — `part-cw` pressed during a place
// drag turns the ghost, and the release places the part at the turned rotation.
//
// THE RULE. "While a drag is live a ghost of the part is drawn at the targeted
// hex, visibly legal or illegal under the placement rules, and `part-cw`,
// `part-ccw`, `part-grow`, and `part-shrink` ACT ON THE GHOST"
// (`specs/editor.md`, Dragging). What one press of `part-cw` does is fixed by the
// same file — it turns a part "one rotation step" clockwise — and how far a
// rotation counts by `specs/parts.md`: "Every placed arm, wheel, and sigil carries
// an anchor hex and A ROTATION `0` TO `5`". `specs/field.md` fixes the direction
// and the wrap: "Rotating a direction index clockwise ADDS `1` MODULO `6`". A tray
// drag opens "at rotation `0` and length `1`", so the seven presses below run the
// whole ring and come back round.
//
// THE CONFIGURATION. `BARE` opened in the editor on the empty machine
// `loadChallenge` leaves, and one gesture: a press in the middle of tray entry
// `0`, which is `arm`, a move onto `ORIGIN`, seven presses of `part-cw`, and the
// release. An ARM is what is dragged because an arm occupies its anchor alone
// (`specs/parts.md`, placement rule 1), so turning its ghost cannot make the
// placement illegal and no rotation of the ring can be refused for a reason
// outside this point. A press in the tray "sets the focus", and
// `specs/controls.md` puts a press anywhere but the tape panel on `field` focus,
// which is the focus `part-cw` is read under.
//
// THE VERDICT. `editor.drag.rotation` reads `1, 2, 3, 4, 5, 0, 1` across the seven
// presses, and the arm the release places carries rotation `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { hexCenter, traySlot } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

/** Seven presses: one whole ring of six, and one step past it. */
const PRESSES = 7;

/** `0` turned seven steps clockwise, modulo six. */
const TURNED = [1, 2, 3, 4, 5, 0, 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the ghost's rotation by one modulo six and places at it", async () => {
  await openChallengeDocument(h, BARE);

  const turned = await captureReplay(h, "turned", async () => {
    await h.advance(1);
    await pressAt(h, centerOf(traySlot(ARM_SLOT)));
    await moveTo(h, hexCenter(ORIGIN));
    await h.advance(1);

    const opened = await h.snapshot();
    assertEqual(
      opened.editor.focus,
      "field",
      "the press in the tray set the focus to field, which is where part-cw is read",
    );
    assertEqual(
      opened.editor.drag?.kind === "place" ? opened.editor.drag.rotation : null,
      0,
      "a tray drag opens at rotation 0, so the presses below are counted from there",
    );

    const seen: (number | null)[] = [];
    for (let press = 0; press < PRESSES; press += 1) {
      await pressAction(h, "part-cw");
      const drag = (await h.snapshot()).editor.drag;
      seen.push(drag?.kind === "place" ? drag.rotation : null);
    }

    await releasePointer(h);
    await h.advance(1);
    return seen;
  });

  assertDeepEqual(
    turned,
    TURNED,
    "each part-cw press raises the live place drag's rotation by one, modulo six",
  );

  const ids = await partIds(h);
  assertEqual(ids.length, 1, "the release on a legal hex placed the ghost's part");
  assertEqual(
    partById(await h.snapshot(), ids[0] as number)?.rotation,
    TURNED[PRESSES - 1],
    "and the part it placed carries the rotation the ghost was turned to",
  );
});
