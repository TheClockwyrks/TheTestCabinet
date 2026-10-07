// sigils/wane-ignores-other-types — a `wane` leaves a mote of any type but an
// essence exactly as it is.
//
// THE RULE. "An essence mote on the seat becomes `dust`" (`specs/sigils.md`,
// Transmuting sigils), and "a sigil whose condition does not hold at a boundary
// waits" (`specs/sigils.md`). The condition names the four essences and no other
// type, so the eleven remaining types of `specs/field.md`'s roster — `dust`,
// `mercury`, the six planets, `umbra`, `lumen` and `aether` — leave the seat's
// mote untouched. The eleven are derived here from `MOTES` minus `ESSENCES`
// rather than listed, so the sweep is the specification's own roster.
//
// THE CONFIGURATION. Eleven `wane` sigils along `r = 0`, one on each hex from
// `(-5, 0)` to `(5, 0)`, which is the whole of that row and eleven pairwise
// disjoint single-hex footprints. One mote of each non-essence type rests on one
// seat, in `MOTES` order.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// twelfth `wane` on `(0, 2)`, with a `nova` on its seat, which the same boundary
// must dim to `dust`. It is a sigil of its own on a hex of its own and decides
// nothing about the eleven; it is read back only to say that `wane` acted at this
// boundary at all.
//
// THE VERDICT. After one cycle each of the eleven motes still carries the type it
// was spawned with and is still resting on its seat, while the control's `nova`
// is `dust`.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, every part
// is a sigil, and a sigil carries no tape — so nothing moves and the only change
// across the boundary is the sigil phase's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ESSENCES, MOTES, type MoteName } from "../constants";
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

/** Every type `wane`'s condition does not name: the roster less the essences. */
const OTHERS: readonly MoteName[] = MOTES.filter(
  (type) => !(ESSENCES as readonly MoteName[]).includes(type),
);

/** One seat each, filling the row `r = 0` from `(-5, 0)` to `(5, 0)`. */
const SEATS: readonly Hex[] = OTHERS.map((_, index) => at(-5 + index, 0));

/** The control's seat, clear of the row and of every other footprint. */
const CONTROL_SEAT: Hex = at(0, 2);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves dust, mercury, every planet, umbra, lumen and aether on the seat as they are", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      ...SEATS.map((seat) => sigilPart("wane", seat.q, seat.r, 0)),
      sigilPart("wane", CONTROL_SEAT.q, CONTROL_SEAT.r, 0),
    ]),
  });

  const seated: number[] = [];
  for (const [index, type] of OTHERS.entries()) {
    seated.push(await spawnMote(h, SEATS[index] as Hex, type));
  }
  const control = await spawnMote(h, CONTROL_SEAT, "nova");

  await advanceCycles(h, 1);
  await captureStill(h, "untouched");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteById(after, control)?.type,
    "dust",
    "the control's nova was dimmed, so wane really did act at this boundary",
  );

  for (const [index, type] of OTHERS.entries()) {
    const seat = SEATS[index] as Hex;
    const mote = moteById(after, seated[index] as number);
    assertNotNull(mote, `the ${type} on its seat is still a mote`);
    assertEqual(
      mote?.type,
      type,
      `a ${type} on the seat is not an essence, so wane leaves it as it is`,
    );
    assertEqual(
      `${mote?.q},${mote?.r}`,
      `${seat.q},${seat.r}`,
      `and the ${type} is still resting on the seat it was on`,
    );
  }
  assertLength(
    looseMotes(after),
    OTHERS.length + 1,
    "every mote spawned is still on the field: a waiting wane takes none away",
  );
});
