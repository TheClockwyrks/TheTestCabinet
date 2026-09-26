// The rules behind the staged board-size control.
//
// These are the decisions the control makes without a DOM: whether the fields agree
// with the board, whether Apply may run, and what a resize has to say before it
// runs. The wiring — that nothing BUT Apply can reach the resize — is pinned by the
// component test beside this file, because that is a wiring property, not a rule.

import { describe, expect, it } from "vitest";
import { count, readBoardDraft, resizeQuestion } from "./boardDraft";
import { resizeBoard, type Design, type DesignEntity } from "../model";

const GRID = { width: 12, height: 8 };

function belt(x: number): DesignEntity {
  return { type: "belt", x, y: 1, dir: "E", tier: "fast" };
}

describe("reading the staged pair", () => {
  it("is not pending, and applies nothing, while it mirrors the board", () => {
    const state = readBoardDraft({ width: "12", height: "8" }, GRID);
    expect(state.pending).toBe(false);
    expect(state.apply).toBeNull();
    expect(state.blocked).toBe("The board is already 12×8.");
  });

  it("is pending the moment a field says something else", () => {
    const state = readBoardDraft({ width: "6", height: "8" }, GRID);
    expect(state.pending).toBe(true);
    expect(state.apply).toEqual({ width: 6, height: 8 });
    expect(state.blocked).toBeNull();
  });

  it("refuses a half-typed field and says why, without abandoning the typing", () => {
    // The state a field passes through on the way from 12 to 64: cleared. It must
    // block Apply and it must NOT be read as a size of its own.
    const cleared = readBoardDraft({ width: "", height: "8" }, GRID);
    expect(cleared.pending).toBe(true);
    expect(cleared.apply).toBeNull();
    expect(cleared.blocked).toBe("Board width is required.");
  });

  it("refuses a dimension outside the board's range", () => {
    expect(readBoardDraft({ width: "2", height: "8" }, GRID).blocked).toBe(
      "Board width must be 4 or more.",
    );
    expect(readBoardDraft({ width: "12", height: "900" }, GRID).blocked).toBe(
      "Board height must be 120 or less.",
    );
  });

  it("treats a re-typed but identical size as nothing to apply", () => {
    const state = readBoardDraft({ width: "012", height: "8" }, GRID);
    expect(state.pending).toBe(true);
    expect(state.apply).toBeNull();
    expect(state.blocked).toBe("The board is already 12×8.");
  });
});

describe("the question a resize has to ask", () => {
  const design: Design = {
    grid: GRID,
    entities: [belt(2), belt(7), belt(9)],
  };

  it("asks nothing when nothing leaves the board", () => {
    const plan = resizeBoard(design, [], 20, 8);
    expect(plan.setAside).toBe(0);
    expect(resizeQuestion({ width: 20, height: 8 }, plan)).toBeNull();
  });

  it("states the count, the fate, and that the file will not hold them", () => {
    const plan = resizeBoard(design, [], 6, 8);
    const question = resizeQuestion({ width: 6, height: 8 }, plan);
    expect(question).not.toBeNull();
    expect(question!.title).toBe("Resize to 6×8?");
    expect(question!.message).toContain("2 components");
    const all = question!.details.join(" ");
    expect(all).toContain("2 components");
    expect(all).toContain("taken off the board");
    expect(all).toContain("NOT deleted");
    // The part a user cannot be allowed to discover from the saved file instead.
    expect(all).toContain("Save and Export do not write");
  });

  it("asks nothing for a shrink that takes nothing further off the board", () => {
    const shrunk = resizeBoard(design, [], 6, 8);
    const narrower = resizeBoard(shrunk.design, shrunk.aside, 4, 8);
    expect(narrower.setAside).toBe(0);
    expect(resizeQuestion({ width: 4, height: 8 }, narrower)).toBeNull();
  });

  it("mentions what a resize brings back alongside what it takes", () => {
    const shrunk = resizeBoard(design, [], 6, 8);
    // Wider but shorter: the two set-aside belts fit again, and the one standing
    // at the bottom of the board does not.
    const tall: Design = {
      grid: { width: 6, height: 8 },
      entities: [{ type: "belt", x: 2, y: 6, dir: "E", tier: "fast" }],
    };
    const both = resizeBoard(tall, shrunk.aside, 12, 4);
    expect(both.setAside).toBe(1);
    expect(both.restored).toBe(2);
    const question = resizeQuestion({ width: 12, height: 4 }, both);
    expect(question).not.toBeNull();
    expect(question!.message).toContain("1 component ");
    expect(question!.details.join(" ")).toContain("2 components");
    expect(question!.details.join(" ")).toContain("would come back");
  });
});

describe("counting", () => {
  it("agrees with itself about the plural", () => {
    expect(count(1, "component")).toBe("1 component");
    expect(count(2, "component")).toBe("2 components");
  });
});
