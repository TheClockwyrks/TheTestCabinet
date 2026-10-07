// sigils/mirror-requires-essence-source — a `mirror` whose source holds a mote
// that is not an essence changes nothing on its target.
//
// THE RULE. "When the source holds an essence and the target holds `dust`, the
// target becomes that essence" (`specs/sigils.md`, Transmuting sigils), and "a
// sigil whose condition does not hold at a boundary waits" (`specs/sigils.md`).
// Which types are essences is `specs/field.md`'s: "`ESSENCES` holds `nebula`,
// `comet`, `nova`, `meteor` in that order". So the eleven remaining types of the
// roster — `dust`, `mercury`, the six planets, `umbra`, `lumen` and `aether` —
// each fail the source condition, and the sweep below is `MOTES` less `ESSENCES`,
// taken from the specification's own rosters rather than listed by hand.
//
// THE CONFIGURATION. Eleven `mirror` sigils, one per non-essence type, laid out
// as pairwise disjoint footprints across three rows of the field, each at
// rotation `0` so its source is its anchor and its target the hex east of it. One
// non-essence rests on each source, and `dust` on every target — so the TARGET
// half of the condition is satisfied in all eleven and the source is the only
// thing under test.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// twelfth `mirror`, with `nebula` on its source and `dust` on its target, which
// the same boundary must copy onto. It is a sigil of its own on hexes of its own
// and decides nothing about the eleven; it is read back only to say that `mirror`
// acted at this boundary at all.
//
// THE VERDICT. After one cycle every one of the eleven targets is still `dust`,
// each source still carries the type it was spawned with, and the control's
// target is `nebula`.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, every part
// is a sigil, and a sigil carries no tape — so nothing moves and the only change
// across the boundary is the sigil phase's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ESSENCES, MOTES, type MoteName } from "../constants";
import { at, neighbor, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** Every type the source condition does not name: the roster less the essences. */
const NOT_ESSENCES: readonly MoteName[] = MOTES.filter(
  (type) => !(ESSENCES as readonly MoteName[]).includes(type),
);

/**
 * Twelve anchors — one per case, plus the control — whose footprints are
 * pairwise disjoint: each takes its anchor and the hex east of it, and the rows
 * are two apart so no two footprints can meet.
 */
const ANCHORS: readonly Hex[] = [
  at(-1, -4),
  at(1, -4),
  at(3, -4),
  at(-3, -2),
  at(-1, -2),
  at(1, -2),
  at(3, -2),
  at(-5, 0),
  at(-3, 0),
  at(-1, 0),
  at(1, 0),
  at(3, 0),
];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("copies nothing onto the target when the source holds anything but an essence", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor) => sigilPart("mirror", anchor.q, anchor.r, 0)),
    ),
  });

  const sourced: number[] = [];
  const targeted: number[] = [];
  for (const [index, type] of NOT_ESSENCES.entries()) {
    const anchor = ANCHORS[index] as Hex;
    sourced.push(await spawnMote(h, anchor, type));
    targeted.push(await spawnMote(h, neighbor(anchor, 0), "dust"));
  }
  const controlAnchor = ANCHORS[NOT_ESSENCES.length] as Hex;
  await spawnMote(h, controlAnchor, "nebula");
  await spawnMote(h, neighbor(controlAnchor, 0), "dust");

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-source");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, neighbor(controlAnchor, 0))?.type,
    "nebula",
    "the control's dust target took its source's essence, so mirror really did act at this boundary",
  );

  for (const [index, type] of NOT_ESSENCES.entries()) {
    const anchor = ANCHORS[index] as Hex;
    const target = neighbor(anchor, 0);
    const held = moteById(after, targeted[index] as number);
    assertNotNull(
      held,
      `the dust on the ${type} source's target is still a mote`,
    );
    assertEqual(
      held?.type,
      "dust",
      `a source holding ${type} is not an essence, so nothing changes on the target`,
    );
    assertEqual(
      `${held?.q},${held?.r}`,
      `${target.q},${target.r}`,
      `and that dust is still resting on the target hex, for the ${type} case`,
    );
    assertEqual(
      moteById(after, sourced[index] as number)?.type,
      type,
      `while the ${type} on the source is itself untouched`,
    );
  }
});
