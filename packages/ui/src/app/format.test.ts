import { describe, expect, it } from "vitest";
import { formatTimeAgo, formatUsdExact } from "./format";

describe("formatUsdExact", () => {
  it("renders full dollars and cents with exactly two decimals", () => {
    expect(formatUsdExact(48230.55)).toBe("$48,230.55");
    expect(formatUsdExact(1_204_000)).toBe("$1,204,000.00");
    expect(formatUsdExact(48.2)).toBe("$48.20");
    expect(formatUsdExact(0)).toBe("$0.00");
    expect(formatUsdExact(0.004)).toBe("$0.00");
  });

  it("renders an unknown figure as an em dash", () => {
    expect(formatUsdExact(null)).toBe("—");
  });
});

describe("formatTimeAgo", () => {
  const now = new Date("2026-08-26T12:00:00Z");

  it("names the largest whole unit of the distance", () => {
    expect(formatTimeAgo("2026-08-26T11:59:30Z", now)).toBe("just now");
    expect(formatTimeAgo("2026-08-26T11:15:00Z", now)).toBe("45m ago");
    expect(formatTimeAgo("2026-08-26T04:00:00Z", now)).toBe("8h ago");
    expect(formatTimeAgo("2026-08-23T12:00:00Z", now)).toBe("3d ago");
    expect(formatTimeAgo("2026-06-01T12:00:00Z", now)).toBe("2mo ago");
    expect(formatTimeAgo("2024-08-01T12:00:00Z", now)).toBe("2y ago");
  });

  it("clamps a future timestamp to just now rather than counting backwards", () => {
    expect(formatTimeAgo("2026-08-26T13:00:00Z", now)).toBe("just now");
  });

  it("renders an unparseable timestamp as an em dash", () => {
    expect(formatTimeAgo("not-a-date", now)).toBe("—");
  });
});
