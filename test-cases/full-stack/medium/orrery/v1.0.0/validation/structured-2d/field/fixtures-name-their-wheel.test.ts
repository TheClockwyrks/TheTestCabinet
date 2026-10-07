// field/fixtures-name-their-wheel — a fixture names the wheel carrying it.
//
// THE RULE. "A fixture is one of the six motes a zodiac wheel carries"
// (`specs/field.md`, Motes), and a `wheel` "is a hub on its anchor hex carrying
// six fixture motes, one on each adjacent hex" (`specs/parts.md`). The snapshot
// carries the relation on the mote itself: "`wheel`: `<number | null>`", "the
// wheel a fixture belongs to; `null` on every real mote"
// (`specs/instrumentation.md`, Snapshot shape).
//
// WHY THE FIELD IS LOAD-BEARING. A fixture is a mote for the collision rule —
// "every pair is checked, fixtures included" (`specs/simulation.md`) — and is NOT
// a mote for several others: "a gripper over a fixture or over nothing closes on
// nothing", `setGrip` on "a fixture ... throws", `linkMotes` refuses "a fixture at
// either end", and `specs/sigils.md` states how a sigil reads a hex a fixture
// rests on. Every one of those rules needs the two told apart, and the snapshot's
// `wheel` field is where a scenario tells them apart.
//
// THE CONFIGURATION. A wheel placed into a LIVE run, which is what raises its
// ring: "while a run is live, a part one of them adds enters the run at its rest
// pose holding nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). Beside it, out of the wheel's reach, one loose
// mote spawned with `spawnMote`, which "adds one unbonded, unheld mote".
//
// THE VERDICT is read in both directions, because either alone is passable: the
// six on the wheel's spoke hexes each name that wheel's `id`, and the loose mote
// names `null` — and the two sets together are the whole field, so no mote is
// left unaccounted for either way.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field before the
// wheel goes down — `clearMotes` "removes every mote, fixtures included" — so the
// six fixtures and the one loose mote are the whole of the world. The wheel's
// tape is left blank, "which every part rests on", so the ring stands still.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { sameHex } from "../field";
import { wheelFixtureHexes } from "../parts";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteById,
  openBareRun,
  placePart,
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

it("reports each of a wheel's six fixtures under its id, and a loose mote under null", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const loose = await spawnMote(h, WEST, "dust");

  await h.advance(1);
  await captureStill(h, "wheel-ring");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    7,
    "the field holds the wheel's six fixtures and the one loose mote",
  );

  const ring = fixturesOf(snapshot, wheel);
  assertLength(
    ring,
    6,
    "a wheel carries six fixture motes, one on each adjacent hex",
  );
  const spokes = wheelFixtureHexes(ORIGIN);
  for (const hex of spokes) {
    const fixture = ring.find((mote) => sameHex(mote, hex)) ?? null;
    assertNotNull(
      fixture,
      `a fixture naming this wheel rests on its spoke hex (${hex.q}, ${hex.r})`,
    );
    assertEqual(
      fixture?.wheel,
      wheel,
      `(${hex.q}, ${hex.r}): the fixture names the wheel carrying it`,
    );
  }

  const bare = looseMotes(snapshot);
  assertLength(
    bare,
    1,
    "every mote that is not a fixture reports wheel null, and there is one such mote",
  );
  const spawned = moteById(snapshot, loose);
  assertNotNull(spawned, "the mote spawned with spawnMote is reported");
  assertEqual(
    spawned?.wheel,
    null,
    "a mote that is not a fixture belongs to no wheel",
  );
  assertTrue(
    spokes.every((hex) => !sameHex(hex, WEST)),
    "the loose mote rests clear of the wheel's six spoke hexes",
  );
});
