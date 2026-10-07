// sigils/acts-at-every-boundary — a sigil is not a one-shot: it acts at each
// boundary its condition holds at.
//
// THE RULE. "A sigil is engraved on the field at a fixed pose and acts at each
// boundary, the settle included, in the sigil phase `specs/simulation.md` defines,
// on the motes resting on its hexes" (`specs/sigils.md`). `specs/simulation.md`
// says the same from the cycle's side: step 5 of every cycle is "Boundary. Motes
// are at rest on hex centers again. The boundary sequence runs: the sigil phase,
// then sets, then rises, then the area bank, then the completion check."
//
// THE CONFIGURATION. One `void` engraved on `(0, 0)`, whose maw is `(0, 0)` and
// whose rim is "all six neighbors of `(0, 0)`" — "An unbonded, unheld mote on the
// maw is consumed" (`specs/sigils.md`). A fresh `dust` is spawned on the maw
// before each of three successive cycles, each of them unbonded and unheld:
// `spawnMote` "Adds one unbonded, unheld mote" (`specs/instrumentation.md`), and
// no filament is laid and no gripper is posed, so the condition holds at each of
// the three boundaries. Nothing else is placed and nothing else is on the field.
//
// WHY THE VOID. Its effect is the one that cannot be mistaken for a mote that
// simply stayed put: the mote is either on the field after the boundary or it is
// not. So "acted three times" reads as three consumptions rather than as three
// readings of one changed value.
//
// THE VERDICT. After each of the three cycles the mote spawned before it is gone
// and the field is empty, and the run is still running with no fault, on cycle
// `1`, `2` and `3` in turn. A build whose sigils act once per run leaves the
// second and the third mote resting on the maw.
//
// WHAT A BUILD THAT ALREADY FAILED IS FED. A mote left standing on the maw is
// still the unbonded, unheld mote the next boundary must consume, and a second
// one cannot be added beside it: of `spawnMote`, "A hex already holding a mote
// throws". So a boundary that finds the maw taken feeds that mote on rather than
// spawning, and every one of the three boundaries is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The maw of the `void` under test, at rotation `0`: the hex that consumes. */
const MAW = at(0, 0);

/** How many successive boundaries the sigil is asked to act at. */
const BOUNDARIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes a fresh mote at each of three successive boundaries", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("void", MAW.q, MAW.r, 0)]),
  });

  /** The mote fed to the maw before each boundary, and the state it left. */
  const fed: number[] = [];
  const after: OrrerySnapshot[] = [];

  await captureReplay(h, "three", async () => {
    for (let boundary = 0; boundary < BOUNDARIES; boundary += 1) {
      // A boundary that did not consume leaves its mote resting on the maw, and
      // of `spawnMote` the spec says "A hex already holding a mote throws"
      // (`specs/instrumentation.md`). That mote is still an unbonded, unheld
      // mote on the maw — nothing on the field bonds it or takes hold of it — so
      // it is what this boundary feeds, and this boundary is asked to consume it
      // just as the last one was. What the build failed to do is then read
      // below, where it names itself, rather than thrown out of the arrangement,
      // where it names nothing.
      const standing = moteAt(await h.snapshot(), MAW)?.id ?? null;
      fed.push(standing ?? (await spawnMote(h, MAW, "dust")));
      await advanceCycles(h, 1);
      after.push(await h.snapshot());
    }
  });

  assertNotNull(
    solePartOfKind(await h.snapshot(), "void"),
    "the machine carries the one void the check placed",
  );
  assertLength(after, BOUNDARIES, "three boundaries were driven and read");

  for (const [boundary, snapshot] of after.entries()) {
    const sim = snapshot.sim;
    assertNotNull(sim, `boundary ${boundary}: the run is still live`);
    assertEqual(
      sim?.status,
      "running",
      `boundary ${boundary}: consuming a mote halts nothing`,
    );
    assertNull(sim?.fault ?? null, `boundary ${boundary}: no fault is raised`);
    assertEqual(
      sim?.cycle,
      boundary + 1,
      `boundary ${boundary}: one cycle of game time completed one more cycle`,
    );
    assertNull(
      moteById(snapshot, fed[boundary] ?? -1),
      `boundary ${boundary}: the unbonded, unheld mote on the maw was consumed at THIS boundary rather than once per run`,
    );
    assertLength(
      sim?.motes ?? [],
      0,
      `boundary ${boundary}: the field is empty again, so the next mote is the only one on it`,
    );
  }
});
