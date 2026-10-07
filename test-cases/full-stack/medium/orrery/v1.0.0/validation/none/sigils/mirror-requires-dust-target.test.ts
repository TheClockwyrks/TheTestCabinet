// sigils/mirror-requires-dust-target — a `mirror` whose target holds anything but
// `dust` leaves that target as it is.
//
// THE RULE. "When the source holds an essence and the target holds `dust`, the
// target becomes that essence" (`specs/sigils.md`, Transmuting sigils), and "a
// sigil whose condition does not hold at a boundary waits" (`specs/sigils.md`).
// The target condition names one type. Every other type of `specs/field.md`'s
// roster of fifteen fails it — the essences and the planets the item calls out
// among them — so the sweep below is `MOTES` less `dust`, taken from the
// specification's own roster rather than listed by hand.
//
// THE CONFIGURATION. Fourteen `mirror` sigils, one per non-`dust` type, laid out
// as pairwise disjoint footprints across four rows of the field, each at rotation
// `0` so its source is its anchor and its target the hex east of it. Every source
// holds an ESSENCE, so the source half of the condition is satisfied in all
// fourteen and the target is the only thing under test. The source is `nebula`,
// except where the target is itself `nebula` — there the source is `comet`, so
// that "left as it is" and "became the source's essence" name different types and
// the case can be decided at all.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// fifteenth `mirror`, with `nebula` on its source and `dust` on its target, which
// the same boundary must copy onto. It is a sigil of its own on hexes of its own
// and decides nothing about the fourteen; it is read back only to say that
// `mirror` acted at this boundary at all.
//
// THE VERDICT. After one cycle each of the fourteen targets still carries the
// type it was spawned with, each source still carries its essence, and the
// control's target is `nebula`.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, every part
// is a sigil, and a sigil carries no tape — so nothing moves and the only change
// across the boundary is the sigil phase's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { MOTES, type MoteName } from "../constants";
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

/** Every type the target condition does not name: the roster less `dust`. */
const NOT_DUST: readonly MoteName[] = MOTES.filter((type) => type !== "dust");

/**
 * Fifteen anchors — one per case, plus the control — whose footprints are
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
  at(-5, 2),
  at(-3, 2),
  at(-1, 2),
];

/** The essence put on a source, chosen so it differs from the target's type. */
function sourceFor(target: MoteName): MoteName {
  return target === "nebula" ? "comet" : "nebula";
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a target holding any type but dust exactly as it is", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor) => sigilPart("mirror", anchor.q, anchor.r, 0)),
    ),
  });

  const sourced: number[] = [];
  const targeted: number[] = [];
  for (const [index, type] of NOT_DUST.entries()) {
    const anchor = ANCHORS[index] as Hex;
    sourced.push(await spawnMote(h, anchor, sourceFor(type)));
    targeted.push(await spawnMote(h, neighbor(anchor, 0), type));
  }
  const controlAnchor = ANCHORS[NOT_DUST.length] as Hex;
  await spawnMote(h, controlAnchor, "nebula");
  await spawnMote(h, neighbor(controlAnchor, 0), "dust");

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-target");

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

  for (const [index, type] of NOT_DUST.entries()) {
    const anchor = ANCHORS[index] as Hex;
    const target = neighbor(anchor, 0);
    const held = moteById(after, targeted[index] as number);
    assertNotNull(held, `the ${type} on its mirror's target is still a mote`);
    assertEqual(
      held?.type,
      type,
      `a target holding ${type} is not dust, so the mirror leaves it as it is`,
    );
    assertEqual(
      `${held?.q},${held?.r}`,
      `${target.q},${target.r}`,
      `and the ${type} is still resting on the target hex`,
    );
    assertEqual(
      moteById(after, sourced[index] as number)?.type,
      sourceFor(type),
      `while the source beside it still holds its essence, for the ${type} case`,
    );
  }
});
