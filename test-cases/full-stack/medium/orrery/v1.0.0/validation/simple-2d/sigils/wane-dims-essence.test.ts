// sigils/wane-dims-essence — an essence resting on a `wane`'s seat becomes
// `dust` at the boundary, for every one of the four essences.
//
// THE RULE. `wane`'s footprint is one hex, `(0, 0)`, the seat, and "an essence
// mote on the seat becomes `dust`. Its filaments, its constellation, and any hold
// on it are untouched" (`specs/sigils.md`, Transmuting sigils). Which types are
// essences is `specs/field.md`'s: "`ESSENCES` holds `nebula`, `comet`, `nova`,
// `meteor` in that order". "Becomes" is a change of type on the mote that was
// there, not a mote taken away and another put back, so each is read back by the
// id it was spawned with.
//
// THE CONFIGURATION. Four `wane` sigils in one row, on `(-3, 0)`, `(-1, 0)`,
// `(1, 0)` and `(3, 0)` — single-hex footprints, pairwise disjoint, one hex of
// clear field between each pair — with one essence resting on each seat, in the
// order `ESSENCES` names them. The four are posed together because the
// requirement is about all four and because a `wane` reads its own seat and
// nothing else, so four seats decide four cases in one boundary. Nothing else is
// on the field, and nothing on it moves: every part is a sigil, and a sigil
// carries no tape.
//
// THE VERDICT. After one cycle every one of the four motes is `dust`, still
// resting on the seat it was spawned on, and the field carries exactly the four
// motes it started with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ESSENCES } from "../constants";
import { at, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** One seat per essence, two hexes apart along `r = 0`, all well inside the field. */
const SEATS: readonly Hex[] = ESSENCES.map((_, index) => at(-3 + 2 * index, 0));

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns each of nebula, comet, nova and meteor on its seat to dust", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      SEATS.map((seat) => sigilPart("wane", seat.q, seat.r, 0)),
    ),
  });

  const seated: number[] = [];
  for (const [index, essence] of ESSENCES.entries()) {
    seated.push(await spawnMote(h, SEATS[index] as Hex, essence));
  }

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "waned");

  for (const [index, essence] of ESSENCES.entries()) {
    assertEqual(
      moteById(before, seated[index] as number)?.type,
      essence,
      `the ${essence} starts resting on its wane's seat`,
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
    const seat = SEATS[index] as Hex;
    const mote = moteById(after, seated[index] as number);
    assertNotNull(mote, `the ${essence} that was on the seat is still a mote`);
    assertEqual(
      mote?.type,
      "dust",
      `an essence on the seat becomes dust: ${essence}`,
    );
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${seat.q},${seat.r}`,
      `and the dimmed ${essence} is still resting on the seat it was on`,
    );
  }
  assertLength(
    looseMotes(after),
    ESSENCES.length,
    "the four motes are still the whole of the field: waning takes none away and adds none",
  );
});
