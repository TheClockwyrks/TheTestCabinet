// The text readings: the words a frame actually put on the canvas.
//
// A case fixes copy and leaves the presentation to the build, so a screen is read
// twice — from what the surface reports, and from what the frame drew. These are
// the second half of that, and the transform walk is what makes the second half
// say WHERE as well as WHAT.

import { expect, it } from "vitest";
import { drawnText, drewText, textDraws, type DrawCall } from "../src/index";
import { createHarness, type Harness } from "./fixture";

/** A frame's operations, written the way the recorder hands them over. */
function calls(...ops: DrawCall[]): DrawCall[] {
  return ops;
}

/** One `fillText` call. */
function text(value: unknown, x: unknown, y: unknown): DrawCall {
  return { kind: "call", method: "fillText", args: [value, x, y] };
}

/** One transform call. */
function op(method: string, ...args: unknown[]): DrawCall {
  return { kind: "call", method, args };
}

it("takes the runs a frame drew, filled and stroked alike", () => {
  // Filled first, then stroked: a build is free to use either, and a check that
  // read only one would fail a screen drawn entirely in outline.
  expect(
    drawnText(
      calls(
        text("PLAY", 0, 0),
        { kind: "call", method: "strokeText", args: ["QUIT", 0, 0] },
        { kind: "set", property: "fillStyle", value: "#fff" },
        { kind: "call", method: "fillRect", args: [0, 0, 1, 1] },
      ),
    ),
  ).toEqual(["PLAY", "QUIT"]);

  // A call whose first argument is not a string drew no text, whatever else it
  // did, and is dropped rather than reported as an empty run.
  expect(drawnText(calls(text(42, 0, 0)))).toEqual([]);
});

it("matches copy by substring and ignores case", () => {
  // The words are the case's; the marker and the padding around them are the
  // build's, and requiring the exact run would fail a screen showing precisely
  // the right words.
  const drew = calls(text("> DIVE <", 0, 0));
  expect(drewText(drew, "dive")).toBe(true);
  expect(drewText(drew, "  DIVE  ")).toBe(true);
  expect(drewText(drew, "surface")).toBe(false);
});

it("reports where a run landed, through the transform in force", () => {
  // Drawn at the origin under a translate: the anchor a check reads is where the
  // text ACTUALLY landed, not the zero the call named.
  expect(textDraws(calls(op("translate", 30, 40), text("HUD", 0, 0)))).toEqual([
    { text: "HUD", x: 30, y: 40 },
  ]);

  // `save`/`restore` bracket it, so what follows is unaffected.
  expect(
    textDraws(
      calls(
        op("save"),
        op("translate", 30, 40),
        text("IN", 0, 0),
        op("restore"),
        text("OUT", 1, 2),
      ),
    ),
  ).toEqual([
    { text: "IN", x: 30, y: 40 },
    { text: "OUT", x: 1, y: 2 },
  ]);

  // A scale multiplies the anchor; `setTransform` replaces the lot; and
  // `resetTransform` puts it back to the identity.
  expect(textDraws(calls(op("scale", 2, 3), text("S", 10, 10)))).toEqual([
    { text: "S", x: 20, y: 30 },
  ]);
  expect(
    textDraws(
      calls(
        op("translate", 5, 5),
        op("setTransform", 1, 0, 0, 1, 9, 9),
        text("T", 0, 0),
      ),
    ),
  ).toEqual([{ text: "T", x: 9, y: 9 }]);
  expect(
    textDraws(
      calls(op("translate", 5, 5), op("resetTransform"), text("R", 0, 0)),
    ),
  ).toEqual([{ text: "R", x: 0, y: 0 }]);

  // A run whose coordinates are not numbers is not a positioned draw, so it is
  // dropped rather than reported at `NaN`.
  expect(textDraws(calls(text("X", "a", 0)))).toEqual([]);
});

it("reads the words a real frame drew, at the point the build drew them", async () => {
  const h: Harness = await createHarness();
  try {
    const frame = await h.frameCalls();
    // The fixture draws its screen name under the fit's own `setTransform`, which
    // is the identity at the default shape — so the anchor comes back in the
    // logical units the build named.
    expect(drawnText(frame)).toEqual(["TITLE"]);
    expect(drewText(frame, "title")).toBe(true);
    expect(textDraws(frame)).toEqual([{ text: "TITLE", x: 8, y: 20 }]);
  } finally {
    await h.dispose();
  }
});
