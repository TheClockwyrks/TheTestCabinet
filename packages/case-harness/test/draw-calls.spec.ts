// A recorded operation's measurement travels through `toDrawCall`.

import { expect, it } from "vitest";
import { drawnTextLines, toDrawCall, type RecordedOp } from "../src/index";

it("carries a recorded text call's measurement across to the draw call", () => {
  const measured = { width: 10, textAlign: "start" };
  const ops: RecordedOp[] = [
    { op: "set", property: "font", value: "20px serif" },
    { op: "call", method: "fillRect", args: [0, 0, 10, 10] },
    { op: "call", method: "fillText", args: ["A", 100, 40], text: measured },
    { op: "call", method: "fillText", args: ["B", 112, 40], text: measured },
  ];
  const calls = ops.map(toDrawCall);

  expect(calls[0]).toEqual({
    kind: "set",
    property: "font",
    value: "20px serif",
  });
  expect(calls[2]).toEqual({
    kind: "call",
    method: "fillText",
    args: ["A", 100, 40],
    text: measured,
  });
  // An unmeasured call stays unmeasured: no `text` member appears from nowhere.
  expect(calls[1]).toEqual({
    kind: "call",
    method: "fillRect",
    args: [0, 0, 10, 10],
  });
  expect("text" in calls[1]!).toBe(false);
  // And the measurement is what lets a run drawn a glyph per call coalesce.
  expect(drawnTextLines(calls)).toEqual(["AB"]);
});
