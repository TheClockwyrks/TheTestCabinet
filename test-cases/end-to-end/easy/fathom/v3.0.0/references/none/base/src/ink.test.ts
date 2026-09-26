import { describe, expect, it } from "vitest";

import { INK_LIFE, INK_RADIUS, TICK_DT } from "./constants";
import { InkField, segmentDistance } from "./ink";

describe("segmentDistance", () => {
  it("measures to the nearest point of the segment", () => {
    expect(segmentDistance(0, 10, -100, 0, 100, 0)).toBeCloseTo(10, 9);
  });

  it("measures to an endpoint when the foot lies outside the segment", () => {
    expect(segmentDistance(-30, 0, 0, 0, 100, 0)).toBeCloseTo(30, 9);
  });

  it("measures to the point when the segment has no length", () => {
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 9);
  });
});

describe("InkField", () => {
  it("stands for its whole life and then dissipates", () => {
    const ink = new InkField();
    ink.release(200, 200);
    expect(ink.all).toHaveLength(1);
    expect(ink.all[0].radius).toBe(INK_RADIUS);
    expect(ink.all[0].remaining).toBeCloseTo(INK_LIFE, 9);

    const ticks = Math.ceil(INK_LIFE / TICK_DT);
    for (let i = 0; i < ticks - 2; i++) ink.update(TICK_DT);
    expect(ink.all).toHaveLength(1);
    for (let i = 0; i < 4; i++) ink.update(TICK_DT);
    expect(ink.all).toHaveLength(0);
  });

  it("stays where it was released rather than following anything", () => {
    const ink = new InkField();
    ink.release(400, 300);
    ink.update(TICK_DT * 60);
    expect(ink.all[0].x).toBe(400);
    expect(ink.all[0].y).toBe(300);
  });

  it("covers points inside its radius and not beyond it", () => {
    const ink = new InkField();
    ink.release(400, 300);
    expect(ink.covers(400, 300)).toBe(true);
    expect(ink.covers(400 + INK_RADIUS - 1, 300)).toBe(true);
    expect(ink.covers(400 + INK_RADIUS + 1, 300)).toBe(false);
  });

  it("blocks a line that passes within its radius of the cloud", () => {
    const ink = new InkField();
    ink.release(400, 300);
    expect(ink.crosses(100, 300, 700, 300)).toBe(true);
    expect(
      ink.crosses(100, 300 + INK_RADIUS + 1, 700, 300 + INK_RADIUS + 1),
    ).toBe(false);
  });

  it("leaves a line whose nearest approach is past its end alone", () => {
    const ink = new InkField();
    ink.release(400, 300);
    expect(ink.crosses(100, 300, 200, 300)).toBe(false);
  });

  it("forgets every cloud when cleared", () => {
    const ink = new InkField();
    ink.release(400, 300);
    ink.release(500, 300);
    ink.clear();
    expect(ink.all).toHaveLength(0);
    expect(ink.covers(400, 300)).toBe(false);
  });
});
