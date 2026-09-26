// Where the debug surface comes from under an engine, and what stands in when
// the build returned none.
//
// The stand-in here fails at the property ACCESS, where the engineless half's
// answers a function that fails when CALLED. That difference decides whether a
// `typeof h.debug.op` against a build that shipped nothing reads "function" or
// fails, so it is pinned in both directions.

import { expect, it } from "vitest";
import {
  absentSurface,
  missingOps,
  missingOpsFault,
  readDebugSurface,
} from "../src/engine/surface";
import { unexposedSurface } from "../src/surface";

const REQUIREMENT = "the debug surface initialize returns";

interface Surface {
  snapshot(): { screen: string };
  version: number;
}

it("reads the surface the engine holds, untouched", () => {
  const held: Surface = { snapshot: () => ({ screen: "title" }), version: 1 };
  const read = readDebugSurface<Surface>({ debug: held }, REQUIREMENT);
  expect(read).toBe(held);
});

it("stands in for a null return, naming what was found", () => {
  const read = readDebugSurface<Surface>({ debug: null }, REQUIREMENT);
  expect(() => read.snapshot).toThrow(
    /engine\.debug holds null, not an object/,
  );
  expect(() => read.snapshot).toThrow(new RegExp(REQUIREMENT));
});

it("stands in for a return that is not an object at all", () => {
  const read = readDebugSurface<Surface>({ debug: 7 }, REQUIREMENT);
  expect(() => read.version).toThrow(/holds number, not an object/);
});

it("the stand-in fails at the ACCESS, so a typeof probe cannot pass", () => {
  const stand = absentSurface<Surface>(REQUIREMENT, "nothing was returned");
  expect(() => typeof stand.snapshot).toThrow(/nothing was returned/);
});

it("the engineless stand-in answers a function instead, and that is the split", () => {
  const other = unexposedSurface<Surface>("nothing was returned", (fault) => {
    throw new Error(fault);
  });
  // The counterpart in `../src/surface`: reaching is fine, calling is not. Both
  // ship; neither is a better version of the other.
  expect(typeof other.snapshot).toBe("function");
  expect(() => other.snapshot()).toThrow(/nothing was returned/);
});

it("the stand-in answers the machinery's own probes without failing", () => {
  const stand = absentSurface<Record<string, unknown>>(REQUIREMENT, "gone");
  expect(stand.then).toBeUndefined();
  expect(stand.constructor).toBeUndefined();
  expect(
    (stand as unknown as Record<symbol, unknown>)[Symbol.toStringTag],
  ).toBeUndefined();
});

it("an awaited stand-in resolves to itself rather than failing", async () => {
  const stand = absentSurface<Record<string, unknown>>(REQUIREMENT, "gone");
  await expect(Promise.resolve(stand)).resolves.toBe(stand);
});

it("names the operations a surface that turned up does not carry", () => {
  const held = { snapshot: () => ({}), setScreen: 3 };
  expect(missingOps(held, ["snapshot", "setScreen", "reset"])).toEqual([
    "setScreen",
    "reset",
  ]);
  expect(missingOpsFault(held, ["snapshot"])).toBeNull();
  expect(missingOpsFault(held, ["snapshot", "reset"])).toBe(
    "engine.debug is present but carries no reset()",
  );
});

it("a surface that is no object is missing every operation", () => {
  expect(missingOps(null, ["a", "b"])).toEqual(["a", "b"]);
});
