// What only the **TypeScript** evaluator can get wrong.
//
// The shared conformance fixture (`conformance.test.ts`) pins the semantics both
// implementations owe each other. This file covers the hazards that exist *because* the
// twin is written in JavaScript and Rust's version of the same code is structurally
// immune to them — so there is nothing for a fixture case to assert against on the Rust
// side, and a case here is the only place they can be caught.
import { describe, expect, it } from "vitest";
import type { GgRunDoc } from "@test-cabinet/run-record/gg-query";
import { evaluate, fieldCatalog, globMatches } from "./evaluate";
import { compareCodePoints, totalCompare, valueKey } from "./values";

const doc = (fields: GgRunDoc["fields"]): GgRunDoc => ({ fields });

describe("string ordering", () => {
  it("puts an astral character after every BMP one, where `<` does not", () => {
    // The whole reason `compareCodePoints` exists. U+1F600 is the surrogate pair
    // D83D DE00, so JavaScript's own comparison reads it as below U+FF01.
    expect(compareCodePoints("！", "😀")).toBeLessThan(0);
    expect("！" < "😀").toBe(false);
    expect(compareCodePoints("😀", "！")).toBeGreaterThan(0);
  });

  it("orders a prefix before what extends it", () => {
    expect(compareCodePoints("run", "runner")).toBeLessThan(0);
    expect(compareCodePoints("runner", "run")).toBeGreaterThan(0);
    expect(compareCodePoints("run", "run")).toBe(0);
  });

  it("never reaches for locale collation", () => {
    // `localeCompare` sorts case-insensitively in most locales, which would put "a"
    // before "Z" — the opposite of code-point order, and of what Rust does.
    expect(compareCodePoints("Z", "a")).toBeLessThan(0);
  });
});

describe("the total order", () => {
  it("ranks booleans before numbers before strings", () => {
    expect(totalCompare(true, 0)).toBeLessThan(0);
    expect(totalCompare(99, "0")).toBeLessThan(0);
    expect(totalCompare(false, true)).toBeLessThan(0);
  });

  it("keeps -0 and 0 apart, as `f64::total_cmp` does", () => {
    // A `Map` keyed on the value itself would fold these together under SameValueZero,
    // which is why grouping and distinct counts go through `valueKey`.
    expect(totalCompare(-0, 0)).toBeLessThan(0);
    expect(valueKey(-0)).not.toBe(valueKey(0));
  });

  it("distinguishes a boolean from its spelling and from its projection", () => {
    expect(valueKey(true)).not.toBe(valueKey("true"));
    expect(valueKey(true)).not.toBe(valueKey(1));
  });
});

describe("composite bucket keys", () => {
  it("never merges two buckets whose key components concatenate the same way", () => {
    // The TypeScript-only hazard: Rust groups on a structured `KeyVec`, while the twin
    // has to encode the key into a `Map` key. Joining the components without a length
    // prefix would make ("a2:b", "c") and ("a", "b2:c") the same bucket — a silent
    // half-count on one host only, which is exactly the class of drift no amount of
    // reading the diff would catch.
    const docs = [
      doc({ id: "r1", left: "a2:b", right: "c" }),
      doc({ id: "r2", left: "a", right: "b2:c" }),
    ];
    const result = evaluate(docs, {
      stats: {
        aggs: [{ func: "count" }],
        groupBy: [
          { kind: "field", field: "left" },
          { kind: "field", field: "right" },
        ],
      },
    });
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets?.every((bucket) => bucket.n === 1)).toBe(true);
  });
});

describe("field lookup", () => {
  it("reads an inherited property name as absent", () => {
    // A field map is a plain object here and a `BTreeMap` in Rust. Without the
    // `Object.hasOwn` guard, `not constructor:*` would answer differently on the two
    // hosts for every document in the corpus.
    const docs = [doc({ id: "r1", state: "completed" })];
    const present = evaluate(docs, {
      filter: { kind: "exists", field: "constructor" },
    });
    expect(present.totalRuns).toBe(0);
    const absent = evaluate(docs, {
      filter: { kind: "not", clause: { kind: "exists", field: "toString" } },
    });
    expect(absent.totalRuns).toBe(1);
  });
});

describe("literal coercion", () => {
  it("does not read JavaScript's extra number spellings", () => {
    // `Number("")` is 0 and `Number("0x10")` is 16; Rust's `str::parse::<f64>` rejects
    // both. Coercing them would make `metric.cost >= ""` quietly mean `>= 0`.
    const docs = [doc({ id: "r1", cost: 16 }), doc({ id: "r2", cost: 0 })];
    const hex = evaluate(docs, {
      filter: { kind: "compare", field: "cost", op: "eq", value: "0x10" },
    });
    expect(hex.totalRuns).toBe(0);
    const empty = evaluate(docs, {
      filter: { kind: "compare", field: "cost", op: "eq", value: "" },
    });
    expect(empty.totalRuns).toBe(0);
  });
});

describe("globs", () => {
  it("matches across code points, not UTF-16 units", () => {
    // A `*` must not be able to land between the halves of a surrogate pair.
    expect(globMatches("*😀*", "a😀b")).toBe(true);
    expect(globMatches("a*b", "a😀b")).toBe(true);
  });

  it("backtracks when a star took too little", () => {
    expect(globMatches("a*c/*-a", "anthropic/claude-a")).toBe(true);
    expect(globMatches("a*c/*-a", "anthropic/claude-b")).toBe(false);
    expect(globMatches("*a*a*a", "banana")).toBe(true);
  });

  it("treats a bare star as matching everything, including the empty string", () => {
    expect(globMatches("*", "")).toBe(true);
    expect(globMatches("**", "anything")).toBe(true);
  });
});

describe("the field catalog", () => {
  it("orders field names by code point", () => {
    const catalog = fieldCatalog([doc({ "😀": 1, "！": 1, Z: 1, a: 1 })]);
    expect(catalog.fields.map((field) => field.name)).toEqual(["Z", "a", "！", "😀"]);
  });

  it("omits topValues entirely for a field with none, matching the wire form", () => {
    // Rust skips the list when it is empty, so a document round-tripped through JSON
    // has no key at all — and a twin that emitted `topValues: []` would compare unequal
    // to the published catalog for every empty field.
    const catalog = fieldCatalog([]);
    expect(catalog).toEqual({ documents: 0, fields: [] });
  });
});
