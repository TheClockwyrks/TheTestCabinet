import { describe, expect, it } from "vitest";

import { FIELD_CX, FIELD_CY, FIELD_R, HEX_PITCH } from "./constants";
import { DIR_OFFSETS } from "./figures";
import {
  adjacent,
  fieldHexes,
  hexAt,
  hexDistance,
  hexX,
  hexY,
  neighbor,
  onField,
  readingOrder,
  rotateAbout,
  rotateCCW,
  rotateCW,
  rotateHex,
  wrapDir,
} from "./hex";

describe("the hex geometry of specs/field.md", () => {
  it("anchors hex (0, 0) at the field center", () => {
    expect(hexX(0, 0)).toBe(FIELD_CX);
    expect(hexY(0, 0)).toBe(FIELD_CY);
  });

  it("spaces adjacent centers one HEX_PITCH apart", () => {
    for (const dir of DIR_OFFSETS) {
      const dx = hexX(dir.q, dir.r) - hexX(0, 0);
      const dy = hexY(dir.q, dir.r) - hexY(0, 0);
      expect(Math.hypot(dx, dy)).toBeCloseTo(HEX_PITCH, 10);
    }
  });

  it("holds 91 hexes spanning the stage extents specs/field.md states", () => {
    const cells = fieldHexes();
    expect(cells).toHaveLength(91);
    const xs = cells.map((cell) => hexX(cell.q, cell.r));
    const ys = cells.map((cell) => hexY(cell.q, cell.r));
    expect(Math.min(...xs)).toBeCloseTo(376, 6);
    expect(Math.max(...xs)).toBeCloseTo(856, 6);
    expect(Math.min(...ys)).toBeCloseTo(96.15, 2);
    expect(Math.max(...ys)).toBeCloseTo(511.85, 2);
  });

  it("bounds the field by max(|q|, |r|, |q + r|) <= FIELD_R", () => {
    expect(onField(FIELD_R, 0)).toBe(true);
    expect(onField(FIELD_R + 1, 0)).toBe(false);
    expect(onField(-3, -3)).toBe(false);
    expect(onField(-5, 5)).toBe(true);
  });

  it("lists the field in reading order: ascending r, then ascending q", () => {
    const cells = fieldHexes();
    for (let i = 1; i < cells.length; i += 1) {
      expect(readingOrder(cells[i - 1], cells[i])).toBeLessThan(0);
    }
  });

  it("turns a direction index clockwise by rotating its offset", () => {
    for (let dir = 0; dir < 6; dir += 1) {
      expect(rotateHex(DIR_OFFSETS[dir], 1)).toEqual(
        DIR_OFFSETS[wrapDir(dir + 1)],
      );
      expect(rotateHex(DIR_OFFSETS[dir], -1)).toEqual(
        DIR_OFFSETS[wrapDir(dir - 1)],
      );
    }
  });

  it("returns an offset to itself after six clockwise steps", () => {
    expect(rotateHex({ q: 2, r: -1 }, 6)).toEqual({ q: 2, r: -1 });
  });

  it("rotates about an arbitrary hex by rotating the offset from it", () => {
    const center = { q: 1, r: 1 };
    expect(rotateAbout({ q: 2, r: 1 }, center, 1)).toEqual({ q: 1, r: 2 });
    expect(rotateAbout(center, center, 3)).toEqual(center);
  });

  it("measures adjacency over the axial metric", () => {
    expect(adjacent({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(adjacent({ q: 0, r: 0 }, { q: 1, r: 1 })).toBe(false);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    expect(neighbor({ q: 0, r: 0 }, 7)).toEqual(DIR_OFFSETS[1]);
  });
});

describe("targeting a hex with the pointer (specs/field.md)", () => {
  it("takes the nearest center within HEX_HIT_R", () => {
    expect(hexAt(hexX(1, -1), hexY(1, -1))).toEqual({ q: 1, r: -1 });
    expect(hexAt(hexX(0, 0) + 20, hexY(0, 0))).toEqual({ q: 0, r: 0 });
  });

  it("targets nothing beyond HEX_HIT_R of every center", () => {
    // The gap between three hex centers, further than HEX_HIT_R from each.
    const x = (hexX(0, 0) + hexX(1, 0) + hexX(0, 1)) / 3;
    const y = (hexY(0, 0) + hexY(1, 0) + hexY(0, 1)) / 3;
    expect(hexAt(x, y)).toBeNull();
    expect(hexAt(0, 0)).toBeNull();
  });

  it("targets nothing off the field", () => {
    expect(hexAt(hexX(6, 0), hexY(6, 0))).toBeNull();
  });

  it("breaks a tie by the smaller r, then the smaller q", () => {
    const between = (a: { q: number; r: number }, b: typeof a) => ({
      x: (hexX(a.q, a.r) + hexX(b.q, b.r)) / 2,
      y: (hexY(a.q, a.r) + hexY(b.q, b.r)) / 2,
    });
    const east = between({ q: 0, r: 0 }, { q: 1, r: 0 });
    expect(hexAt(east.x, east.y)).toEqual({ q: 0, r: 0 });
    const southeast = between({ q: 0, r: 0 }, { q: 0, r: 1 });
    expect(hexAt(southeast.x, southeast.y)).toEqual({ q: 0, r: 0 });
  });
});

describe("the two rotation formulas (specs/field.md)", () => {
  it("turns an offset clockwise by (q, r) -> (-r, q + r)", () => {
    expect(rotateCW({ q: 1, r: 0 })).toEqual({ q: 0, r: 1 });
    expect(rotateCW({ q: 2, r: -1 })).toEqual({ q: 1, r: 1 });
  });

  it("turns an offset counterclockwise by (q, r) -> (q + r, -q)", () => {
    expect(rotateCCW({ q: 0, r: 1 })).toEqual({ q: 1, r: 0 });
    expect(rotateCCW({ q: 1, r: 1 })).toEqual({ q: 2, r: -1 });
  });

  it("reaches the same cell whichever way round the turn is taken", () => {
    for (const offset of [
      { q: 1, r: 0 },
      { q: 2, r: -1 },
      { q: -3, r: 1 },
    ]) {
      for (let steps = 0; steps < 6; steps += 1) {
        let byCW = offset;
        for (let i = 0; i < steps; i += 1) byCW = rotateCW(byCW);
        expect(rotateHex(offset, steps)).toEqual(byCW);
      }
    }
  });

  it("counts a direction index the same way", () => {
    expect(wrapDir(0 - 1)).toBe(5);
    expect(wrapDir(5 + 1)).toBe(0);
  });
});
