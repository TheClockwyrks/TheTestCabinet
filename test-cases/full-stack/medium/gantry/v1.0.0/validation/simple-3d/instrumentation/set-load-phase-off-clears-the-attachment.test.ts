// instrumentation/set-load-phase-off-clears-the-attachment — any phase but
// attached takes the load off the hook.
//
// `specs/instrumentation.md` § The run in progress: "Every other phase takes the
// load off the hook, so the run's attachment clears when the load posed was the
// one hanging." `run.attached` is "the attached load's index", or `null`
// (§ Snapshot shape), so what the requirement asks for is exactly that the
// attachment reads `null` once the load hanging is posed to any other phase.
//
// `"waiting"` AND `"lost"` ARE ONE EDGE, EXERCISED ONE WAY. Both are phases that
// take the load off the hook and leave it where it stands, and the requirement
// is the same rule for each, so they share this check rather than splitting into
// two that would fail together. `"placed"` is the third such phase, and it
// carries a second rule of its own — the load sits at exactly its target pose —
// so it is decided by its own check next door.
//
// The load is hung through the pose rather than flown to and attached, because
// this decides what taking it OFF the hook does; the world holds exactly the one
// load, and nothing is advanced between a pose and its reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
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

const FROM = { x: 10, y: 3, z: 0, yaw: 0 };
const TO = { x: 0, y: 3, z: 10, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the run's attachment when the load hanging is posed off the hook", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await h.advance(1);

  try {
    for (const phase of ["waiting", "lost"] as const) {
      await h.debug.setLoadPhase(0, "attached");
      assertEqual(
        (await h.snapshot()).run.attached,
        0,
        `the load hanging on the hook before it is posed "${phase}"`,
      );

      await h.debug.setLoadPhase(0, phase);
      const { run } = await h.snapshot();
      assertNull(
        run.attached,
        `run.attached after the hanging load was posed "${phase}" ` +
          "(specs/instrumentation.md)",
      );
      assertEqual(
        run.loads[0]?.phase,
        phase,
        `run.loads[0].phase after the pose to "${phase}"`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("off", "The hook empty after the load was posed off it");
  }
});
