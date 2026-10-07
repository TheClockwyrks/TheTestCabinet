// instrumentation/mid-run-part-enters-at-its-rest-pose — a part placed during a
// live run enters at its rest pose, holding nothing, on the cycle then running.
//
// THE RULE. Of the whole machine group, "While a run is live, a part one of them
// adds enters the run at its rest pose holding nothing, with a wheel's six
// fixtures on its spoke hexes" (`specs/instrumentation.md`, The machine). A rest
// pose is the placed one: "An arm's placed rotation and length are its rest pose"
// (`specs/parts.md`). Which tape cell it then executes is the machine's own clock
// rather than a fresh start: "On cycle `c`, counted from `0`, each part executes
// the cell at index `c` modulo `P` of its own tape" (`specs/instructions.md`),
// where `P` is "the largest tape length across its arms and wheels", and
// `setCycle(n)` "Sets `sim.cycle` to `n`... so the next cycle executes tape cell
// `n mod P` on every part" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. A live run on an empty machine and an empty field, set to
// cycle `3`. One arm is then placed on `(0, 0)` at rotation `4` — `placePart`
// places it "at length `ARM_MIN_LEN` (`1`) with an empty tape" — and given
// `rotate-cw` at column `1`, so its tape is a blank and then `rotate-cw`, the
// machine's period becomes `2`, and the cycle then running reads column `3 mod 2`,
// which is column `1`. A build that started the new part at column `0` would read
// the blank and rest, so the two readings tell each other apart. Nothing else is
// placed and nothing is on the field, so the only motion in the cycle is this
// arm's.
//
// THE VERDICT. The instant it is placed, the run poses the arm at rotation `4`,
// length `1`, on `(0, 0)` — the pose it was placed at, not the pose a settle would
// have given it — and it holds nothing. The cycle then running turns it one step
// clockwise, to rotation `5`: it took its cell from the cycle in progress.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  openBareRun,
  placePart,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters at the pose it was placed at and reads the running cycle's cell", async () => {
  await openBareRun(h, { challenge: BARE });
  await h.debug.setCycle(3);

  const arm = await placePart(h, "arm", at(0, 0), 4);
  await h.debug.setTapeCell(arm, 1, "rotate-cw");
  const entered = await h.snapshot();

  await captureReplay(h, "entered", async () => {
    await advanceCycles(h, 1);
    await h.advance(1);
  });
  const turned = await h.snapshot();

  assertNotNull(
    poseOf(entered, arm),
    "the run poses the part the moment it is added",
  );
  assertEqual(
    poseOf(entered, arm)?.rotation,
    4,
    "the part enters at the rest rotation it was placed at",
  );
  assertEqual(
    poseOf(entered, arm)?.length,
    ARM_MIN_LEN,
    "the part enters at the rest length it was placed at",
  );
  assertEqual(
    `${poseOf(entered, arm)?.cell.q},${poseOf(entered, arm)?.cell.r}`,
    "0,0",
    "the part enters on the anchor hex it was placed on",
  );
  assertLength(gripsOf(entered, arm), 0, "the part enters holding nothing");
  assertEqual(
    entered.editor.period,
    2,
    "the new tape makes the machine's period 2, so cycle 3 reads column 1",
  );
  assertEqual(
    turned.sim?.status,
    "running",
    "the cycle runs to its boundary rather than faulting",
  );
  assertEqual(
    poseOf(turned, arm)?.rotation,
    5,
    "the cycle then running executed column 3 mod 2, so the arm turned one step clockwise",
  );
});
