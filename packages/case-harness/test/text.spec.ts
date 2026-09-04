// The text readings: the words a frame actually put on the canvas.
//
// A case fixes copy and leaves the presentation to the build, so a screen is read
// twice — from what the surface reports, and from what the frame drew. These are
// the second half of that, and the transform walk is what makes the second half
// say WHERE as well as WHAT.

import { expect, it } from "vitest";
import {
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  drewText,
  textDraws,
  type DrawCall,
} from "../src/index";
import { createHarness, type Harness } from "./fixture";

/** A frame's operations, written the way the recorder hands them over. */
function calls(...ops: DrawCall[]): DrawCall[] {
  return ops;
}

/** One `fillText` call, optionally carrying the width the harness measured. */
function text(
  value: unknown,
  x: unknown,
  y: unknown,
  width?: number,
  textAlign = "start",
): DrawCall {
  const call: DrawCall = {
    kind: "call",
    method: "fillText",
    args: [value, x, y],
  };
  if (width !== undefined) call.text = { width, textAlign };
  return call;
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
    { text: "HUD", x: 30, y: 40, left: 30, right: 30 },
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
    { text: "IN", x: 30, y: 40, left: 30, right: 30 },
    { text: "OUT", x: 1, y: 2, left: 1, right: 1 },
  ]);

  // A scale multiplies the anchor; `setTransform` replaces the lot; and
  // `resetTransform` puts it back to the identity.
  expect(textDraws(calls(op("scale", 2, 3), text("S", 10, 10)))).toEqual([
    { text: "S", x: 20, y: 30, left: 20, right: 20 },
  ]);
  expect(
    textDraws(
      calls(
        op("translate", 5, 5),
        op("setTransform", 1, 0, 0, 1, 9, 9),
        text("T", 0, 0),
      ),
    ),
  ).toEqual([{ text: "T", x: 9, y: 9, left: 9, right: 9 }]);
  expect(
    textDraws(
      calls(op("translate", 5, 5), op("resetTransform"), text("R", 0, 0)),
    ),
  ).toEqual([{ text: "R", x: 0, y: 0, left: 0, right: 0 }]);

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
    expect(textDraws(frame)).toEqual([
      { text: "TITLE", x: 8, y: 20, left: 8, right: 8 },
    ]);
  } finally {
    await h.dispose();
  }
});

it("places a run about its anchor under the alignment in force", () => {
  // A measured call knows how wide it is, so a draw is an EXTENT and not a
  // point — and where that extent sits about the anchor is what `textAlign`
  // says. Left-aligned it starts at the anchor; centred it straddles it; right-
  // aligned it ends there.
  expect(textDraws(calls(text("HP", 10, 5, 30)))).toEqual([
    { text: "HP", x: 10, y: 5, left: 10, right: 40 },
  ]);
  expect(textDraws(calls(text("HP", 10, 5, 30, "center")))).toEqual([
    { text: "HP", x: 10, y: 5, left: -5, right: 25 },
  ]);
  expect(textDraws(calls(text("HP", 10, 5, 30, "right")))).toEqual([
    { text: "HP", x: 10, y: 5, left: -20, right: 10 },
  ]);
  expect(textDraws(calls(text("HP", 10, 5, 30, "end")))).toEqual([
    { text: "HP", x: 10, y: 5, left: -20, right: 10 },
  ]);

  // The width takes the same horizontal scale the anchor took.
  expect(textDraws(calls(op("scale", 2, 2), text("HP", 10, 5, 30)))).toEqual([
    { text: "HP", x: 20, y: 10, left: 20, right: 80 },
  ]);
});

it("coalesces a letter-spaced heading into the one run it spells", () => {
  // Six glyphs, each 10 wide, tracked 4 apart — 0.4 of the run's own mean
  // advance, inside the 0.6 the rule allows. What the frame SPELLS is one run.
  const spaced = calls(
    ...["S", "O", "L", "V", "E", "D"].map((glyph, i) =>
      text(glyph, 100 + i * 14, 40, 10),
    ),
  );
  expect(drawnTextLines(spaced)).toEqual(["SOLVED"]);
  expect(drawnTextRuns(spaced)).toEqual([
    // The run keeps the placement of its first draw, and only its right edge
    // grows: 100 through the last glyph's own right edge at 170 + 10.
    { text: "SOLVED", x: 100, y: 40, left: 100, right: 180 },
  ]);
  // The raw readings are untouched: one entry per call, either way.
  expect(drawnText(spaced)).toHaveLength(6);
  expect(textDraws(spaced)).toHaveLength(6);

  // And a heading read as one run is found by the words it spells, which is the
  // whole point — no substring of the raw calls could have found it.
  expect(drewText(spaced, "solved")).toBe(true);
});

it("keeps a figure a clear gap from its label its own run", () => {
  // The label is 60 wide over 6 characters, so its mean advance is 10 and the
  // rule allows a 6-wide gap. The figure sits 30 past it, which is a HUD's
  // spacing rather than a heading's tracking, so the two stay apart.
  const hud = calls(text("SOLVED", 20, 40, 60), text("2", 110, 40, 8));
  expect(drawnTextLines(hud)).toEqual(["SOLVED", "2"]);

  // A different baseline never joins, however close the two sit horizontally.
  const stacked = calls(text("AB", 20, 40, 20), text("CD", 40, 44, 20));
  expect(drawnTextLines(stacked)).toEqual(["AB", "CD"]);

  // The runs come back in reading order — down the frame, then across it —
  // whatever order the build drew them in.
  const scattered = calls(
    text("LOW", 10, 90, 20),
    text("RIGHT", 200, 10, 20),
    text("LEFT", 10, 10, 20),
  );
  expect(drawnTextLines(scattered)).toEqual(["LEFT", "RIGHT", "LOW"]);
});

it("merges nothing at all when the case never asked to measure", () => {
  // Without `measureText` every draw is a point, so the mean advance is zero and
  // no gap can be inside it: the runs are the calls, which is exactly what a
  // case that never asked to measure was already reading.
  const spaced = calls(
    ...["H", "I"].map((glyph, i) => text(glyph, 100 + i * 14, 40)),
  );
  expect(drawnTextLines(spaced)).toEqual(["H", "I"]);
  expect(drewText(spaced, "hi")).toBe(false);
});
