// Tests for when a numeric field's typing reaches the design.
//
// The case that matters is retyping a board dimension. Replacing a width of 12 with
// 64 is "select all, 6, 4", and 6 is a legal width, so a field that commits every
// keystroke inside its range resizes the board to 6 on the way past — and a resize
// used to delete whatever no longer fitted, in a tool with no undo. The tests drive
// the exact key sequence through the same step function the control uses.

import { describe, expect, it } from "vitest";
import { readNumberField } from "@numeric";
import { fieldText, stepNumberField, type FieldEvent } from "./numberField";
import {
  inBounds,
  resizeBoard,
  type Design,
  type DesignEntity,
} from "../model";

const DIMENSION = {
  min: 4,
  max: 120,
  integer: true,
  label: "The board’s width",
};

function belt(x: number): DesignEntity {
  return { type: "belt", x, y: 1, dir: "E", tier: "fast" };
}

/**
 * Drive a held field the way `HeldNumberInput` drives it — one draft, one step
 * function, a commit per event — and report every value it committed and the text
 * it was left showing.
 */
function held(
  value: number,
  events: FieldEvent[],
  onCommit: (next: number) => number = (next) => next,
) {
  let draft: string | null = null;
  let current = value;
  const committed: number[] = [];
  for (const event of events) {
    const step = stepNumberField(draft, current, DIMENSION, event);
    draft = step.draft;
    if (step.commit !== null) {
      committed.push(step.commit);
      current = onCommit(step.commit);
    }
  }
  return { committed, current, text: fieldText(draft, current) };
}

/** The keystrokes of selecting a field's contents and typing `digits` over them. */
function retype(digits: string): FieldEvent[] {
  const keys: FieldEvent[] = [];
  for (let i = 1; i <= digits.length; i++) {
    keys.push({ type: "type", raw: digits.slice(0, i) });
  }
  return keys;
}

describe("retyping a board dimension", () => {
  it("commits 64 once, never the 6 typed on the way to it", () => {
    const field = held(12, [...retype("64"), { type: "commit" }]);
    expect(field.committed).toEqual([64]);
  });

  it("keeps every component when a width of 12 is retyped as 64", () => {
    // x=10 fits the 12-wide board and the 64-wide one, and nothing else; a board
    // that ever became 6 wide is what used to take it.
    let design: Design = {
      grid: { width: 12, height: 8 },
      entities: [belt(2), belt(10)],
    };
    const field = held(
      design.grid.width,
      [...retype("64"), { type: "commit" }],
      (width) => {
        const result = resizeBoard(design, [], width, design.grid.height);
        expect(result.setAside).toBe(0);
        design = result.design;
        return width;
      },
    );
    expect(field.committed).toEqual([64]);
    expect(design.grid.width).toBe(64);
    expect(design.entities).toEqual([belt(2), belt(10)]);
  });

  it("is the only discipline that saves them", () => {
    // The negative control. A field that commits whatever the keystroke names —
    // what these fields used to do — passes 6 to the resize, and the resize this
    // replaced deleted what no longer fitted.
    const live = ["6", "64"]
      .map((raw) => readNumberField(raw, DIMENSION))
      .filter((v) => v.valid)
      .map((v) => v.value);
    expect(live).toEqual([6, 64]);
    const survivors = [belt(2), belt(10)].filter((e) =>
      inBounds(e, { width: 6, height: 8 }),
    );
    expect(survivors).toEqual([belt(2)]);
  });

  it("still loses nothing when the board really is shrunk to 6", () => {
    // Belt and braces: even a dimension somebody means sets components aside
    // rather than deleting them, and typing the intended one brings them back.
    const start: Design = {
      grid: { width: 12, height: 8 },
      entities: [belt(2), belt(10)],
    };
    const shrunk = resizeBoard(start, [], 6, 8);
    expect(shrunk.design.entities).toEqual([belt(2)]);
    const grown = resizeBoard(shrunk.design, shrunk.aside, 64, 8);
    expect(grown.design.entities).toEqual(start.entities);
  });
});

describe("finishing with a held field", () => {
  it("commits on Enter as well as on blur", () => {
    expect(held(12, [...retype("64"), { type: "commit" }]).committed).toEqual([
      64,
    ]);
  });

  it("abandons the edit on Escape", () => {
    const field = held(12, [...retype("64"), { type: "revert" }]);
    expect(field.committed).toEqual([]);
    expect(field.text).toBe("12");
  });

  it("restores the value behind a field left empty", () => {
    const field = held(12, [{ type: "type", raw: "" }, { type: "commit" }]);
    expect(field.committed).toEqual([]);
    expect(field.text).toBe("12");
  });

  it("restores the value behind typing outside the range", () => {
    const below = held(12, [...retype("2"), { type: "commit" }]);
    expect(below.committed).toEqual([]);
    expect(below.text).toBe("12");
    const above = held(12, [...retype("400"), { type: "commit" }]);
    expect(above.committed).toEqual([]);
    expect(above.text).toBe("12");
  });

  it("commits nothing when the typing names the value already held", () => {
    const field = held(12, [...retype("12"), { type: "commit" }]);
    expect(field.committed).toEqual([]);
  });

  it("commits nothing when the field was never typed into", () => {
    expect(held(12, [{ type: "commit" }]).committed).toEqual([]);
  });

  it("holds whatever is typed, including text on the way to nothing usable", () => {
    const field = held(12, [{ type: "type", raw: "6" }]);
    expect(field.committed).toEqual([]);
    expect(field.text).toBe("6");
  });
});
