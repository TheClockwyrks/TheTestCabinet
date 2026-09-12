// Tests for the snapshot schedule's text, and for when that text reaches the
// timeline. A scored scenario is graded at exactly these ticks, so a field that
// edits them destructively is the same defect as a board size that resizes mid-edit.

import { describe, expect, it } from "vitest";
import { commitTickList, formatTicks, parseTicks, sameTicks } from "./tickList";

const SCORED = [1250, 2500, 5000];

describe("reading a schedule back from what was typed", () => {
  it("round-trips a formatted schedule", () => {
    expect(parseTicks(formatTicks(SCORED))).toEqual(SCORED);
  });

  it("keeps a schedule the engine would refuse, for `timelineError` to report", () => {
    expect(parseTicks("900, 100")).toEqual([900, 100]);
  });

  it("ignores blank entries so a trailing comma is not a tick", () => {
    expect(parseTicks("1250, 2500, ")).toEqual([1250, 2500]);
  });
});

describe("the parsed-value field this replaced", () => {
  it("swallowed the comma that starts a second checkpoint", () => {
    // The negative control for the fix: when the field's value was the parsed list,
    // typing "," re-rendered it without the comma, so a second snapshot could not
    // be typed at all.
    expect(formatTicks(parseTicks("1250,"))).toBe("1250");
  });

  it("destroyed the schedule a backspace at a time", () => {
    // Clearing "1250, 2500" to retype it committed a shorter schedule per keystroke,
    // and nothing in this tool can be undone.
    expect(parseTicks("1250, 2")).toEqual([1250, 2]);
    expect(parseTicks("1250")).toEqual([1250]);
  });
});

describe("finishing with the schedule field", () => {
  it("commits nothing when the field was never typed into", () => {
    expect(commitTickList(null, SCORED)).toBeNull();
  });

  it("commits the whole list once, not a prefix per keystroke", () => {
    expect(commitTickList("1250, 2500, 5000", [1250])).toEqual(SCORED);
  });

  it("treats an emptied field as an abandoned edit, not an empty schedule", () => {
    expect(commitTickList("", SCORED)).toBeNull();
    expect(commitTickList("  ", SCORED)).toBeNull();
  });

  it("commits nothing when the typing names the schedule already held", () => {
    expect(commitTickList("1250, 2500, 5000", SCORED)).toBeNull();
    // Even written differently — a tab through the field must not mark it dirty.
    expect(commitTickList("1250,2500,  5000", SCORED)).toBeNull();
  });

  it("commits a schedule the engine would refuse rather than repairing it", () => {
    expect(commitTickList("900, 100", SCORED)).toEqual([900, 100]);
  });
});

describe("comparing schedules", () => {
  it("is order-sensitive, because the grading order is", () => {
    expect(sameTicks([1, 2], [2, 1])).toBe(false);
    expect(sameTicks([1, 2], [1, 2])).toBe(true);
    expect(sameTicks([1], [1, 2])).toBe(false);
  });
});
