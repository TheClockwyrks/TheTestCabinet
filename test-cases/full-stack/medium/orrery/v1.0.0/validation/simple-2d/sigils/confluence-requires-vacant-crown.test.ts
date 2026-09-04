// sigils/confluence-requires-vacant-crown — a mote or a fixture on the crown,
// which is the sigil's anchor hex, blocks the confluence.
//
// THE RULE. "When the four founts hold unbonded, unheld motes comprising one of
// each essence, in any arrangement, and THE CROWN IS VACANT, all four are
// consumed and one `aether` appears on the crown" (`specs/sigils.md`,
// `confluence`), where the term is defined at the top of the same page —
// "vacant: the hex holds neither a mote nor a fixture" — and the one exception
// is fenced off: "A fixture satisfies one condition only, the `mirror` source
// below." The crown is `(0, 0)` in the footprint table, which is the anchor
// itself. "A sigil whose condition does not hold at a boundary waits", so none
// of the four essences is consumed.
//
// THE CONFIGURATION, twice, on one `confluence` anchored on the middle of the
// field at rotation `0`. Both times one of each essence rests on the four
// founts, unbonded and unheld, so the founts alone would fuse.
//
//   * First a `dust` rests on the crown. `dust` is no essence and no business of
//     the one sigil on the field; what it does is occupy the anchor hex.
//   * Then the field is emptied and a wheel's FIXTURE rests on the crown. "A
//     `wheel` is a hub on its anchor hex carrying six fixture motes, one on each
//     adjacent hex" (`specs/parts.md`) and a wheel placed into a live run raises
//     its ring (`specs/instrumentation.md`), so the hub goes on one of the two
//     neighbors of the crown that the footprint does NOT name — leaving all four
//     founts free — and the other five fixtures come off with `removeMote`, the
//     gate the specification names for a wheel's fixtures. Its tape is empty,
//     "which every part rests on", so nothing turns.
//
// THE VERDICT, at each boundary. Every fount still holds the essence it was
// posed with, the occupant is still the thing on the crown, and no `aether` is
// anywhere on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ESSENCES } from "../constants";
import { at, neighbors, place, sameHex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { sigilHexes } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteAt,
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

it("waits while a mote or a fixture rests on the crown", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const crown = place(at(0, 0), anchor, rotation);
  const founts = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].map((hex) =>
    place(hex, anchor, rotation),
  );
  const footprint = sigilHexes("confluence", anchor, rotation);
  const offFootprint = neighbors(anchor).filter(
    (hex) => !footprint.some((own) => sameHex(own, hex)),
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("confluence", anchor.q, anchor.r, rotation)]),
  });

  // Scenario one: a MOTE on the crown.
  const spawned: number[] = [];
  for (const [index, hex] of founts.entries()) {
    spawned.push(await spawnMote(h, hex, ESSENCES[index]));
  }
  const blocker = await spawnMote(h, crown, "dust");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, crown)?.id,
    blocker,
    "a mote rests on the crown, so the crown is not vacant",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "blocked-crown");

  const blocked = await h.snapshot();
  assertEqual(
    blocked.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(
    blocked.sim?.cycle,
    1,
    "one whole cycle ran, so a boundary passed",
  );
  for (const [index, hex] of founts.entries()) {
    assertEqual(
      moteAt(blocked, hex)?.id,
      spawned[index],
      `the essence on the fount at (${hex.q}, ${hex.r}) was not consumed`,
    );
    assertEqual(
      moteAt(blocked, hex)?.type,
      ESSENCES[index],
      "and is still the essence it was posed with",
    );
  }
  assertEqual(
    moteAt(blocked, crown)?.id,
    blocker,
    "the mote on the crown is the one that was there, unreplaced",
  );
  assertEqual(
    moteAt(blocked, crown)?.type,
    "dust",
    "and is still dust, so no aether was written over it",
  );
  assertEqual(
    looseMotes(blocked).length,
    5,
    "five motes went into the boundary and five came out",
  );

  // Scenario two: a FIXTURE on the crown.
  await h.debug.clearMotes();
  const hub = offFootprint[0];
  const wheel = await placePart(h, "wheel", hub, 0);
  const raised = await h.snapshot();
  for (const fixture of fixturesOf(raised, wheel)) {
    if (fixture.q !== crown.q || fixture.r !== crown.r) {
      await h.debug.removeMote(fixture.id);
    }
  }
  const again: number[] = [];
  for (const [index, hex] of founts.entries()) {
    again.push(await spawnMote(h, hex, ESSENCES[index]));
  }

  const ringed = await h.snapshot();
  assertNotNull(
    moteAt(ringed, crown),
    "the wheel put one of its six fixtures on the crown",
  );
  assertEqual(
    moteAt(ringed, crown)?.wheel,
    wheel,
    "the thing on the crown is that wheel's fixture rather than a loose mote",
  );
  assertEqual(
    fixturesOf(ringed, wheel).length,
    1,
    "the rest of the ring came off, so the crown's fixture stands alone",
  );

  await advanceCycles(h, 1);

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the second boundary is not a fault either",
  );
  for (const [index, hex] of founts.entries()) {
    assertEqual(
      moteAt(after, hex)?.id,
      again[index],
      `the essence on the fount at (${hex.q}, ${hex.r}) was not consumed`,
    );
    assertEqual(
      moteAt(after, hex)?.type,
      ESSENCES[index],
      "and is still the essence it was posed with",
    );
  }
  assertEqual(
    moteAt(after, crown)?.wheel,
    wheel,
    "the fixture is still the thing on the crown",
  );
  assertEqual(
    looseMotes(after).length,
    4,
    "the four essences are the whole of the loose motes: no aether was made",
  );
});
