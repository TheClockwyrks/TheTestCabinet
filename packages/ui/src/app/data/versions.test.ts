import { describe, expect, it } from "vitest";
import {
  compareVersions,
  currentMajorMinor,
  majorMinorKey,
  parseVersion,
  versionKey,
} from "./versions";

describe("parseVersion", () => {
  it("reads the three numeric parts, with or without the leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual({
      major: 1,
      minor: 2,
      revision: 3,
    });
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, revision: 3 });
  });

  it("returns null for anything that is not major.minor.revision", () => {
    // Strict on purpose: a caller falls back to an exact string compare, so a
    // malformed value only ever matches its own kind.
    expect(parseVersion("v1.2")).toBeNull();
    expect(parseVersion("draft")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("versionKey", () => {
  it("splits into numeric components, ignoring a leading v", () => {
    expect(versionKey("v1.2.3")).toEqual([1, 2, 3]);
    expect(versionKey("2.0.0")).toEqual([2, 0, 0]);
  });

  it("ignores a non-numeric tail and reads a digitless component as 0", () => {
    // Mirrors the Rust catalog's `version_key`, tolerance included, so both hosts
    // of a run listing agree on every input.
    expect(versionKey("v1.2.0-rc1")).toEqual([1, 2, 0]);
    expect(versionKey("draft")).toEqual([0]);
  });
});

describe("compareVersions", () => {
  it("orders component-wise, not lexically", () => {
    // The whole point: a string compare puts v1.10.0 before v1.9.0.
    expect(compareVersions("v1.9.0", "v1.10.0")).toBeLessThan(0);
    expect(compareVersions("v2.0.0", "v1.99.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.0", "v1.2.0")).toBe(0);
  });

  it("sorts oldest-first as an Array#sort comparator", () => {
    const versions = ["v1.10.0", "v1.2.0", "v2.0.0", "v1.9.0"];
    expect([...versions].sort(compareVersions)).toEqual([
      "v1.2.0",
      "v1.9.0",
      "v1.10.0",
      "v2.0.0",
    ]);
  });
});

describe("majorMinorKey", () => {
  it("collapses revisions of one minor onto a single key", () => {
    expect(majorMinorKey("v1.2.0")).toBe(majorMinorKey("v1.2.7"));
    expect(majorMinorKey("v1.2.0")).not.toBe(majorMinorKey("v1.3.0"));
    expect(majorMinorKey("v1.2.0")).not.toBe(majorMinorKey("v2.2.0"));
  });
});

describe("currentMajorMinor", () => {
  it("picks the greatest major.minor present", () => {
    expect(currentMajorMinor(["v1.0.0", "v1.2.1", "v1.2.0"])).toBe(
      majorMinorKey("v1.2.0"),
    );
    expect(currentMajorMinor(["v1.9.0", "v1.10.0"])).toBe(
      majorMinorKey("v1.10.0"),
    );
    expect(currentMajorMinor(["v1.99.0", "v2.0.0"])).toBe(
      majorMinorKey("v2.0.0"),
    );
  });

  it("is null for an empty set", () => {
    expect(currentMajorMinor([])).toBeNull();
  });
});
