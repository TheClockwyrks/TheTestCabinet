import { describe, expect, it } from "vitest";

import { createPart } from "./machine";
import {
  lengthRun,
  repeatExpansion,
  resetExpansion,
  restWalk,
  rotationRun,
  trackRun,
  walkTape,
  type TrackPath,
} from "./macros";
import type { PartState, TapeCell, W } from "./types";

/** An arm at a rest pose, carrying `tape`. */
function arm(
  rotation: number,
  length: number,
  tape: TapeCell[] = [],
  q = 0,
  r = 0,
): W<PartState> {
  return createPart(1, "arm", q, r, rotation, { length, tape });
}

/** A straight open path of `count` cells along `r = 0`, from `(0, 0)`. */
function line(count: number, closed = false): TrackPath {
  return {
    cells: Array.from({ length: count }, (_unused, q) => ({ q, r: 0 })),
    closed,
  };
}

describe("the reset walk (specs/instructions.md)", () => {
  it("starts from the placed rest pose", () => {
    expect(restWalk(arm(3, 2), null)).toEqual({
      rotation: 3,
      length: 2,
      cell: -1,
    });
    expect(walkTape(arm(3, 2, ["rotate-cw"]), null, 1).rotation).toBe(4);
  });

  it("steps rotation in both directions, modulo six", () => {
    expect(walkTape(arm(0, 1, ["rotate-ccw"]), null, 1).rotation).toBe(5);
    expect(
      walkTape(arm(5, 1, ["rotate-cw", "rotate-cw"]), null, 2).rotation,
    ).toBe(1);
  });

  it("moves nothing for grab, drop, and the two pivots", () => {
    const walked = walkTape(
      arm(2, 2, ["grab", "drop", "pivot-cw", "pivot-ccw"]),
      line(3),
      4,
    );
    expect(walked).toEqual({ rotation: 2, length: 2, cell: 0 });
  });

  it("clamps the length at both bounds rather than faulting", () => {
    expect(walkTape(arm(0, 3, ["extend"]), null, 1).length).toBe(3);
    expect(walkTape(arm(0, 1, ["retract"]), null, 1).length).toBe(1);
    expect(walkTape(arm(0, 1, ["extend", "extend"]), null, 2).length).toBe(3);
  });

  it("wraps a closed track and stops at an open track's ends", () => {
    const closed = line(4, true);
    const at3 = createPart(1, "arm", 3, 0, 0, { tape: ["advance"] });
    expect(walkTape(at3, closed, 1).cell).toBe(0);
    const at0 = createPart(1, "arm", 0, 0, 0, { tape: ["recede"] });
    expect(walkTape(at0, closed, 1).cell).toBe(3);
    expect(walkTape(at3, line(4), 1).cell).toBe(3);
    expect(walkTape(at0, line(4), 1).cell).toBe(0);
  });

  it("reads only the cells before the cursor", () => {
    const tape: TapeCell[] = ["rotate-cw", "rotate-cw", "rotate-cw"];
    expect(walkTape(arm(0, 1, tape), null, 1).rotation).toBe(1);
    expect(walkTape(arm(0, 1, tape), null, 3).rotation).toBe(3);
  });
});

describe("the three runs reset writes (specs/instructions.md)", () => {
  it("rotates the shorter way, and clockwise on a tie", () => {
    expect(rotationRun(4, 0)).toEqual(["rotate-cw", "rotate-cw"]);
    expect(rotationRun(1, 0)).toEqual(["rotate-ccw"]);
    expect(rotationRun(3, 0)).toEqual(["rotate-cw", "rotate-cw", "rotate-cw"]);
    expect(rotationRun(2, 2)).toEqual([]);
  });

  it("retracts above the rest length and extends below it", () => {
    expect(lengthRun(3, 1)).toEqual(["retract", "retract"]);
    expect(lengthRun(1, 3)).toEqual(["extend", "extend"]);
    expect(lengthRun(2, 2)).toEqual([]);
  });

  it("runs an open track without passing either end", () => {
    expect(trackRun(0, 3, line(5))).toEqual(["advance", "advance", "advance"]);
    expect(trackRun(4, 2, line(5))).toEqual(["recede", "recede"]);
    expect(trackRun(2, 2, line(5))).toEqual([]);
  });

  it("counts a closed track's run through the join, ties to advance", () => {
    const loop = line(6, true);
    expect(trackRun(5, 0, loop)).toEqual(["advance"]);
    expect(trackRun(0, 5, loop)).toEqual(["recede"]);
    expect(trackRun(0, 3, loop)).toEqual(["advance", "advance", "advance"]);
  });

  it("writes no track run without a track", () => {
    expect(trackRun(-1, -1, null)).toEqual([]);
  });
});

describe("the reset expansion (specs/instructions.md)", () => {
  it("writes drop alone for an arm already at rest", () => {
    expect(resetExpansion(arm(2, 2), null, 0)).toEqual(["drop"]);
  });

  it("writes drop first, whatever the walk reached", () => {
    const walked = arm(0, 1, ["rotate-cw", "extend"]);
    expect(resetExpansion(walked, null, 2)[0]).toBe("drop");
  });

  it("writes its four groups in order", () => {
    const track = line(4);
    const part = createPart(1, "arm", 1, 0, 2, {
      length: 1,
      tape: ["extend", "extend", "rotate-cw", "advance"],
    });
    expect(resetExpansion(part, track, 4)).toEqual([
      "drop",
      "retract",
      "retract",
      "rotate-ccw",
      "recede",
    ]);
  });

  it("returns the arm from the walked length, faults ignored", () => {
    // `extend` on a plain arm would fault the run; the walk still steps.
    const part = arm(0, 1, ["extend"]);
    expect(resetExpansion(part, null, 1)).toEqual(["drop", "retract"]);
  });

  it("writes the rotation run alone on a wheel", () => {
    const wheel = createPart(1, "wheel", 0, 0, 0, {
      tape: ["rotate-cw", "rotate-cw"],
    });
    expect(resetExpansion(wheel, null, 2)).toEqual([
      "rotate-ccw",
      "rotate-ccw",
    ]);
  });

  it("writes nothing on a wheel already at its rest rotation", () => {
    const wheel = createPart(1, "wheel", 0, 0, 3, { tape: ["grab"] });
    expect(resetExpansion(wheel, null, 1)).toEqual([]);
  });
});

describe("the repeat expansion (specs/instructions.md)", () => {
  it("copies the cells before the cursor, blanks included", () => {
    const part = arm(0, 1, ["grab", null, "drop"]);
    expect(repeatExpansion(part, 3)).toEqual(["grab", null, "drop"]);
  });

  it("copies a cell at or past the tape's end as a blank", () => {
    const part = arm(0, 1, ["grab", "drop"]);
    expect(repeatExpansion(part, 5)).toEqual([
      "grab",
      "drop",
      null,
      null,
      null,
    ]);
  });

  it("writes nothing at cell 0", () => {
    expect(repeatExpansion(arm(0, 1, ["grab"]), 0)).toEqual([]);
  });
});
