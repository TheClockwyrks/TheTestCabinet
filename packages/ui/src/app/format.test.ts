import { describe, expect, it } from "vitest";
import { formatTimeAgo, formatUsdCompact } from "./format";

describe("formatUsdCompact", () => {
  it("compacts large figures to one significant decimal", () => {
    expect(formatUsdCompact(48230.55)).toBe("$48.2K");
    expect(formatUsdCompact(1_204_000)).toBe("$1.2M");
    expect(formatUsdCompact(91_250_000_000)).toBe("$91.3B");
  });

  it("keeps sub-thousand figures uncompacted", () => {
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(950)).toBe("$950");
    expect(formatUsdCompact(48.23)).toBe("$48.2");
  });

  it("renders an unknown figure as an em dash", () => {
    expect(formatUsdCompact(null)).toBe("—");
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
