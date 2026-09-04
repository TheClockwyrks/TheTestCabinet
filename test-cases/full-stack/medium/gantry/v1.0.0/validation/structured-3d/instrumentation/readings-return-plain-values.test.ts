// instrumentation/readings-return-plain-values — everything the surface hands
// back is plain data.
//
// specs/instrumentation.md § The operations: "Every argument is a plain number,
// string, or boolean... Values come back as plain numbers, strings, booleans, and
// plain objects." The Snapshot shape block writes the whole reading out as an
// object literal of exactly those, and the `check` reading the same.
//
// What that rules out is a reading that hands back the game's own machinery: a
// class instance, an engine vector, a live array the caller shares with the game,
// a function. So the two readings are taken over a world that exercises every
// branch that could carry one — a crane of members, a ring, a tape, a yard, and a
// run in progress with a load on the hook — and then walked leaf by leaf, and
// round-tripped through JSON, which is the reading a value that is genuinely
// plain survives unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands back readings of plain numbers, strings, booleans and objects", async () => {
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
    { kind: "action", action: "attach" },
  ]);
  await startRun(h);
  await runTicks(h, 5);

  for (const [what, reading] of [
    ["snapshot()", (await h.snapshot()) as unknown],
    ["check()", (await h.check()) as unknown],
  ] as const) {
    const stray = strayLeaf(reading, what);
    if (stray !== null) {
      fail(
        `${what} to come back as plain numbers, strings, booleans and plain ` +
          "objects (specs/instrumentation.md)",
        stray,
      );
    }
    const moved = differingPaths(
      JSON.parse(JSON.stringify(reading)) as unknown,
      reading,
      what,
    );
    if (moved.length > 0) {
      fail(
        `${what} to survive a JSON round trip unchanged, everything it hands ` +
          "back being plain data (specs/instrumentation.md)",
        `${moved.slice(0, 12).join(", ")} came back different`,
      );
    }
  }

  await h.capture(
    "plain-readings",
    "The run the two readings were taken over",
  );
});

/**
 * The first leaf of `value` that is not plain data, described, or `null`.
 *
 * "Plain" is the whole of what the snapshot literal is written in: a number, a
 * string, a boolean, `null`, an array of those, or an object whose prototype is
 * `Object.prototype`. A class instance, a function and an `undefined` leaf each
 * fail here.
 */
function strayLeaf(value: unknown, at: string): string | null {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "number" || kind === "string" || kind === "boolean") return null;
  if (kind !== "object") return `${at} is a ${kind}`;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const stray = strayLeaf(item, `${at}[${index}]`);
      if (stray !== null) return stray;
    }
    return null;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return `${at} is an instance of ${
      (value as { constructor?: { name?: string } }).constructor?.name ??
      "some class"
    }, not a plain object`;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) return `${at}.${key} is undefined`;
    const stray = strayLeaf(item, `${at}.${key}`);
    if (stray !== null) return stray;
  }
  return null;
}

/**
 * The paths at which two JSON-shaped readings differ.
 *
 * Compared with `===` rather than `Object.is`, so `-0` and `0` are the same
 * reading: a solve is free to answer either for a member carrying nothing, and
 * `specs/instrumentation.md` asks for a plain number rather than a signed zero.
 */
function differingPaths(a: unknown, b: unknown, at: string): string[] {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return [at];
    }
    return a.flatMap((item, i) => differingPaths(item, b[i], `${at}[${i}]`));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      differingPaths(a[key], b[key], `${at}.${key}`),
    );
  }
  return a === b ? [] : [at];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
