// simulation/drop-releases-only-that-parts-grippers — a drop opens its own
// grippers and no one else's.
//
// THE RULE. The drop step names whose grippers it opens: "2. Drops. Every gripper
// of every part WHOSE INSTRUCTION IS `drop` opens" (`specs/simulation.md`) — a
// part executing something else is not one of them, and a blank "is a rest: the
// part holds its pose for the cycle, KEEPING WHATEVER GRIP IT HAS"
// (`specs/instructions.md`). That two parts may be holding the same thing at once
// is explicit: "A constellation may be held by several grippers at once, and the
// drop and grab steps may create that freely" (Held more than once).
//
// THE CONFIGURATION. One mote on `(1, 0)`, held by two grippers standing over it
// from opposite sides — "one gripper per spoke at `base + length * DIRS[d]`"
// (`specs/parts.md`) with the offsets of `specs/field.md`:
//
//   * an arm on `(0, 0)` at rotation `0` (`DIRS[0]` is `(+1, 0)`), with `drop` on
//     its tape — the part under test;
//   * an arm on `(2, 0)` at rotation `3` (`DIRS[3]` is `(-1, 0)`), with a BLANK
//     tape, which keeps whatever grip it has.
//
// Both holds are given with `setGrip`, "which takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so the only instruction that runs is the
// `drop`. The one mote is the whole of the field, so no pair exists for the
// collision rule; and after the drop step the only holder left imposes no motion,
// so the agreement check passes and nothing tears.
//
// BOTH HOLDS ARE READ BEFORE THE CYCLE, so a build reporting no grips at all is
// caught there rather than passing on an empty reading afterwards.
//
// THE VERDICT. After the cycle the dropping arm holds nothing and the resting arm
// still holds the mote — `sim.grips` has exactly one entry, and it names the arm
// that did not drop. The mote is still on `(1, 0)`. A build whose `drop` opens
// every gripper on the field, rather than every gripper OF THAT PART, ends with
// none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The dropping arm's spoke, and the resting arm's: opposite sides of (1, 0). */
const DROPPER_SPOKE = 0;
const KEEPER_SPOKE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the other holder's grip on the same constellation intact", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, DROPPER_SPOKE, 1, ["drop"]),
      armPart("arm", 2, 0, KEEPER_SPOKE, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const dropper = placed[0] ?? -1;
  const keeper = placed[1] ?? -1;
  const mote = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, dropper, DROPPER_SPOKE, mote);
  await takeGrip(h, keeper, KEEPER_SPOKE, mote);

  const posed = await h.snapshot();
  assertEqual(
    heldBy(posed, dropper, DROPPER_SPOKE),
    mote,
    "the dropping arm is holding the mote when the cycle begins",
  );
  assertEqual(
    heldBy(posed, keeper, KEEPER_SPOKE),
    mote,
    "the resting arm is holding the same mote when the cycle begins",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "kept");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "one mote alone on the field gives the collision rule no pair, and the one holder left imposes no motion",
  );
  assertLength(
    gripsOf(boundary, dropper),
    0,
    "the part whose instruction is drop opens its own grippers",
  );
  assertEqual(
    heldBy(boundary, keeper, KEEPER_SPOKE),
    mote,
    "the other part's grip on the same constellation is left intact: it executed a blank, which keeps whatever grip it has",
  );
  assertLength(
    boundary.sim?.grips ?? [],
    1,
    "one of the two holders released and the other did not",
  );
  const seen = moteById(boundary, mote);
  assertNotNull(seen, "the run still reports the constellation being held");
  assertEqual(
    `${seen?.q},${seen?.r}`,
    "1,0",
    "neither the drop nor the kept grip imposes a motion, so the mote stands where it stood",
  );
});
