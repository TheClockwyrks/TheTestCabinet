// sigils/bind-ignores-fixture — a wheel's fixture is not a mote a bind may join.
//
// THE RULE. `specs/sigils.md` opens its terms with the one exception it makes for
// fixtures: "A fixture satisfies one condition only, the `mirror` source below."
// `bind`'s condition is not that one — "When both hexes hold motes and no filament
// joins that pair, a filament of weight `1` is created between them" — so a
// fixture resting on one of a bind's hexes leaves that condition unsatisfied, and
// "A sigil whose condition does not hold at a boundary waits".
//
// THE CONFIGURATION. One `bind` engraved on `(0, 0)` at rotation `0`, so its hexes
// are `(0, 0)` and `(1, 0)`. One `wheel` anchored on `(-1, 0)`: "A `wheel` is a hub
// on its anchor hex carrying six fixture motes, one on each adjacent hex"
// (`specs/parts.md`), and a part added to a live run "enters the run at its rest
// pose holding nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). Its spoke `0` hex is `(-1, 0) + DIRS[0]` =
// `(0, 0)`, the bind's first hex, and at rotation `0` the fixture there is
// `WHEEL_MOTES[0]`, `nebula`.
//
// THE OTHER FIVE FIXTURES COME OFF. `specs/instrumentation.md` names the gate: a
// wheel's fixtures are held still by "`removeMote` on each fixture the scenario
// leaves out". So the ring is reduced to the one fixture the requirement is about,
// and no bystander is on the field to be bound in its place. One `dust` is then
// spawned on `(1, 0)`, the bind's second hex.
//
// The wheel's tape is empty and a `bind` has none, so nothing moves; the fixture
// and the mote rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No filament at all after the boundary. The fixture is still resting
// on the bind's first hex, still reported as this wheel's — "`wheel: <number |
// null>`", `null` on every real mote — and the `dust` is still resting on the
// second, so the pair really was there for a build that joins fixtures to join.

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
import { wheelFixture } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  fixturesOf,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The bind's `first` hex, placed: where the fixture rests. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The bind's `second` hex, placed: where the loose mote rests. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** Where the wheel's hub stands, so its spoke `0` hex is the bind's first hex. */
const HUB = at(-1, 0);

/** The spoke whose fixture is kept. */
const SPOKE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no filament between a fixture on one hex and a mote on the other", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("bind", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const wheel = await placePart(h, "wheel", HUB, 0);

  const raised = await h.snapshot();
  assertLength(
    fixturesOf(raised, wheel),
    6,
    "the wheel entered the run carrying its six fixtures",
  );
  const fixture = moteAt(raised, FIRST);
  assertNotNull(fixture, "a fixture rests on the bind's first hex");
  assertEqual(
    fixture?.type,
    wheelFixture(0, SPOKE),
    "the fixture on the wheel's spoke 0 hex is the WHEEL_MOTES entry for that spoke",
  );

  // The gate: every fixture but the one under test comes off the field.
  for (const spare of fixturesOf(raised, wheel)) {
    if (spare.id !== fixture?.id) await h.debug.removeMote(spare.id);
  }
  const loose = await spawnMote(h, SECOND, "dust");

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "bind"),
    "the machine carries the one bind the check placed",
  );
  assertLength(
    before.sim?.motes ?? [],
    2,
    "the field holds the one kept fixture and the one loose mote, and nothing else",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament is on the field before the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "fixture-bind");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "an unsatisfied bind waits, and waiting halts nothing",
  );
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertNull(
    filamentBetween(snapshot, fixture?.id ?? -1, loose),
    "a fixture satisfies no bind condition, so nothing joins it to the mote on the other hex",
  );
  assertLength(
    sim?.filaments ?? [],
    0,
    "the boundary created no filament at all",
  );
  const kept = moteById(snapshot, fixture?.id ?? -1);
  assertEqual(
    `${kept?.q},${kept?.r}`,
    `${FIRST.q},${FIRST.r}`,
    "the fixture is still resting on the bind's first hex",
  );
  assertEqual(
    kept?.wheel,
    wheel,
    "the mote on the first hex is still the wheel's fixture rather than a loose mote",
  );
  assertLength(
    looseMotes(snapshot),
    1,
    "the one loose mote on the field is the dust on the second hex",
  );
  assertEqual(
    `${moteById(snapshot, loose)?.q},${moteById(snapshot, loose)?.r}`,
    `${SECOND.q},${SECOND.r}`,
    "the loose mote is still resting on the bind's second hex",
  );
});
