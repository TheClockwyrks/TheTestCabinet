// sigils/bind-joins-held-motes — being carried is not a reason not to bind.
//
// THE RULE, in `specs/sigils.md`'s own sentence for `bind`: "Held motes bind like
// any others". The condition itself names nothing about holds — "When both hexes
// hold motes and no filament joins that pair, a filament of weight `1` is created
// between them" — and the file's terms list makes that deliberate: `unheld` is
// defined there and spent on the sigils whose conditions ask for it, `ascend`,
// `conjoin`, `eclipse`, `confluence`, `dispersion` and `void`. `bind` does not ask.
//
// THE CONFIGURATION. One `bind` anchored on `(0, 0)` at rotation `0`, so its hexes
// are `(0, 0)` and `(1, 0)`, with a `dust` resting on each. One `arm` anchored on
// `(-1, 0)` at rotation `0` and length `1`, whose one gripper stands at
// "`base + length * DIRS[d]`" (`specs/parts.md`), which is `(0, 0)`, the bind's
// first hex. Its tape is EMPTY, and "A blank cell is a rest on every part"
// (`specs/simulation.md`), so the arm holds and does not move: the cycle under
// test is about the boundary alone.
//
// THE HOLD IS POSED, NOT TAKEN. `setGrip` "takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so the boundary under test is the first boundary
// the hold exists across, and no earlier cycle could have bound the pair.
//
// Nothing moves and nothing collides: the two motes rest `HEX_PITCH` (`48`) apart,
// above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. The boundary still creates exactly one filament between them, at
// weight `1`, and the gripper is still holding what it held: a bind joins, it does
// not drop anything. A build that skips a held mote reports no filament at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  heldBy,
  openBareRun,
  partIds,
  solePartOfKind,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `bind`'s footprint, placed: also the gripper's hex. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `bind`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** Where the arm stands, one step west of the first hex. */
const BASE = at(-1, 0);

/** The arm's one spoke: `DIRS[0]` is `(1, 0)`, east. */
const SPOKE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("binds the pair though a gripper is holding the mote on the first hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("bind", ANCHOR.q, ANCHOR.r, 0),
      armPart("arm", BASE.q, BASE.r, SPOKE, 1, []),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const first = await spawnMote(h, FIRST, "dust");
  const second = await spawnMote(h, SECOND, "dust");
  await takeGrip(h, arm, SPOKE, first);

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "bind"),
    "the machine carries the one bind the check placed",
  );
  assertEqual(
    heldBy(before, arm, SPOKE),
    first,
    "the gripper over the first hex is holding that mote when the boundary runs",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins the pair when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "held-bind");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding a held pair halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    filamentBetween(snapshot, first, second)?.weight,
    1,
    "held motes bind like any others, so the boundary created the weight 1 filament",
  );
  assertLength(sim?.filaments ?? [], 1, "one bind, one boundary, one filament");
  assertDeepEqual(
    constellationOf(snapshot, second),
    [first, second].sort((a, b) => a - b),
    "the filament makes the held mote and the resting one a single maximal group",
  );
  assertEqual(
    heldBy(snapshot, arm, SPOKE),
    first,
    "a grip persists across cycles until dropped, and binding drops nothing",
  );
});
