import { describe, expect, it } from "vitest";

import {
  clonePart,
  cloneMachine,
  createPart,
  findPart,
  machinePeriod,
  tapeCellAt,
  tapeLength,
  tapeRowIndex,
  tapeRows,
  trimTape,
  writeTapeCell,
} from "./machine";

describe("building a part (specs/state.md `PartState`)", () => {
  it("rests every field the part's class does not use at null", () => {
    const arm = createPart(1, "arm", 1, 2, 3);
    expect(arm).toEqual({
      id: 1,
      kind: "arm",
      q: 1,
      r: 2,
      rotation: 3,
      length: 1,
      cells: null,
      closed: null,
      index: null,
      tape: [],
    });
  });

  it("mirrors a track's anchor from the first cell of its path", () => {
    const track = createPart(2, "track", 9, 9, 4, {
      cells: [
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
    });
    expect(track.q).toBe(1);
    expect(track.r).toBe(0);
    expect(track.rotation).toBe(0);
    expect(track.closed).toBe(false);
  });

  it("gives a sigil no tape and a rise its index", () => {
    expect(createPart(3, "bind", 0, 0, 0).tape).toBeNull();
    expect(createPart(4, "rise", 0, 0, 0, { index: 2 }).index).toBe(2);
    expect(createPart(5, "wheel", 0, 0, 0, { length: 3 }).length).toBe(1);
  });

  it("copies a machine so an undo entry shares nothing with it", () => {
    const original = [
      createPart(1, "track", 0, 0, 0, { cells: [{ q: 0, r: 0 }] }),
      createPart(2, "arm", 1, 0, 0, { tape: ["grab"] }),
    ];
    const copy = cloneMachine(original);
    copy[0].cells?.push({ q: 1, r: 0 });
    copy[1].tape?.push("drop");
    expect(original[0].cells).toHaveLength(1);
    expect(original[1].tape).toEqual(["grab"]);
    expect(clonePart(original[1])).toEqual(original[1]);
  });
});

describe("tapes and the period (specs/instructions.md)", () => {
  it("trims the trailing blanks, so an all-blank tape is empty", () => {
    expect(trimTape(["grab", null, null])).toEqual(["grab"]);
    expect(trimTape([null, null])).toEqual([]);
    expect(trimTape([null, "drop"])).toEqual([null, "drop"]);
  });

  it("measures a tape by its last non-blank cell", () => {
    expect(tapeLength(["grab", null, "drop"])).toBe(3);
    expect(tapeLength([])).toBe(0);
    expect(tapeLength(null)).toBe(0);
  });

  it("takes the period as the longest tape, and 1 when every tape is empty", () => {
    const arm = createPart(1, "arm", 0, 0, 0, { tape: ["grab", "drop"] });
    const wheel = createPart(2, "wheel", 2, 0, 0, {
      tape: ["rotate-cw", null, "rotate-cw"],
    });
    const sigil = createPart(3, "bind", 4, 0, 0);
    expect(machinePeriod([arm, wheel, sigil])).toBe(3);
    expect(machinePeriod([sigil])).toBe(1);
    expect(machinePeriod([])).toBe(1);
  });

  it("reads cell c mod P, and a cell past a tape's own end as a blank", () => {
    const tape = ["grab", "drop"] as const;
    expect(tapeCellAt([...tape], 0, 4)).toBe("grab");
    expect(tapeCellAt([...tape], 5, 4)).toBe("drop");
    expect(tapeCellAt([...tape], 2, 4)).toBeNull();
    expect(tapeCellAt(null, 0, 4)).toBeNull();
  });

  it("fills the gap with blanks when a write lands past the end", () => {
    expect(writeTapeCell([], 3, "grab")).toEqual([null, null, null, "grab"]);
    expect(writeTapeCell(["grab", "drop"], 1, null)).toEqual(["grab"]);
    expect(writeTapeCell(null, 0, "advance")).toEqual(["advance"]);
  });

  it("lists the arms and wheels in placement order as the panel's rows", () => {
    const machine = [
      createPart(1, "bind", 0, 0, 0),
      createPart(2, "arm", 1, 0, 0),
      createPart(3, "wheel", 3, 0, 0),
    ];
    expect(tapeRows(machine).map((part) => part.id)).toEqual([2, 3]);
    expect(tapeRowIndex(machine, 3)).toBe(1);
    expect(tapeRowIndex(machine, 1)).toBe(-1);
    expect(findPart(machine, 2)?.kind).toBe("arm");
    expect(findPart(machine, 9)).toBeNull();
  });
});
