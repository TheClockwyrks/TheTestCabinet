// sigils/ascend-requires-unheld-mercury — a `mercury` on the prime whose
// constellation a gripper holds is not spent, and the crown's planet does not
// rise.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils). "Unheld" is defined
// in the same file, for a mote at rest on a sigil hex: "no gripper holds any mote
// of the mote's constellation". A held `mercury` therefore fails the prime
// condition, and "a sigil whose condition does not hold at a boundary waits" —
// with no partial effect, so neither half of "consumed and rises" happens.
//
// THE CONFIGURATION. An arm at `(-1, 0)`, rotation `0`, length `1`, so its one
// gripper stands on `(0, 0)`. An `ascend` anchored at `(0, 0)` at rotation `0`,
// so its prime is that same hex and its crown is `(1, 0)`. A `mercury` on the
// prime and a `saturn` — the first rung, well below `sol` — on the crown, and the
// gripper given the `mercury` with `setGrip`, "which takes hold with no `grab`
// ever running" (`specs/instrumentation.md`). The arm's tape is empty, so it
// rests: "a blank cell is a rest on every part, a wheel included, and never
// faults" (`specs/simulation.md`). The hold is the ONE thing separating this
// world from one that would raise the planet.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// second `ascend`, well clear of the arm, with an UNHELD `mercury` on its prime
// and a `saturn` on its crown, which the same boundary must raise. It decides
// nothing about the held case; it is read back only to say that `ascend` acted at
// this boundary at all.
//
// THE VERDICT. After one cycle the held `mercury` is still there, still resting
// on the prime, still under the same gripper; the crown is still `saturn`; and
// the control's crown is `jupiter` with its `mercury` spent.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, neighbor } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteAt,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

/** The arm's base, and the gripper hex that is also the ascend's prime. */
const BASE = at(-1, 0);
const PRIME = neighbor(BASE, 0);
const CROWN = neighbor(PRIME, 0);

/** The control ascend, clear of the arm and of the first footprint. */
const CONTROL_PRIME = at(-4, 2);
const CONTROL_CROWN = neighbor(CONTROL_PRIME, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a held mercury standing and its crown's planet unrisen", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", BASE.q, BASE.r, 0, 1, []),
      sigilPart("ascend", PRIME.q, PRIME.r, 0),
      sigilPart("ascend", CONTROL_PRIME.q, CONTROL_PRIME.r, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const mercury = await spawnMote(h, PRIME, "mercury");
  const crown = await spawnMote(h, CROWN, "saturn");
  await takeGrip(h, arm, 0, mercury);

  const controlMercury = await spawnMote(h, CONTROL_PRIME, "mercury");
  await spawnMote(h, CONTROL_CROWN, "saturn");

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "held-mercury");

  assertEqual(
    heldBy(before, arm, 0),
    mercury,
    "a gripper holds the mercury on the prime, so it is not unheld",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the arm rests on its blank tape, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, CONTROL_CROWN)?.type,
    "jupiter",
    "the control's saturn rose over an unheld mercury, so ascend really did act at this boundary",
  );
  assertNull(
    moteById(after, controlMercury),
    "and the control's mercury was spent doing it",
  );

  const stayed = moteById(after, mercury);
  assertNotNull(stayed, "the held mercury is not consumed");
  assertEqual(stayed?.type, "mercury", "and it is still mercury");
  assertEqual(
    `${stayed?.q},${stayed?.r}`,
    `${PRIME.q},${PRIME.r}`,
    "still resting on the prime hex",
  );
  assertLength(
    gripsOf(after, arm),
    1,
    "the gripper is still holding: a grip persists across cycles until dropped",
  );
  assertEqual(
    heldBy(after, arm, 0),
    mercury,
    "and what it holds is still that mercury",
  );
  assertEqual(
    moteById(after, crown)?.type,
    "saturn",
    "while the crown's planet did not rise, because a held mercury fails the prime condition",
  );
});
