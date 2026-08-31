import { describe, expect, it } from "vitest";
import { TICK_DT } from "../constants";
import { countDown, intervalTicks, isDue } from "./timers";

describe("timers", () => {
  it("is due round(s × TICK_HZ) ticks after it was set", () => {
    for (const seconds of [0.5, 1.35, 0.3, 0.2, 2.5, 0.25, 1 / 60]) {
      let timer = seconds;
      let ticks = 0;
      do {
        timer = countDown(timer);
        ticks += 1;
      } while (!isDue(timer));
      expect(ticks).toBe(intervalTicks(seconds));
    }
  });

  it("holds at zero and stays due", () => {
    expect(countDown(0)).toBe(0);
    expect(isDue(countDown(0))).toBe(true);
    expect(countDown(TICK_DT / 2 - 1e-9 + TICK_DT)).toBe(0);
    expect(countDown(TICK_DT / 2 + 1e-6 + TICK_DT)).toBeCloseTo(
      TICK_DT / 2 + 1e-6,
      12,
    );
  });

  it("counts an interval in whole ticks", () => {
    expect(intervalTicks(0.5)).toBe(30);
    expect(intervalTicks(1.35)).toBe(81);
    expect(intervalTicks(0.3)).toBe(18);
  });
});
