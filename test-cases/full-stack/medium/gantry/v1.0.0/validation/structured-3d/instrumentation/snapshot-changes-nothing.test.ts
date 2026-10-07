// instrumentation/snapshot-changes-nothing — a reading is a reading.
//
// specs/instrumentation.md § The operations: "A pose returns nothing; a reading
// returns what it read and changes nothing." The Snapshot shape block says the
// same of where the values come from: "Every field is read straight off the
// game's own state or derived from it at the call."
//
// It matters because every other check in this suite reads as often as it likes:
// a `snapshot` that advanced a tick, drained a queue, latched an input edge or
// cleared a pending flag would make each of those checks measure a game its own
// instrument had moved. So this one takes eighteen readings with nothing driven
// between them and compares the first with the last, `run.tick` and `simTime`
// included — the two fields that would move first if a reading were quietly
// stepping the game. A reading that moves the game moves it on the first repeat;
// the repeats after that only widen a gap the comparison already sees.
//
// The world is a run in progress with a load on the hook, which is the state that
// carries the most for a reading to disturb: a live tape step, four axes under
// command, a pendulum, an attachment, and a solve behind the forces.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Readings taken between the first and the last. */
const READINGS = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every field as it was however often it is read", async () => {
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
  await startRun(h);
  await runTicks(h, 20);
  await h.debug.setLoadPhase(0, "attached");

  const first = await h.snapshot();
  assertEqual(first.run.phase, "running", "the run the readings are taken of");
  assertEqual(first.run.attached, 0, "the load hanging on the hook");

  for (let i = 0; i < READINGS; i += 1) await h.snapshot();
  const last = await h.snapshot();

  const changed = differingPaths(first, last);
  await h.capture(
    "snapshot-is-a-reading",
    `The run ${READINGS + 2} readings left`,
  );

  if (changed.length > 0) {
    fail(
      `every field to read the same after ${READINGS + 2} snapshots with ` +
        'nothing advanced between them: a reading "returns what it read and ' +
        'changes nothing" (specs/instrumentation.md)',
      `${changed.length} field(s) moved: ${changed.slice(0, 12).join(", ")}`,
    );
  }
});

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
