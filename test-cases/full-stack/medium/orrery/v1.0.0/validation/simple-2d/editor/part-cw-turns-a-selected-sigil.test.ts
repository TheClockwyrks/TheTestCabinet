// editor/part-cw-turns-a-selected-sigil — the rotation verbs reach a sigil, and the
// sigil's FOOTPRINT turns with its rotation.
//
// THE RULE. "`part-cw` and `part-ccw` turn an arm, a wheel, OR A SIGIL one rotation
// step" (`specs/editor.md`, Selection on the field), one step being
// `specs/field.md`'s "Rotating a direction index clockwise adds `1` modulo `6`".
// And a sigil's hexes hang off that rotation: "Footprints are written as relative
// hexes at rotation `0`; A PLACED SIGIL'S HEXES ARE ITS FOOTPRINT ROTATED AND
// TRANSLATED as `specs/field.md` describes" (`specs/sigils.md`), which
// `specs/parts.md` restates as "Rotation turns the part's shape by 60 degree
// steps using the formulas in `specs/field.md`."
//
// THE SIGIL is `bind`, whose footprint `specs/sigils.md` tabulates as `(0, 0)`
// first and `(1, 0)` second. Anchored on `(0, 0)`, the clockwise formula
// `(q, r) -> (-r, q + r)` carries its second hex from `(1, 0)` to `(0, 1)` at
// rotation `1`, and on around the six neighbours of the anchor, every one of them
// on a field of radius `5`. So no press here is refused by the placement rules —
// a turn that WOULD break them is its own review item.
//
// HOW THE FOOTPRINT IS READ, without asking the snapshot for a field it does not
// carry: through the placement rule the footprint answers to. `specs/parts.md`'s
// rule 2 is that "Sigil footprints … are pairwise disjoint", and
// `specs/instrumentation.md` says each machine operation "is checked against the
// placement rules of `specs/parts.md` alone, and throws an `Error` naming the
// first rule it breaks". `wane`'s footprint is its anchor hex alone, so a `wane`
// placed on a hex is accepted exactly when no sigil footprint covers that hex.
// Three attempts decide where `bind`'s second hex is:
//
//   - before the turn, a `wane` on `(1, 0)` is REFUSED — the footprint is there;
//   - after the turn, a `wane` on `(1, 0)` is ACCEPTED — it has left;
//   - after the turn, a `wane` on `(0, 1)` is REFUSED — it has arrived.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and that one
// `bind` on `(0, 0)`. The selection and the focus are posed through the surface —
// `setSelected` and `setFocus` — so the world the press lands in is the one the
// rule names. The six-press sweep runs FIRST, while the field is otherwise empty,
// and leaves the sigil back at rotation `0`; the footprint attempts follow.
//
// THE VERDICT. After press `k` the sigil's rotation is `k mod 6`; and one further
// press moves the footprint's second hex off `(1, 0)` and onto `(0, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether a `wane` is accepted on `(q, r)`, which reports the hex free of footprints. */
async function waneFits(q: number, r: number): Promise<boolean> {
  try {
    await h.debug.placePart("wane", q, r, 0);
    return true;
  } catch {
    return false;
  }
}

it("raises the selected sigil's rotation by one step per press, carrying its footprint round with it", async () => {
  await openChallengeDocument(h, BARE);
  const sigil = await placePart(h, "bind", ORIGIN);
  await h.debug.setSelected(sigil);
  await h.debug.setFocus("field");

  const placed = partById(await h.snapshot(), sigil);

  for (let press = 1; press <= 6; press += 1) {
    await pressAction(h, "part-cw");
    if (press === 1) {
      await captureStill(h, "turned");
      assertNotNull(placed, "the sigil is on the field before the first press");
      assertEqual(placed?.rotation, 0, "and it stands at rotation 0");
    }

    const turned = partById(await h.snapshot(), sigil);
    assertNotNull(
      turned,
      `the sigil is still on the field after press ${press}`,
    );
    assertEqual(
      turned?.rotation,
      press % 6,
      `press ${press} of part-cw leaves the sigil at rotation ${press % 6}: the rotation verbs reach a sigil as they reach an arm`,
    );
  }

  // Back at rotation 0, so bind's second hex stands on (1, 0).
  assertTrue(
    !(await waneFits(1, 0)),
    "at rotation 0 the sigil's second footprint hex covers (1, 0), so a wane there breaks the disjointness rule",
  );

  await pressAction(h, "part-cw");
  assertEqual(
    partById(await h.snapshot(), sigil)?.rotation,
    1,
    "the seventh press turns the sigil to rotation 1",
  );

  assertTrue(
    await waneFits(1, 0),
    "the footprint turned with the sigil, so its second hex has left (1, 0)",
  );
  assertTrue(
    !(await waneFits(0, 1)),
    "and has arrived on (0, 1), where the clockwise formula (q, r) -> (-r, q + r) carries (1, 0)",
  );
});
