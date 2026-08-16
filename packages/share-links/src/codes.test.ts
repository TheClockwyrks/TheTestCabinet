import { describe, expect, it } from "vitest";
import {
  SHORT_CODE_LENGTH,
  assignShortCodes,
  resolveCode,
  runPath,
  shortCodeFor,
  shortLinkPath,
  targetForPrefix,
} from "./codes.js";

// A UUIDv4 and a CUID2, the two id schemes a corpus can hold at once while run
// ids migrate. A prefix rule has to span both without a migration.
const UUID = "2f81c4a9-7b3e-4d1c-9a02-5e6f7a8b9c0d";
const CUID2 = "tz4a98xxat96iws9zmbrgj3a";

describe("shortCodeFor", () => {
  it("takes a UUID's first hex group, which has no dash in it", () => {
    expect(shortCodeFor(UUID)).toBe("2f81c4a9");
    expect(shortCodeFor(UUID)).toHaveLength(SHORT_CODE_LENGTH);
    expect(shortCodeFor(UUID)).not.toContain("-");
  });

  it("takes a CUID2's leading characters", () => {
    expect(shortCodeFor(CUID2)).toBe("tz4a98xx");
  });

  it("lowercases, so a code pasted in either case resolves", () => {
    expect(shortCodeFor("2F81C4A9-7B3E")).toBe("2f81c4a9");
  });

  it("depends on the one run id and nothing else", () => {
    // This is what makes a minted link stable forever: no corpus, no counter, no
    // ordering feeds into it.
    expect(shortCodeFor(UUID)).toBe(shortCodeFor(UUID));
  });
});

describe("assignShortCodes", () => {
  it("gives every run its canonical code when nothing collides", () => {
    const { codes, collisions } = assignShortCodes([UUID, CUID2]);
    expect(codes.get(UUID)).toBe("2f81c4a9");
    expect(codes.get(CUID2)).toBe("tz4a98xx");
    expect(collisions).toEqual([]);
  });

  it("spans both id schemes in one corpus", () => {
    const ids = [UUID, CUID2, "9c0dfeed-1111-2222-3333-444455556666"];
    const { codes } = assignShortCodes(ids);
    expect(new Set(codes.values()).size).toBe(3);
  });

  it("lengthens only the colliding group, leaving every other code alone", () => {
    const a = "abcdef12-0000-0000-0000-000000000001";
    const b = "abcdef12-0000-0000-0000-000000000002";
    const other = "99887766-0000-0000-0000-000000000003";
    const { codes, collisions } = assignShortCodes([a, b, other]);

    // The bystander keeps the code it would have had anyway — one unlucky pair
    // must not invalidate links across the corpus.
    expect(codes.get(other)).toBe("99887766");
    expect(collisions).toEqual([[a, b].sort()]);
    // The pair separates, and each code is still a prefix of its own id.
    expect(codes.get(a)).not.toBe(codes.get(b));
    expect(a.startsWith(codes.get(a)!)).toBe(true);
    expect(b.startsWith(codes.get(b)!)).toBe(true);
  });

  it("treats the same id listed twice as one run, not a collision", () => {
    const { codes, collisions } = assignShortCodes([UUID, UUID]);
    expect(collisions).toEqual([]);
    expect(codes.get(UUID)).toBe("2f81c4a9");
  });

  it("assigns nothing for an empty corpus", () => {
    expect(assignShortCodes([]).codes.size).toBe(0);
  });
});

describe("resolveCode", () => {
  const codes = new Map([
    ["2f81c4a9", UUID],
    ["tz4a98xx", CUID2],
  ]);

  it("resolves an exact code", () => {
    expect(resolveCode("2f81c4a9", codes)).toBe(UUID);
  });

  it("resolves case-insensitively", () => {
    expect(resolveCode("2F81C4A9", codes)).toBe(UUID);
  });

  it("resolves a longer unique prefix of the id", () => {
    // What keeps an older, shorter link working after the canonical length is
    // raised, and vice versa.
    expect(resolveCode("2f81c4a9-7b3e", codes)).toBe(UUID);
  });

  it("resolves a shorter unique prefix of the id", () => {
    expect(resolveCode("tz4a", codes)).toBe(CUID2);
  });

  it("refuses an ambiguous prefix rather than guessing", () => {
    const ambiguous = new Map([
      ["abcdef120", "abcdef120000000000000001"],
      ["abcdef121", "abcdef121000000000000002"],
    ]);
    expect(resolveCode("abcdef12", ambiguous)).toBeNull();
  });

  it("is null for a code that names nothing", () => {
    expect(resolveCode("ffffffff", codes)).toBeNull();
  });

  it("is null for an empty corpus", () => {
    expect(resolveCode("2f81c4a9", new Map())).toBeNull();
  });
});

describe("paths", () => {
  it("names the gallery page for each target", () => {
    expect(runPath(UUID, "verdict")).toBe(`/runs/${UUID}`);
    expect(runPath(UUID, "play")).toBe(`/runs/${UUID}/play`);
  });

  it("names the short link for each target", () => {
    expect(shortLinkPath("2f81c4a9", "verdict")).toBe("/r/2f81c4a9");
    expect(shortLinkPath("2f81c4a9", "play")).toBe("/p/2f81c4a9");
  });

  it("maps a short-link prefix back to its target", () => {
    expect(targetForPrefix("r")).toBe("verdict");
    expect(targetForPrefix("p")).toBe("play");
    expect(targetForPrefix("x")).toBeNull();
  });

  it("round-trips a code through its short link", () => {
    const code = shortCodeFor(CUID2);
    expect(shortLinkPath(code, "play")).toBe(`/p/${code}`);
  });
});
