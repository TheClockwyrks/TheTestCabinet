// sigils/conjoin-requires-vacant-crown — a crown holding a mote blocks the
// conjoin, and neither fount is consumed.
//
// THE RULE. "When both founts hold unbonded, unheld motes of the same planet
// below `sol` and THE CROWN IS VACANT, both are consumed and one mote of the
// next rung appears on the crown" (`specs/sigils.md`, `conjoin`), where "vacant:
// the hex holds neither a mote nor a fixture". A crown holding a mote is
// therefore not vacant, and "A sigil whose condition does not hold at a boundary
// waits" — so the effect does not run at all, and the founts are untouched
// rather than half consumed.
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`. A `mars` on each fount — the same planet, below `sol`, unbonded
// and unheld as `spawnMote` leaves a mote — so every condition but one holds.
// The one that fails is the crown at `(0, 1)`, where a `dust` rests. `dust` is
// no sigil's business here: the only sigil on the field is the `conjoin`, and
// the field holds nothing else.
//
// THE VERDICT, read at the boundary of one cycle. Both `mars` are still on their
// founts, still `mars`; the `dust` is still the mote on the crown, by id, so
// nothing overwrote it; and the field still holds three motes, so neither fount
// was consumed and nothing appeared anywhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
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

it("waits while a mote rests on the crown", async () => {
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
  const blocker = await spawnMote(h, crown, "dust");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "mars",
    "one mars is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "mars",
    "the other mars is on the second fount, so the founts satisfy the rule",
  );
  assertEqual(
    moteAt(posed, crown)?.id,
    blocker,
    "a mote rests on the crown, so the crown is not vacant",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "blocked-crown");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(
    moteAt(after, first)?.id,
    west,
    "the mars on the first fount was not consumed",
  );
  assertEqual(moteAt(after, first)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the mars on the second fount was not consumed",
  );
  assertEqual(moteAt(after, second)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, crown)?.id,
    blocker,
    "the mote on the crown is the one that was there, unreplaced",
  );
  assertEqual(
    moteAt(after, crown)?.type,
    "dust",
    "and is still dust, so no risen planet was written over it",
  );
  assertEqual(
    looseMotes(after).length,
    3,
    "three motes went into the boundary and three came out",
  );
});
