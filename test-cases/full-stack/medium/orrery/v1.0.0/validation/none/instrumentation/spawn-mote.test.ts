// instrumentation/spawn-mote — `spawnMote` adds one resting mote, and it is a
// mote like any other.
//
// THE RULE. "`spawnMote(q, r, type)` | Adds one unbonded, unheld mote of `type`,
// a name from `MOTES` in `specs/field.md`, resting on `(q, r)` with a fresh `id`"
// (`specs/instrumentation.md`, The run). A fresh id is one of its own: "a mote's
// `id` is stable for the run and never reused" (`specs/state.md`). Where it is
// drawn: "`q` and `r` are the mote's hex at the last boundary", and `x`, `y` are
// "the drawn position at the current fraction", derived from "its hex, its
// motion, and `sim.fraction`, by the formulas of `specs/field.md`"
// (`specs/instrumentation.md`, Snapshot shape) — and "At rest a mote sits exactly
// on a hex center" (`specs/field.md`). And `wheel` "names the wheel a fixture
// belongs to and is `null` on every real mote" (`specs/state.md`).
//
// A POSED MOTE IS A MOTE. "A pose sets one thing, and the game's own editor
// rules, simulation, sigils, and completion test run from there exactly as they
// do in play" (`specs/instrumentation.md`), so this one is CARRIED — "A carried
// constellation moves as one rigid body" (`specs/simulation.md`) — TRANSMUTED —
// "An essence mote on the seat becomes `dust`" (`specs/sigils.md`, `wane`) — and
// CONSUMED — "An accepted constellation is consumed whole, and the set's tally
// rises by `1`" (`specs/sigils.md`, `set`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run on a challenge whose one product
// is a single `dust`, carrying an arm at the middle whose tape is `rotate-cw`,
// `rotate-cw`, `drop`, a `wane` engraved on `(0, 1)` and the set on `(-1, 1)`.
// One `nebula` is spawned on the arm's gripper hex and the gripper is closed on
// it with `setGrip`, "which takes hold with no `grab` ever running". A second
// mote is spawned far off and removed again, which is the whole of what it is
// for: two spawns, two ids. Nothing else is on the field, so nothing else can be
// carried, transmuted, or consumed.
//
// THE VERDICT. One mote, of the named type, on the named hex, drawn on that hex's
// center, joined to nothing and held by nothing, under an id the second spawn did
// not repeat. Then cycle `0` carries it to `(0, 1)` and the `wane` on that hex
// leaves it `dust`; cycles `1` and `2` carry it to the set's hex and drop it, and
// the boundary consumes it and raises the tally to `1`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter } from "../field";
import {
  armPart,
  challenge,
  loneMote,
  setPart,
  sigilPart,
  solution,
  type Challenge,
} from "../formats";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  pauseRun,
  resumeRun,
  spawnMote,
  takeGrip,
  tallyOf,
  type Harness,
} from "../harness";

/** One `dust` in, one `dust` out: what the set on this field accepts. */
const SPAWNED: Challenge = challenge({
  name: "Spawned",
  reagents: [loneMote("dust")],
  products: [loneMote("dust")],
  permitted: ["arm"],
});

/** The hex the mote is spawned on: the arm's gripper hex at its rest pose. */
const SPAWN_HEX = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds one resting mote that is carried, transmuted and consumed like any other", async () => {
  await openBareRun(h, {
    challenge: SPAWNED,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw", "rotate-cw", "drop"]),
      sigilPart("wane", 0, 1, 0),
      setPart(0, -1, 1, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const spawned = await spawnMote(h, SPAWN_HEX, "nebula");
  const posed = await h.snapshot();
  const second = await spawnMote(h, at(4, 0), "dust");
  await h.debug.removeMote(second);

  await pauseRun(h);
  await h.advance(1);
  await captureStill(h, "spawned");
  await resumeRun(h);

  await takeGrip(h, arm, 0, spawned);
  await advanceCycles(h, 1);
  const carried = await h.snapshot();
  await advanceCycles(h, 2);
  const consumed = await h.snapshot();

  assertNotNull(posed.sim, "the run is live at the spawn");
  assertLength(
    posed.sim?.motes ?? [],
    1,
    "one call adds one mote, and the field was empty before it",
  );
  const mote = moteById(posed, spawned);
  assertNotNull(mote, "the spawned mote is reported in sim.motes");
  assertEqual(mote?.type, "nebula", "the mote is of the type the call named");
  assertEqual(
    `${mote?.q},${mote?.r}`,
    `${SPAWN_HEX.q},${SPAWN_HEX.r}`,
    "the mote rests on the hex the call named",
  );
  assertEqual(
    mote?.wheel,
    null,
    "a spawned mote is a real mote, not a fixture",
  );
  assertCloseTo(
    mote?.x ?? Number.NaN,
    hexCenter(SPAWN_HEX).x,
    3,
    "a mote at rest is drawn exactly on its hex center, by the formulas of specs/field.md",
  );
  assertCloseTo(
    mote?.y ?? Number.NaN,
    hexCenter(SPAWN_HEX).y,
    3,
    "a mote at rest is drawn exactly on its hex center, by the formulas of specs/field.md",
  );
  assertLength(
    posed.sim?.filaments ?? [],
    0,
    "the spawned mote is unbonded: no filament touches it",
  );
  assertLength(
    posed.sim?.grips ?? [],
    0,
    "the spawned mote is unheld: no gripper holds it",
  );
  assertNotEqual(
    second,
    spawned,
    "each spawn takes a fresh id, and an id is never reused",
  );
  assertEqual(
    `${moteById(carried, spawned)?.q},${moteById(carried, spawned)?.r}`,
    "0,1",
    "the posed mote is carried by the arm that holds it, exactly as any other mote is",
  );
  assertEqual(
    moteById(carried, spawned)?.type,
    "dust",
    "the wane it was carried onto transmuted the essence, exactly as it would any other",
  );
  assertNull(
    moteById(consumed, spawned),
    "the set accepted and consumed it once it was dropped, exactly as it would any other",
  );
  assertEqual(
    tallyOf(consumed, 0),
    1,
    "the delivery raised the tally, so the mote was consumed as a product rather than lost",
  );
});
