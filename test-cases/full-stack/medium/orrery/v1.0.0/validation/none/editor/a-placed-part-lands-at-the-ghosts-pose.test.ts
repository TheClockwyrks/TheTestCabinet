// editor/a-placed-part-lands-at-the-ghosts-pose — the part a release places carries
// the rotation and length its ghost was reporting.
//
// THE RULE. "While a drag is live a ghost of the part is drawn at the targeted
// hex, visibly legal or illegal under the placement rules, and `part-cw`,
// `part-ccw`, `part-grow`, and `part-shrink` ACT ON THE GHOST"; and "From the
// tray: the ghost is A NEW PART at the targeted hex … Releasing on a legal hex
// places it" (`specs/editor.md`, Dragging). The ghost is the part being placed, so
// what the release commits is the pose the ghost stood at — not the rotation `0`
// and length `1` the drag opened at, and not a pose of the placed part's own.
// `specs/instrumentation.md` reports the ghost's pose on the drag — `{ kind:
// "place", part, index, rotation, length, at }` — and the placed part's on the
// machine: `{ id, kind, q, r, rotation, length, … }`.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose one permitted kind is
// `arm`, so tray entry `0` is the arm; the machine is empty. One drag runs from
// entry `0` to `(0, 0)`. With the pointer standing on that hex, two `part-cw`
// presses and two `part-grow` presses act on the ghost, and the drag's own report
// is read immediately before the release — so what the placed part is compared
// against is the pose the BUILD said its ghost held, rather than a pose this check
// assumed. That the pose is not the opening one is asserted too, because a build
// that ignored the four ghost verbs would place a part matching its ghost for the
// wrong reason.
//
// THE PLACEMENT IS LEGAL at every pose here: `specs/parts.md`'s rule 1 asks only
// that an arm's anchor is on the field, and `(0, 0)` is its middle, while "a
// gripper and the drawn arm between base and gripper pass over any hex, on or off
// the field, and over any part."
//
// THE VERDICT. The one part on the field carries exactly the rotation and the
// length `editor.drag` reported at the release.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { hexCenter, traySlot } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: the one permitted kind, `arm`, then its rise and its set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a part carrying the rotation and length the ghost reported", async () => {
  await openChallengeDocument(h, BARE);

  await pressAt(h, centerOf(traySlot(ARM_SLOT)));
  await moveTo(h, hexCenter(ORIGIN));
  await pressAction(h, "part-cw");
  await pressAction(h, "part-cw");
  await pressAction(h, "part-grow");
  await pressAction(h, "part-grow");

  const ghost = (await h.snapshot()).editor.drag;
  const rotation = ghost?.kind === "place" ? ghost.rotation : null;
  const length = ghost?.kind === "place" ? ghost.length : null;

  await releasePointer(h);
  await h.advance(1);
  await captureStill(h, "pose");

  assertNotNull(ghost, "the drag is still live immediately before the release");
  assertEqual(ghost?.kind, "place", "and it is the tray's place drag");
  assertNotEqual(
    `${rotation}/${length}`,
    "0/1",
    "the ghost verbs really did move the ghost off the rotation 0, length 1 a tray drag opens at",
  );

  const parts = (await h.snapshot()).editor.parts;
  assertEqual(parts.length, 1, "the release places one part");
  const placed = parts[0] ?? null;
  assertNotNull(placed, "and it is on the field to be read");
  assertEqual(
    placed?.rotation,
    rotation,
    "the placed part carries the rotation editor.drag reported at the release",
  );
  assertEqual(
    placed?.length,
    length,
    "and the length editor.drag reported at the release",
  );
});
