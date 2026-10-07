import { describe, expect, it } from "vitest";
import { ABSENT, formatFieldValue } from "./cells";

// A cell's formatting is chosen by field name, because a bare number carries no
// unit. The rules that matter are that every `*Seconds` field reads as a
// duration, and that an absent value reads as an em dash rather than as `0`.
describe("formatFieldValue", () => {
  it("reads every duration field as a duration", () => {
    // The stage durations are the fields a question about the model asks, so a
    // rule keyed to the run's own duration alone would print them as raw
    // numbers — `270` where the reader needs `4m 30s`.
    expect(formatFieldValue("metric.runTimeSeconds", 900)).toBe("15m 00s");
    expect(formatFieldValue("metric.sessionSeconds", 270)).toBe("4m 30s");
    expect(formatFieldValue("metric.setupSeconds", 3900)).toBe("1h 05m");
    expect(formatFieldValue("metric.teardownSeconds", 30)).toBe("30s");
    expect(formatFieldValue("metric.validationSeconds", 45)).toBe("45s");
  });

  it("keeps the units apart", () => {
    expect(formatFieldValue("metric.totalTokens", 1800)).toBe("1.8K");
    expect(formatFieldValue("metric.cost", 1.5)).toBe("$1.50");
  });

  it("renders an absent value as an em dash", () => {
    // A run that recorded no session duration has no field at all, and printing
    // `0s` would read as a session that finished instantly.
    expect(formatFieldValue("metric.sessionSeconds", undefined)).toBe(ABSENT);
  });
});
