// simulation/translation-is-linear-in-the-fraction — a translating instruction
// carries its load along the vector in proportion to the fraction.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying).
// Two of its rows impose a TRANSLATION, and both name the same law:
//
//   * "`extend`, `retract` — The piston's length changes by one, its gripper
//     translating one hex along its spoke. | Translation by the same vector,
//     linearly in `t`."
//   * "`advance`, `recede` — The base translates to the adjacent track cell,
//     wrapping on a closed track. | Translation by the same vector, linearly in
//     `t`."
//
// The `t` they are linear in is the cycle's own progress: "A cycle is one unit of
// simulated machine time. Its progress is `sim.fraction`, from `0` to `1`"
// (`specs/simulation.md`, Cycles and the clock). So the drawn position of a
// carried mote — "the drawn position at the current fraction"
// (`specs/instrumentation.md`, Snapshot shape) — is its cycle-start hex center
// plus `t` times the whole one-hex vector, and at `t = 1` it lands on the far
// center, which `specs/field.md` places at `HEX_PITCH` (`48`) from the near one.
//
// FOUR CONFIGURATIONS, ONE PER TRANSLATING INSTRUCTION, each posed on its own
// isolated world so no two of them can be confused for one another:
//
//   * `extend` — a piston on `(0, 0)` at rotation `0`, length `1`, whose gripper
//     is therefore `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
//     `specs/parts.md`), carrying the mote resting there. The length rises by one,
//     so the gripper translates to `(2, 0)`.
//   * `retract` — the same piston at length `2`, gripper `(2, 0)`, carrying the
//     mote there back to `(1, 0)`.
//   * `advance` — an open track along `r = 1`, an arm mounted on its first cell
//     `(0, 1)` at rotation `4` (`DIRS[4]` is `(0, -1)`, so its gripper is
//     `(0, 0)`), carrying the mote there. The base moves to the next cell `(1, 1)`
//     and the gripper with it, to `(1, 0)`.
//   * `recede` — the same track, the arm on `(1, 1)`, gripper `(1, 0)`, carrying
//     the mote there back to `(0, 0)`.
//
// Each world holds ONE mote, so nothing the collision rule watches is on the
// field beside the one thing being measured, and every hold is given with
// `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so the cycle under test is the first cycle.
//
// THE EXPECTED POSITION IS COMPUTED FROM THE FRACTION THE RUN REPORTS, because
// `sim.fraction` is one of the three figures `specs/instrumentation.md` carries as
// a running sum of the frames' own delta times, which "agree to within the
// rounding of that sum rather than bit for bit". The fraction is read back through
// `assertNear`, and the position it implies is what the mote is measured against —
// so a build whose clock lands a hair off the quarter is judged on its LINEARITY
// rather than on its arithmetic.
//
// THE VERDICT. At each of `1/4`, `2/4` and `3/4` of the cycle the carried mote
// stands that proportion of the way along the vector, and at the boundary it is on
// the far hex. A build that snaps its load to the destination, holds it at the
// origin until the boundary, or eases it in and out fails the reading at a
// quarter, where the linear law puts it exactly `HEX_PITCH / 4` (`12`) along.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of the vector. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The quarters of the cycle the linear law is read at. */
const QUARTERS = [1, 2, 3] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive one posed translation quarter by quarter, reading the carried mote
 * against `from + t * (to - from)` at each, and onto the far hex at the boundary.
 *
 * Asserts nothing about HOW the world was posed: every caller poses its own.
 */
async function readsLinear(
  instruction: string,
  mote: number,
  from: Hex,
  to: Hex,
  capture: string | null,
): Promise<void> {
  const start = hexCenter(from);
  const end = hexCenter(to);
  for (const quarter of QUARTERS) {
    await advanceFraction(h, 1 / 4);
    if (quarter === 1 && capture !== null) await captureStill(h, capture);
    const midway = await h.snapshot();
    const fraction = midway.sim?.fraction ?? -1;
    assertNear(
      fraction,
      quarter / 4,
      FRACTION_TOLERANCE,
      `${instruction} is ${quarter} quarters of the way through its cycle`,
    );
    const carried = moteById(midway, mote);
    assertNotNull(carried, `the mote ${instruction} carries is reported`);
    assertNear(
      carried?.x ?? Number.NaN,
      start.x + fraction * (end.x - start.x),
      DRAWN_TOLERANCE,
      `${instruction} translates its load by the vector linearly in t, so x is the cycle-start x plus t of the whole vector`,
    );
    assertNear(
      carried?.y ?? Number.NaN,
      start.y + fraction * (end.y - start.y),
      DRAWN_TOLERANCE,
      `${instruction} translates its load by the vector linearly in t, so y is the cycle-start y plus t of the whole vector`,
    );
  }

  await advanceFraction(h, 1 / 4);
  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    `${instruction} carries one mote across an otherwise empty field, so nothing faults`,
  );
  const landed = moteById(boundary, mote);
  assertEqual(
    `${landed?.q},${landed?.r}`,
    `${to.q},${to.r}`,
    `${instruction} translates its load one hex along the vector, so the slide really ran`,
  );
}

it("carries a translated mote t of the way along the vector at fraction t", async () => {
  // `extend` — the piston's gripper translates from (1, 0) out to (2, 0).
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 1, ["extend"])]),
  });
  const extending = (await partIds(h))[0] ?? -1;
  const extended = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, extending, 0, extended);
  await readsLinear("extend", extended, at(1, 0), at(2, 0), "mid-slide");

  // `retract` — the same gripper translates from (2, 0) back in to (1, 0).
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 2, ["retract"])]),
  });
  const retracting = (await partIds(h))[0] ?? -1;
  const retracted = await spawnMote(h, at(2, 0), "dust");
  await takeGrip(h, retracting, 0, retracted);
  await readsLinear("retract", retracted, at(2, 0), at(1, 0), null);

  // `advance` — the base translates one track cell east, gripper (0, 0) to (1, 0).
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 1), at(1, 1), at(2, 1)]),
      armPart("arm", 0, 1, 4, 1, ["advance"]),
    ]),
  });
  const advancing = (await partIds(h))[1] ?? -1;
  const advanced = await spawnMote(h, at(0, 0), "dust");
  await takeGrip(h, advancing, 4, advanced);
  await readsLinear("advance", advanced, at(0, 0), at(1, 0), null);

  // `recede` — the base translates one track cell west, gripper (1, 0) to (0, 0).
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 1), at(1, 1), at(2, 1)]),
      armPart("arm", 1, 1, 4, 1, ["recede"]),
    ]),
  });
  const receding = (await partIds(h))[1] ?? -1;
  const receded = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, receding, 4, receded);
  await readsLinear("recede", receded, at(1, 0), at(0, 0), null);
});
