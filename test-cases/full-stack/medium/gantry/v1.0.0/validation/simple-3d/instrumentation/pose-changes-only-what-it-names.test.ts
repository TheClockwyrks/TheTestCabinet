// instrumentation/pose-changes-only-what-it-names — a pose sets one thing.
//
// specs/instrumentation.md § The operations, of every pose on the surface: "A
// pose sets one thing and leaves the rest of the game as it stands, so a caller
// that wants several things arranged makes several calls, in the order it wants
// them, and nothing it does not ask for happens." The run-in-progress poses say
// it again from their own side: "Each sets what it names and leaves the rest of
// the run as it stands."
//
// The reading that decides it is the WHOLE snapshot, taken either side of one
// call, diffed leaf by leaf. Every differing path has to sit under the field that
// pose names — and at least one has to differ, or the pose did not land and the
// comparison proves nothing.
//
// Five poses, one per family the surface carries: an editor pose (`setTool`), a
// camera pose (`setCamera`), a pending-node pose (`setPendingNode`), and two
// run-in-progress poses (`setAxis`, `setLoadPose`). They exercise the one rule
// the same way, so they share one check.
//
// THE WORLD IS POSED SO THAT NOTHING ELSE CAN HONESTLY MOVE. The pointer is left
// where a reset put it, at the stage's corner, so `pick` — "the node candidate
// and the member candidate a click at the pointer's current position would take"
// — is empty before and after the camera turns, and a build that recomputes it
// from the camera reports the same empty pick either way. The pending node is
// held BEFORE the tool is switched, which is the interesting order: "a pending
// node belongs to the placement rather than the tool, so it survives every tool
// switch" (specs/controls.md). And each run pose is made at tick `0`, where the
// axes stand "stopped with no command", so `setAxis` has nothing but a value to
// change.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes the field a pose names and no other field of the snapshot", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 6, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);
  await h.debug.setPendingNode(0, 4, 0);
  await h.debug.setCamera(60, 40, 30);

  await onlyChanges("setTool", "tool", () => h.debug.setTool("cable"));
  await onlyChanges("setCamera", "camera", () =>
    h.debug.setCamera(120, 50, 35),
  );
  await onlyChanges("setPendingNode", "pendingNode", () =>
    h.debug.setPendingNode(2, 4, 0),
  );

  await startRun(h);

  await onlyChanges("setAxis", "run.axes.slew", () =>
    h.debug.setAxis("slew", 15),
  );
  await onlyChanges("setLoadPose", "run.loads[0]", () =>
    h.debug.setLoadPose(0, 3, 2, 0, 30),
  );

  await h.capture(
    "pose-isolation",
    "The run the five single-field poses left otherwise untouched",
  );
});

/**
 * `call` moves something under `field` and nothing anywhere else.
 *
 * Nothing is advanced across the call, so the only thing that can move the
 * snapshot is the pose itself: `simTime` "accumulates every update's delta time",
 * and no update runs here.
 */
async function onlyChanges(
  operation: string,
  field: string,
  call: () => Promise<void>,
): Promise<void> {
  const before = await h.snapshot();
  await call();
  const changed = differingPaths(before, await h.snapshot());

  const stray = changed.filter(
    (path) => path !== field && !path.startsWith(`${field}.`),
  );
  if (stray.length > 0) {
    fail(
      `${operation} to leave the rest of the game as it stands, changing ` +
        `only ${field} (specs/instrumentation.md)`,
      `it also changed ${stray.slice(0, 12).join(", ")}`,
    );
  }
  if (changed.length === 0) {
    fail(
      `${operation} to set ${field}, so the comparison either side of it is ` +
        "a comparison of something",
      "it changed nothing at all",
    );
  }
}

/** The dotted paths at which two JSON-shaped readings differ. */
function differingPaths(a: unknown, b: unknown, at = ""): string[] {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return [at === "" ? "(the whole reading)" : at];
    }
    return a.flatMap((item, i) => differingPaths(item, b[i], `${at}[${i}]`));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      differingPaths(a[key], b[key], at === "" ? key : `${at}.${key}`),
    );
  }
  return Object.is(a, b) ? [] : [at === "" ? "(the whole reading)" : at];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
