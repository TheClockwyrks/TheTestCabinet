// sigils/mirror-copies-essence — with an essence on a `mirror`'s source and
// `dust` on its target, the target becomes that essence at the boundary.
//
// THE RULE. `mirror`'s footprint is `(0, 0)` source and `(1, 0)` target, and
// "when the source holds an essence and the target holds `dust`, the target
// becomes that essence" (`specs/sigils.md`, Transmuting sigils). "That essence"
// is the source's own type, so the four essences of `specs/field.md` —
// "`ESSENCES` holds `nebula`, `comet`, `nova`, `meteor` in that order" — each
// give a different answer on the target, and a build that turned every `dust` on
// a target into one fixed essence would satisfy only one of the four.
//
// THE CONFIGURATION. Four `mirror` sigils, two rows apart so no footprint of one
// touches another, anchored at `(-2, -3)`, `(-2, -1)`, `(-2, 1)` and `(-2, 3)` at
// rotation `0` — so each source is its anchor and each target the hex east of it.
// One essence rests on each source, in the order `ESSENCES` names them, and one
// `dust` rests on each target. Nothing else is on the field, and nothing on it
// moves: every part is a sigil, and a sigil carries no tape.
//
// THE VERDICT. After one cycle a mote is resting on each target hex carrying the
// essence that target's own source held, and the field still carries exactly the
// eight motes it started with.
//
// THE TARGET IS READ BY ITS HEX, NOT BY A MOTE ID. What the specification fixes
// is what is on the target afterwards: "the target becomes that essence". It does
// not say whether that is the same mote with a new type or a fresh one — and the
// sigils that DO put a new mote down say so in their own words, as `dispersion`'s
// "the four essences appear" does. Reading the hex, with the mote count read back
// beside it, decides the requirement without deciding that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ESSENCES } from "../constants";
import { at, neighbor, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** One mirror per essence, two rows apart, all comfortably inside the field. */
const SOURCES: readonly Hex[] = ESSENCES.map((_, index) =>
  at(-2, -3 + 2 * index),
);

/** At rotation 0 the target is the hex east of the source: `DIRS[0]`. */
const TARGETS: readonly Hex[] = SOURCES.map((source) => neighbor(source, 0));

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the dust on each target into the essence its own source holds", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      SOURCES.map((source) => sigilPart("mirror", source.q, source.r, 0)),
    ),
  });

  const sourced: number[] = [];
  const targeted: number[] = [];
  for (const [index, essence] of ESSENCES.entries()) {
    sourced.push(await spawnMote(h, SOURCES[index] as Hex, essence));
    targeted.push(await spawnMote(h, TARGETS[index] as Hex, "dust"));
  }

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "mirrored");

  for (const [index, essence] of ESSENCES.entries()) {
    assertEqual(
      moteById(before, sourced[index] as number)?.type,
      essence,
      `the ${essence} starts on its mirror's source hex`,
    );
    assertEqual(
      moteById(before, targeted[index] as number)?.type,
      "dust",
      `and dust starts on the target beside it, for ${essence}`,
    );
  }

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "and the boundary really ran");

  for (const [index, essence] of ESSENCES.entries()) {
    const copy = moteAt(after, TARGETS[index] as Hex);
    assertNotNull(
      copy,
      `a mote is still resting on the target hex, for ${essence}`,
    );
    assertEqual(
      copy?.type,
      essence,
      `the target holding dust becomes the essence its source holds: ${essence}`,
    );
  }
  assertLength(
    looseMotes(after),
    ESSENCES.length * 2,
    "the eight motes are still the whole of the field: copying adds no mote and takes none away",
  );
});
