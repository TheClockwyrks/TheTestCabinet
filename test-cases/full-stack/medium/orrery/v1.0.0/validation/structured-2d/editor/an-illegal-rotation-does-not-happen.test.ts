// editor/an-illegal-rotation-does-not-happen — a turn whose result would break a
// placement rule leaves the part exactly as it stands.
//
// THE RULE. "A rotation or length change that would make the placement illegal
// under `specs/parts.md` DOES NOT HAPPEN" (`specs/editor.md`, Selection on the
// field). The rules it defers to are `specs/parts.md`'s: rule 1, "Every hex of the
// part is on the field: … every footprint hex of a sigil, rise, or set"; and rule
// 2, "Sigil footprints, rise and set footprints included, are pairwise disjoint".
// What a turn moves is the footprint, because "a placed sigil's hexes are its
// footprint rotated and translated" (`specs/sigils.md`), and one clockwise step is
// `specs/field.md`'s `(q, r) -> (-r, q + r)`.
//
// THE SIGIL is `bind`, whose footprint `specs/sigils.md` tabulates as `(0, 0)`
// first and `(1, 0)` second, so a turn moves exactly one hex — the second — round
// the six neighbours of the anchor.
//
// TWO WORLDS, ONE FOR EACH RULE, each posed on `BARE` with the machine cleared,
// the sigil selected through `setSelected` and the focus on the field:
//
//   OFF THE FIELD. One `bind` anchored on `(-5, 5)`, a hex of the field's rim —
//   `max(5, 5, 0) <= FIELD_R`. Its second hex runs `(-4, 5)` at rotation `0`,
//   `(-5, 6)` at `1`, `(-5, 4)` at `4`, `(-4, 4)` at `5`; of those `(-5, 6)` is
//   OFF the field, since `max(5, 6, 1)` is `6`. So the sigil is posed at rotation
//   `4` and pressed three times: `4 -> 5` and `5 -> 0` are legal and must happen,
//   which is what says the verb is live in this world, and `0 -> 1` would carry
//   the second hex off the field and must not.
//
//   OVERLAPPING. One `bind` anchored on `(1, -1)`, whose second hex runs the six
//   neighbours of that anchor, every one of them on the field. Six presses turn it
//   right round — all legal while the field holds nothing else, which is again
//   what says the verb is live — and leave it back at rotation `0`, footprint
//   `(1, -1)`-`(2, -1)`. A SECOND `bind` is then placed on `(0, 0)`, footprint
//   `(0, 0)`-`(1, 0)`, disjoint from the first. Now a seventh press would carry
//   the first sigil's second hex onto `(1, 0)`, which the second sigil's footprint
//   already covers, and must not happen.
//
// THE VERDICT. In each world the refused press leaves the sigil's rotation and its
// anchor exactly where they stood, so its footprint stands where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";

/** A rim hex: `max(5, 5, 0)` is `FIELD_R`, so it is on the field. */
const RIM = at(-5, 5);

/** An anchor whose six neighbours are all on the field. */
const INNER = at(1, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a turn that would leave the field, and one that would overlap another footprint", async () => {
  await openChallengeDocument(h, BARE);

  /* -- Off the field ------------------------------------------------------ */

  const rim = await placePart(h, "bind", RIM);
  await h.debug.setPartRotation(rim, 4);
  await h.debug.setSelected(rim);
  await h.debug.setFocus("field");

  await pressAction(h, "part-cw");
  const toFive = partById(await h.snapshot(), rim)?.rotation;
  await pressAction(h, "part-cw");
  const toZero = partById(await h.snapshot(), rim)?.rotation;

  await pressAction(h, "part-cw");
  await captureStill(h, "off-field");

  assertEqual(
    toFive,
    5,
    "the turn from rotation 4 to 5 keeps the footprint on the field, so it happens",
  );
  assertEqual(
    toZero,
    0,
    "and so does the turn from 5 to 0: part-cw is live in this world",
  );

  const held = partById(await h.snapshot(), rim);
  assertNotNull(
    held,
    "the sigil is still on the field after the refused press",
  );
  assertEqual(
    held?.rotation,
    0,
    "the turn from 0 to 1 would carry the second footprint hex to (-5, 6), off the field, so it does not happen",
  );
  assertEqual(
    `${held?.q},${held?.r}`,
    `${RIM.q},${RIM.r}`,
    "and the refused turn moves the anchor no more than it moves the rotation",
  );

  /* -- Overlapping -------------------------------------------------------- */

  await h.debug.clearMachine();
  const inner = await placePart(h, "bind", INNER);
  await h.debug.setSelected(inner);
  await h.debug.setFocus("field");

  const sweep: (number | undefined)[] = [];
  for (let press = 1; press <= 6; press += 1) {
    await pressAction(h, "part-cw");
    sweep.push(partById(await h.snapshot(), inner)?.rotation);
  }

  const blocker = await placePart(h, "bind", ORIGIN);
  await h.debug.setSelected(inner);
  const standing = partById(await h.snapshot(), blocker);

  await pressAction(h, "part-cw");
  await captureStill(h, "overlap");

  assertDeepEqual(
    sweep,
    [1, 2, 3, 4, 5, 0],
    "the six presses turn it freely while the field holds nothing else: part-cw is live in this world too",
  );
  assertNotNull(
    standing,
    "a second bind stands on (0, 0), its footprint disjoint from the first's",
  );

  const blocked = partById(await h.snapshot(), inner);
  assertNotNull(
    blocked,
    "the first sigil is still on the field after the refused press",
  );
  assertEqual(
    blocked?.rotation,
    0,
    "the turn from 0 to 1 would carry its second footprint hex onto (1, 0), which the other footprint covers, so it does not happen",
  );
  assertEqual(
    `${blocked?.q},${blocked?.r}`,
    `${INNER.q},${INNER.r}`,
    "and the refused turn moves the anchor no more than it moves the rotation",
  );
});
