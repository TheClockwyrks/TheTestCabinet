// editor/resizing-the-ghost-lengthens-the-place-drag — `part-grow` pressed during
// an arm's place drag lengthens the ghost, and the release places the arm at the
// grown length.
//
// THE RULE. "While a drag is live a ghost of the part is drawn at the targeted
// hex ... and `part-cw`, `part-ccw`, `part-grow`, and `part-shrink` ACT ON THE
// GHOST" (`specs/editor.md`, Dragging). What `part-grow` does is that file's
// Selection section: "`part-grow` and `part-shrink` change an arm's length WITHIN
// THE BOUNDS `specs/parts.md` FIXES", and those bounds are "Length is a whole
// number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`), chosen in the editor"
// (`specs/parts.md`, Arms). A tray drag opens "at rotation `0` and length `1`", so
// two presses reach the top of the range and a third has nowhere to go.
//
// THE CONFIGURATION. `BARE` opened in the editor on the empty machine
// `loadChallenge` leaves, and one gesture: a press in the middle of tray entry
// `0`, which is `arm`, a move onto `ORIGIN`, three presses of `part-grow`, and the
// release. An arm occupies its anchor alone (`specs/parts.md`, placement rule 1)
// — "a gripper and the drawn arm between base and gripper pass over any hex, on or
// off the field, and over any part" — so lengthening the ghost cannot make the
// placement illegal, and no press can be refused for a reason outside this point.
// The press in the tray leaves the focus on `field` (`specs/controls.md`), which is
// the focus `part-grow` is read under rather than `ins-extend`, its `KeyW`
// stablemate.
//
// THE VERDICT. `editor.drag.length` reads `2`, `3`, `3` across the three presses,
// and the arm the release places carries length `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
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

/** Two presses to reach `ARM_MAX_LEN` from `ARM_MIN_LEN`, and one past it. */
const GROWN = [ARM_MIN_LEN + 1, ARM_MAX_LEN, ARM_MAX_LEN];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the ghost's length by one within the arm bounds and places at it", async () => {
  await openChallengeDocument(h, BARE);

  const grown = await captureReplay(h, "grown", async () => {
    await h.advance(1);
    await pressAt(h, centerOf(traySlot(ARM_SLOT)));
    await moveTo(h, hexCenter(ORIGIN));
    await h.advance(1);

    const opened = await h.snapshot();
    assertEqual(
      opened.editor.focus,
      "field",
      "the press in the tray set the focus to field, which is where part-grow is read",
    );
    assertEqual(
      opened.editor.drag?.kind === "place" ? opened.editor.drag.length : null,
      ARM_MIN_LEN,
      "a tray drag opens at length 1, so the presses below are counted from there",
    );

    const seen: (number | null)[] = [];
    for (let press = 0; press < GROWN.length; press += 1) {
      await pressAction(h, "part-grow");
      const drag = (await h.snapshot()).editor.drag;
      seen.push(drag?.kind === "place" ? drag.length : null);
    }

    await releasePointer(h);
    await h.advance(1);
    return seen;
  });

  assertDeepEqual(
    grown,
    GROWN,
    "each part-grow press raises the live place drag's length by one, up to ARM_MAX_LEN",
  );

  const ids = await partIds(h);
  assertEqual(
    ids.length,
    1,
    "the release on a legal hex placed the ghost's part",
  );
  assertEqual(
    partById(await h.snapshot(), ids[0] as number)?.length,
    ARM_MAX_LEN,
    "and the arm it placed carries the length the ghost was grown to",
  );
});
