// sigils/manifold-skips-joined-reach — a reach already joined to the center gains
// nothing.
//
// THE RULE. `manifold` binds each occupied reach "exactly as `bind` binds a pair:
// a weight `1` filament WHERE NONE JOINS THEM YET. One filament is created for
// each reach hex holding a mote NOT ALREADY JOINED TO THE CENTER"
// (`specs/sigils.md`). `specs/field.md` is why: "At most one filament joins a
// given pair of motes."
//
// THE CONFIGURATION. One `manifold` anchored on `(0, 0)` at rotation `0`; one
// `dust` on the center; one `dust` on the reach at `(1, 0)`, ALREADY JOINED to the
// center by `linkMotes`, which "Joins motes `a` and `b` with one filament"
// (`specs/instrumentation.md`); one `dust` on the reach at `(0, -1)`, joined to
// nothing; and the reach at `(-1, 1)` left empty. Nothing else is placed and
// nothing else is on the field.
//
// WHY BOTH REACHES ARE OCCUPIED. The manifold has to have something to do at this
// boundary, or "created exactly one" and "created nothing" would read the same. So
// one reach is the one already joined and the other is the one still to join, and
// the count separates them: a build that skips nothing reports three filaments, a
// build that gives up when one reach is joined reports one — the one the check
// laid — and only a build that skips the joined reach and binds the other reports
// two, of which exactly one is new.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the three motes
// rest `48` and `83.14` apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Two filaments in all. The pre-existing one still joins the center
// to `(1, 0)` and still carries the weight it was laid with, and the new one joins
// the center to `(0, -1)` at weight `1`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the manifold is engraved. */
const ANCHOR = at(0, 0);

/** The `center` hex of `manifold`'s footprint, placed. */
const CENTER = place(at(0, 0), ANCHOR, 0);

/** The reach already joined to the center when the boundary runs. */
const JOINED = place(at(1, 0), ANCHOR, 0);

/** The reach holding a mote joined to nothing. */
const LOOSE = place(at(0, -1), ANCHOR, 0);

/** The reach left empty. */
const EMPTY = place(at(-1, 1), ANCHOR, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one filament, for the reach not already joined to the center", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("manifold", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const center = await spawnMote(h, CENTER, "dust");
  const joined = await spawnMote(h, JOINED, "dust");
  const loose = await spawnMote(h, LOOSE, "dust");
  await h.debug.linkMotes(center, joined, 1);

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "manifold"),
    "the machine carries the one manifold the check placed",
  );
  assertNull(
    moteAt(before, EMPTY),
    "the third reach holds nothing when the boundary runs",
  );
  assertLength(
    before.sim?.filaments ?? [],
    1,
    "one reach is already joined to the center when the boundary runs, and nothing else is",
  );
  assertNull(
    filamentBetween(before, center, loose),
    "the other occupied reach is joined to nothing when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "one-new");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding one reach halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    filamentBetween(snapshot, center, loose)?.weight,
    1,
    "the reach not already joined to the center is bound to it at weight 1",
  );
  assertEqual(
    filamentBetween(snapshot, center, joined)?.weight,
    1,
    "the reach already joined keeps the one filament it had",
  );
  assertLength(
    sim?.filaments ?? [],
    2,
    "one of the two occupied reaches was already joined, so the boundary created exactly one filament",
  );
});
