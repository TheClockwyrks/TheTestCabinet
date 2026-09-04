// parts/grippers-pass-over-parts — a gripper and its shaft sweep over any part
// without being blocked and without faulting.
//
// THE RULE. "Only motes collide, so a gripper and the drawn arm between base and
// gripper pass over any hex, on or off the field, and over any part"
// (`specs/parts.md`, Arms). The collision rule agrees from its own side: what it
// samples is "the distance between the centers of two motes"
// (`specs/simulation.md`, Collision), and no part is a mote. `FAULTS` names no
// fault for a part in the way, either.
//
// THE CONFIGURATION. An arm at `(0, 0)`, rotation `0`, length `2`, whose tape cell
// for the cycle is `rotate-cw`: "The part turns one 60 degree step clockwise about
// its base" (`specs/instructions.md`), which by the clockwise formula of
// `specs/field.md` carries its gripper from `(2, 0)` to `(0, 2)` and sweeps the
// drawn shaft across the hexes between. Three kinds of part are laid in that
// sweep, one of each sort the requirement names:
//
//   - a `wane` sigil at `(1, 1)`, whose footprint is the single hex "`(0, 0)` —
//     seat" (`specs/sigils.md`), sitting under the middle of the arc;
//   - a two-cell track through `(1, 0)` and `(0, 1)`, the hexes the shaft crosses
//     at the start and the end of the sweep;
//   - a second arm anchored on `(0, 2)`, the hex the gripper LANDS on.
//
// The machine is legal under every rule of `specs/parts.md`: the one sigil
// footprint is disjoint from the track's cells, no track cell is on it, and the
// two arm anchors differ. Nothing on the field is a mote — the field is emptied,
// and no wheel is placed — so the only thing that could stop the sweep is a part.
// The second arm's tape is empty, "which every part rests on", so it stands still
// and the one motion in the world is the sweep under test.
//
// THE VERDICT. The cycle reaches its boundary with `sim.status` still `running`
// and no fault, and the arm's live rotation is `1`: it really turned rather than
// being held where it was, which is what separates "not blocked" from "never
// moved". The second arm is exactly where it stood, and the machine still holds
// all four parts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The sweeping arm, and the three parts its gripper and shaft cross. */
const SWEEPER = at(0, 0);
const SWEEP_LENGTH = 2;
const SIGIL_HEX = at(1, 1);
const TRACK_CELLS = [at(1, 0), at(0, 1)];
const BYSTANDER = at(0, 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns an arm whose gripper and shaft cross a sigil, a track and another arm", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("wane", SIGIL_HEX.q, SIGIL_HEX.r, 0),
      trackPart(TRACK_CELLS),
      armPart("arm", SWEEPER.q, SWEEPER.r, 0, SWEEP_LENGTH, ["rotate-cw"]),
      armPart("arm", BYSTANDER.q, BYSTANDER.r, 0, 1, []),
    ]),
  });
  const ids = await partIds(h);
  const sweeper = ids[2] ?? -1;
  const bystander = ids[3] ?? -1;

  // The geometry the check claims to be posing: the gripper lands on the hex the
  // second arm is anchored on, by the formula of `specs/parts.md`.
  const landing = gripperHex(SWEEPER, 1, SWEEP_LENGTH);
  assertEqual(
    `${landing.q},${landing.r}`,
    `${BYSTANDER.q},${BYSTANDER.r}`,
    "one clockwise step carries the gripper onto the other arm's anchor hex",
  );

  const snapshot = await captureReplay(h, "sweep", async () => {
    await advanceCycles(h, 1);
    return h.snapshot();
  });

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that swept");
  assertEqual(
    sim?.status,
    "running",
    "only motes collide, so a sweep across parts reaches its boundary",
  );
  assertNull(
    sim?.fault ?? null,
    "no fault is raised by a gripper or a shaft crossing a part",
  );
  assertEqual(sim?.cycle, 1, "the cycle ran to its boundary rather than freezing");
  assertEqual(
    poseOf(snapshot, sweeper)?.rotation,
    1,
    "the arm really turned its one step: it was not blocked by the parts under the sweep",
  );
  assertEqual(
    `${poseOf(snapshot, sweeper)?.cell.q},${poseOf(snapshot, sweeper)?.cell.r}`,
    `${SWEEPER.q},${SWEEPER.r}`,
    "the sweeping arm's base is where it was anchored: a rotation moves no base",
  );
  assertEqual(
    poseOf(snapshot, bystander)?.rotation,
    0,
    "the arm the gripper landed over stands exactly as it was, on a blank tape",
  );
  assertEqual(
    snapshot.editor.parts.length,
    4,
    "the sigil, the track and both arms are all still on the machine",
  );
});
