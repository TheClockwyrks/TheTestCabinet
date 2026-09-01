import { describe, expect, it } from "vitest";
import { CODE_METRICS } from "@test-cabinet/run-record/code-metrics";
import {
  codeFigureFamilies,
  codeMetric,
  familyHeading,
  formatCodeBytes,
  formatCodeNumber,
  formatMetricValue,
  isApproximate,
  lookupMetric,
} from "./codeFormat";

describe("the metric catalog", () => {
  // R11's mitigation is that the approximate label is a **data field**, so the picker,
  // the axis, the table header and the docs page cannot disagree. These two assertions
  // are what make that true of this app: the flag is read from the generated catalog,
  // never asserted in the UI, so flipping it in the analyzer flips it here.
  it("reports the reference-counting figures as approximate", () => {
    expect(isApproximate("api.unreferencedExports")).toBe(true);
    expect(isApproximate("api.unreferencedExportRatio")).toBe(true);
    expect(isApproximate("graph.orphans")).toBe(true);
  });

  it("reports a directly counted figure as exact", () => {
    expect(isApproximate("size.files")).toBe(false);
    expect(isApproximate("complexity.maxCyclomatic")).toBe(false);
  });

  // An unknown path is not approximate: marking everything unknown as approximate
  // would put a caveat on figures that do not need one and devalue the marker where it
  // is real.
  it("treats an unknown path as exact and unlabelled", () => {
    expect(codeMetric("nope.not.a.metric")).toBeUndefined();
    expect(isApproximate("nope.not.a.metric")).toBe(false);
  });

  it("carries the analyzer's own label and unit", () => {
    expect(codeMetric("size.giniCodeLines")).toMatchObject({
      label: "Size Gini",
      unit: "ratio",
      family: "size",
    });
  });
});

describe("formatMetricValue", () => {
  it("renders each unit the way the CLI report does", () => {
    expect(formatMetricValue(66258, "count")).toBe("66,258");
    expect(formatMetricValue(2.4444, "score")).toBe("2.4");
    expect(formatMetricValue(0.6213, "ratio")).toBe("62.1%");
    expect(formatMetricValue(3.14159, "perKiloLine")).toBe("3.1/kloc");
    expect(formatMetricValue(2048, "bytes")).toBe("2.0 KiB");
    expect(formatMetricValue(true, "boolean")).toBe("yes");
    expect(formatMetricValue(false, "boolean")).toBe("no");
  });

  // A catalog/summary mismatch must stay off the page rather than rendering `null` at
  // the reader.
  it("declines a value its unit cannot describe", () => {
    expect(formatMetricValue("many", "count")).toBeNull();
    expect(formatMetricValue(1, "boolean")).toBeNull();
    expect(formatMetricValue(undefined, "count")).toBeNull();
    expect(formatMetricValue(Number.NaN, "score")).toBeNull();
  });

  it("keeps a whole number whole and a mean fractional", () => {
    expect(formatCodeNumber(1200)).toBe("1,200");
    expect(formatCodeNumber(4.06)).toBe("4.1");
    expect(formatCodeBytes(512)).toBe("512 B");
    expect(formatCodeBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
  });
});

describe("lookupMetric", () => {
  it("resolves a dotted path", () => {
    expect(lookupMetric({ size: { files: 12 } }, "size.files")).toBe(12);
  });

  // A missing key and an explicit null are the same answer, because that is exactly
  // what an absent language block looks like: a pure-Rust tree carries no `typescript`
  // block, and "TypeScript files: 0" for it would be noise dressed as a measurement.
  it("treats an absent block and an explicit null alike", () => {
    expect(
      lookupMetric({ typescript: null }, "typescript.files"),
    ).toBeUndefined();
    expect(lookupMetric({}, "typescript.files")).toBeUndefined();
  });
});

describe("codeFigureFamilies", () => {
  const summary = {
    analyzerVersion: 1,
    size: { files: 3, codeLines: 120 },
    api: { exports: 4, unreferencedExports: 1 },
    // Absent, as a pure-Rust tree's would be.
    typescript: null,
  };

  it("groups figures by family, in catalog order", () => {
    const families = codeFigureFamilies(summary).map((f) => f.family);
    expect(families).toEqual(["provenance", "size", "api"]);
  });

  it("omits a family the tree has no values for", () => {
    expect(codeFigureFamilies(summary).map((f) => f.family)).not.toContain(
      "typescript",
    );
  });

  it("carries the approximate flag through to the rendered figure", () => {
    const api = codeFigureFamilies(summary).find((f) => f.family === "api")!;
    expect(api.figures.find((f) => f.path === "api.exports")?.approximate).toBe(
      false,
    );
    expect(
      api.figures.find((f) => f.path === "api.unreferencedExports")
        ?.approximate,
    ).toBe(true);
  });

  it("names a family the way the CLI report does, and passes an unknown one through", () => {
    expect(familyHeading("graph")).toBe("Module graph");
    expect(familyHeading("brand-new")).toBe("brand-new");
  });
});

describe("familyHeading", () => {
  // The walk's diagnostics — what it truncated, what it skipped, what it refused — were
  // headed "Coverage", which they never were. The heading collided with the console's
  // Coverage feature area and, now that the page carries executed figures, with real code
  // coverage.
  it("heads the walk's own diagnostics as analysis notes", () => {
    expect(familyHeading("notes")).toBe("Analysis notes");
  });

  // The static counts under this family are how much test code the model WROTE. Nothing
  // under it ran, and the executed suite has the better claim to the word "Tests".
  it("heads the static test counts as authorship, not as tests", () => {
    expect(familyHeading("tests")).toBe("Test authorship");
  });

  // The assertion that keeps the collision from creeping back on any family at all: with
  // executed coverage on the same page, exactly one thing may be called "Coverage", and
  // it is not in this table.
  it("gives no catalog family a heading that reads as executed results", () => {
    const headings = new Set(
      CODE_METRICS.map((metric) => familyHeading(metric.family)),
    );
    expect([...headings]).not.toContain("Coverage");
    expect([...headings]).not.toContain("Tests");
  });
});
