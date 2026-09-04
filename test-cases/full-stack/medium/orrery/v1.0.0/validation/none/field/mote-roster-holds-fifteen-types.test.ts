// field/mote-roster-holds-fifteen-types — all fifteen mote types exist.
//
// THE RULE. "`MOTES` names the fifteen types" (`specs/field.md`, Motes), and the
// table that follows names them: `dust`, `nebula`, `comet`, `nova`, `meteor`,
// `mercury`, `saturn`, `jupiter`, `mars`, `venus`, `luna`, `sol`, `umbra`,
// `lumen`, `aether`. The roster is what everything else in the game is written
// over — `ESSENCES` and `PLANETS` are subsets of it, every sigil of
// `specs/sigils.md` transmutes between its members, and a molecule pattern names
// one per mote — so a build short of a type has a hole nothing else can fill.
//
// WHAT IS READ. `spawnMote(q, r, type)` "adds one unbonded, unheld mote of
// `type`, a name from `MOTES` in `specs/field.md`, resting on `(q, r)` with a
// fresh `id`" (`specs/instrumentation.md`), and the snapshot reports each mote's
// `type` back. So each of the fifteen is asked for by name, at rest on a hex of
// its own, and read back under that same name — a build that quietly folded two
// types together, or normalized an unfamiliar one onto `dust`, reports the wrong
// name for one of them.
//
// THE CONFIGURATION. Fifteen distinct field hexes, one mote apiece. "At most one
// mote occupies a hex" (`specs/field.md`), so they go on fifteen different hexes;
// nothing on the field moves, because the machine is empty, so no motion step and
// no collision check runs at all.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so the fifteen motes are the whole of the world and the count comes
// back exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { MOTES } from "../constants";
import { fieldHexes, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
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

it("reports one mote of each of the fifteen MOTES names under its own type", async () => {
  assertLength(MOTES, 15, "MOTES names fifteen types");

  await openBareRun(h, { challenge: BARE });

  const hexes = fieldHexes().slice(0, MOTES.length);
  const ids: number[] = [];
  for (const [i, type] of MOTES.entries()) {
    ids.push(await spawnMote(h, hexes[i] as Hex, type));
  }

  await h.advance(1);
  await captureStill(h, "roster");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    MOTES.length,
    "the field holds one mote per type and nothing else",
  );

  for (const [i, type] of MOTES.entries()) {
    const hex = hexes[i] as Hex;
    const where = `${type} on (${hex.q}, ${hex.r})`;
    const mote = moteById(snapshot, ids[i] as number);
    assertNotNull(mote, `${where}: the mote spawned is reported in sim.motes`);
    assertEqual(mote?.type, type, `${where}: reported back under its own type`);
    assertEqual(
      mote?.q,
      hex.q,
      `${where}: resting on the hex it was spawned on, q`,
    );
    assertEqual(
      mote?.r,
      hex.r,
      `${where}: resting on the hex it was spawned on, r`,
    );
    assertEqual(
      mote?.wheel,
      null,
      `${where}: spawned loose, so it belongs to no wheel`,
    );
  }
});
