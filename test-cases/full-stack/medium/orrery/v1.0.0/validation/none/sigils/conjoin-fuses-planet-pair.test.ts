// sigils/conjoin-fuses-planet-pair — two of one planet on the founts become one
// of the next rung on the crown.
//
// THE RULE. `conjoin`'s table gives its three hexes — `(0, 0)` fount, `(1, 0)`
// fount, `(0, 1)` crown — and its sentence fixes the whole effect: "When both
// founts hold unbonded, unheld motes of the same planet below `sol` and the
// crown is vacant, both are consumed and one mote of the next rung appears on
// the crown, unbonded and unheld" (`specs/sigils.md`). The rungs are `PLANETS`,
// "`saturn`, `jupiter`, `mars`, `venus`, `luna`, `sol` in that order"
// (`specs/field.md`).
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`, and one `mars` on each fount. `mars` is a planet below `sol`, so
// it has a next rung; both motes arrive through `spawnMote`, which "adds one
// unbonded, unheld mote", which is what the founts must hold. The crown is left
// empty, and the opener cleared the field, so the crown is vacant in the sense
// `specs/sigils.md` defines: "the hex holds neither a mote nor a fixture".
// Nothing else is on the field, so nothing else can consume or spawn anything.
//
// THE VERDICT, read at the boundary of one cycle, where the transmuting wave
// runs (`specs/simulation.md`, The sigil phase). Both fount motes are gone by
// id, the crown holds one mote of the rung above `mars`, that mote is joined to
// nothing and held by nothing, and it is the only mote on the field — so the
// pair was consumed rather than merely moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { PLANETS } from "../constants";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes both founts and leaves the next rung on the crown", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  const west = await spawnMote(h, first, "mars");
  const east = await spawnMote(h, second, "mars");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.id,
    west,
    "one mars is posed on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.id,
    east,
    "the other mars is posed on the second fount",
  );
  assertNull(moteAt(posed, crown), "the crown is vacant before the boundary");

  await advanceCycles(h, 1);
  await captureStill(h, "conjoined");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live at the boundary");
  assertEqual(
    after.sim?.status,
    "running",
    "a conjoin is not a fault: the cycle reached its boundary",
  );
  assertNull(moteById(after, west), "the first fount's mars was consumed");
  assertNull(moteById(after, east), "the second fount's mars was consumed");

  // The rung above mars, read off the ladder specs/field.md fixes rather than
  // written down here, so a build climbing a different ladder is what fails.
  const risen = PLANETS[PLANETS.indexOf("mars") + 1];
  const born = moteAt(after, crown);
  assertNotNull(born, "one mote appears on the crown");
  assertEqual(
    born?.type,
    risen,
    "the mote on the crown is one rung above the pair that made it",
  );
  assertEqual(
    constellationOf(after, born?.id ?? -1).length,
    1,
    "the new mote is unbonded: its constellation is itself alone",
  );
  assertEqual(
    (after.sim?.grips ?? []).filter((grip) => grip.mote === born?.id).length,
    0,
    "the new mote is unheld: no gripper holds it",
  );
  assertEqual(
    looseMotes(after).length,
    1,
    "two motes went in and one came out, so the pair was consumed",
  );
});
