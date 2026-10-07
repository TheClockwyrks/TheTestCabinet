// runs/boundary-runs-once-per-completed-cycle — the boundary sequence is a
// consequence of a CYCLE COMPLETING, not of a frame passing, so ten frames that
// together cover one cycle run it once, and at the end.
//
// THE RULE. A cycle's fifth step is "Boundary. Motes are at rest on hex centers
// again. The boundary sequence runs: the sigil phase, then sets, then rises, then
// the area bank, then the completion check" (`specs/simulation.md`, Cycles and the
// clock), and a completed cycle is what carries it: "A cycle completes when the
// accumulated fraction reaches `1`". Nothing there attaches the sequence to an
// update; an update does one thing, which is that it "advances the fraction by
// `SPEEDS[sim.speed] * dt` cycles".
//
// THE CONFIGURATION poses one member of each of the three phases the item names,
// far enough apart on the field that none can reach another, and gives each
// exactly one thing to do:
//
//   - THE SIGIL PHASE. An `ascend` at `(0, -3)`: "When the prime holds an unbonded,
//     unheld `mercury` and the crown holds a planet below `sol`, the `mercury` is
//     consumed and the planet rises one rung of `PLANETS`" (`specs/sigils.md`). A
//     `mercury` rests on its prime `(0, -3)` and a `luna` on its crown `(1, -3)`,
//     and `PLANETS` runs `saturn, jupiter, mars, venus, luna, sol`, so one action
//     leaves a `sol` on the crown and nothing on the prime.
//   - THE SETS. The set for the challenge's one product at `(3, 0)`, and the
//     product of `BARE` is one lone `sol`: "a constellation is accepted when it is
//     unheld and is exactly the placed pattern", and "An accepted constellation is
//     consumed whole, and the set's tally rises by `1`" (`specs/sigils.md`). A
//     `sol` rests on it.
//   - THE RISES. The rise for the challenge's one reagent at `(-3, 0)`: "When every
//     footprint hex is vacant, the reagent appears". Its hex is left bare, because
//     `openBareRun` empties the field after the settle.
//
// The machine holds no arm and no wheel, so nothing moves within the cycle and
// nothing can collide: what the ten frames do is pass time. The completion switch
// is held off, so the tally the set raises cannot end the run.
//
// THE VERDICT is read three times across the same ten frames, each `0.1` of a
// cycle at step `0`, where `SPEEDS[0]` is `1` cycle per second. After frame one,
// and again after frame nine — nine tenths of the way through cycle `0` — the
// `mercury` is still on the prime, the `luna` is still a `luna`, the tally is still
// `0`, and the rise's hex is still bare: no boundary has run. After frame ten,
// which is the one that carries the fraction to `1`, each of the three has acted
// exactly once. A build that ran the sequence on every update would have spent all
// three within its first frame, nine tenths of a cycle before the boundary that is
// supposed to spend them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE, PLANETS, SPEEDS } from "../constants";
import { at, translate } from "../field";
import { risePart, setPart, sigilPart, solution } from "../formats";
import { BARE, EAST, NORTH, WEST } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  spawnMote,
  tallyOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The step this check runs at: `SPEEDS[0]` is one cycle per second. */
const SLOWEST = 0;

/** How much of one cycle each of the ten frames covers. */
const TENTH = 0.1;

/** `ascend`'s two hexes at rotation `0`, placed at `NORTH`: prime, then crown. */
const PRIME = NORTH;
const CROWN = translate(NORTH, at(1, 0));

/** The rung the crown starts on, and the rung one action of `ascend` reaches. */
const BELOW = "luna";
const ABOVE = PLANETS[PLANETS.indexOf(BELOW) + 1] ?? "sol";

/** The lone mote `BARE`'s one reagent and its one product are both made of. */
const CARGO = "sol";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Read back that no boundary has run yet, at a moment part way through cycle 0. */
function assertUntouched(snapshot: OrrerySnapshot, when: string): void {
  assertEqual(
    moteAt(snapshot, PRIME)?.type,
    "mercury",
    `${when}: the sigil phase has not run, so ascend has consumed no mercury`,
  );
  assertEqual(
    moteAt(snapshot, CROWN)?.type,
    BELOW,
    `${when}: the sigil phase has not run, so the crown's planet has not risen`,
  );
  assertEqual(
    tallyOf(snapshot, 0),
    0,
    `${when}: the sets have not run, so no constellation has been accepted`,
  );
  assertNull(
    moteAt(snapshot, WEST),
    `${when}: the rises have not run, so the rise's hex is still bare`,
  );
}

it("leaves the sigil phase, the sets and the rises unspent until the tenth frame", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      risePart(0, WEST.q, WEST.r),
      setPart(0, EAST.q, EAST.r),
      sigilPart("ascend", PRIME.q, PRIME.r),
    ]),
    speed: SLOWEST,
  });
  await spawnMote(h, PRIME, "mercury");
  await spawnMote(h, CROWN, BELOW);
  await spawnMote(h, EAST, CARGO);

  const posed = await h.snapshot();
  assertNotNull(
    posed.sim,
    "startRun leaves a live run for the ten frames to cover",
  );
  assertEqual(
    posed.sim?.speed,
    SLOWEST,
    `the run is set to step ${SLOWEST}, where SPEEDS[${SLOWEST}] is ${SPEEDS[SLOWEST]} cycle per second`,
  );
  assertUntouched(posed, "before any frame");

  const [early, late, closed] = await captureReplay(h, "single", async () => {
    await advanceFraction(h, TENTH);
    const first = await h.snapshot();
    await advanceFraction(h, 8 * TENTH, 8);
    const ninth = await h.snapshot();
    await advanceFraction(h, TENTH);
    return [first, ninth, await h.snapshot()] as const;
  });

  assertNear(
    early.sim?.fraction ?? -1,
    TENTH,
    FRACTION_TOLERANCE,
    "the first frame covers a tenth of cycle 0",
  );
  assertUntouched(early, "after one of the ten frames");

  assertNear(
    late.sim?.fraction ?? -1,
    9 * TENTH,
    FRACTION_TOLERANCE,
    "nine of the ten frames cover nine tenths of cycle 0",
  );
  assertUntouched(late, "after nine of the ten frames");

  assertEqual(
    closed.sim?.cycle,
    1,
    "the ten frames together cover exactly one cycle, so cycle 0 completed on the tenth",
  );
  assertNull(
    moteAt(closed, PRIME),
    "the sigil phase ran: ascend consumed the mercury on its prime",
  );
  assertEqual(
    moteAt(closed, CROWN)?.type,
    ABOVE,
    `the sigil phase ran once: the crown's ${BELOW} rose one rung of PLANETS, to ${ABOVE}`,
  );
  assertEqual(
    tallyOf(closed, 0),
    1,
    "the sets ran once: the set accepted the one constellation on it, raising its tally by 1",
  );
  assertNull(
    moteAt(closed, EAST),
    "the set consumed the accepted constellation whole",
  );
  assertEqual(
    moteAt(closed, WEST)?.type,
    CARGO,
    "the rises ran: the rise's footprint was vacant, so the reagent appeared on it",
  );
});
