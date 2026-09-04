// instrumentation/set-load-phase-attached-refused-when-occupied — a second load
// cannot be hung while one already hangs.
//
// `specs/instrumentation.md` § The run in progress: `setLoadPhase` to
// `"attached"` "hangs that load on the hook exactly as a successful `attach`
// leaves it ... and it is refused while another load is attached." The rule it
// carries over is the rigging's own — "One load is attached at a time"
// (`specs/rigging.md`) — and the surface's general rule for a refusal is that it
// is silent and read back from the snapshot: "The refusal is silent and readable
// in the snapshot" (§ The operations), and "a caller reads the outcome of any
// pose back from `snapshot` rather than from a return value".
//
// So the check hangs load `0` through the pose, then asks for load `1` and reads
// what stands: the hook still carries load `0` and load `1` is untouched. A
// build that let the second call through would report `1` as the attachment, and
// one that swapped the two would leave load `0` off the hook.
//
// THE WORLD HOLDS EXACTLY THE TWO LOADS THE REQUIREMENT IS ABOUT. Two is what
// "while another load is attached" needs; the yard is emptied and they are added
// back, and neither is parked anywhere the rules under test have to keep it.
// Nothing is advanced between the poses and the readings, because a pose
// "establishes a precondition and never an outcome".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses to hang a second load while one already hangs", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  // Two loads, added one operation at a time: `addOneLoad` holds exactly one,
  // and this requirement is the one scenario that needs a second.
  await h.debug.clearLoads();
  await h.debug.addLoad("crate", 40, 10, 3, 0, 0);
  await h.debug.setLoadTarget(0, 0, 3, 10, 0);
  await h.debug.addLoad("crate", 40, -10, 3, 0, 0);
  await h.debug.setLoadTarget(1, 0, 3, -10, 0);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await h.advance(1);

  await h.debug.setLoadPhase(0, "attached");
  const hung = await h.snapshot();
  assertEqual(
    hung.run.attached,
    0,
    "the load the check hung first, so the hook is occupied when the second " +
      "pose is made",
  );

  await h.debug.setLoadPhase(1, "attached");
  const { run } = await h.snapshot();

  await h.capture("occupied", "The hook still carrying the load it was given");

  assertEqual(
    run.attached,
    0,
    'run.attached after setLoadPhase(1, "attached") on an occupied hook: the ' +
      "pose is refused and the refusal is silent (specs/instrumentation.md)",
  );
  assertEqual(
    run.loads[1]?.phase,
    "waiting",
    "load 1's phase after the refused pose (specs/instrumentation.md)",
  );
});
