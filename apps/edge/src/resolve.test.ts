import { describe, expect, it } from "vitest";
import type { ShareEntry, ShareIndex } from "@test-cabinet/share-links";
import { resolveShortLink } from "./resolve.js";

const COMPLETED = "2f81c4a9-7b3e-4d1c-9a02-5e6f7a8b9c0d";
const FAILED = "tz4a98xxat96iws9zmbrgj3a";

function entry(overrides: Partial<ShareEntry> & { code: string }): ShareEntry {
  return {
    runId: COMPLETED,
    caseName: "Carom",
    variant: "base",
    model: "claude-opus-5",
    harness: "claude-code",
    rating: "great",
    score: { earned: 42, total: 50 },
    reviews: 2,
    state: "completed",
    hasPlayableBuild: true,
    image: null,
    ...overrides,
  };
}

const INDEX: ShareIndex = {
  version: 1,
  origin: "https://testcabinet.ai",
  generatedAt: "2026-08-16T00:00:00Z",
  entries: {
    "2f81c4a9": entry({ code: "2f81c4a9" }),
    // A catastrophic run: published, but it released no playable build.
    tz4a98xx: entry({
      code: "tz4a98xx",
      runId: FAILED,
      rating: null,
      score: null,
      reviews: 0,
      state: "catastrophic",
      hasPlayableBuild: false,
    }),
  },
};

describe("resolveShortLink", () => {
  it("opens the verdict page for /r/<code>", () => {
    const result = resolveShortLink("/r/2f81c4a9", INDEX);
    expect(result).toMatchObject({
      kind: "run",
      target: "verdict",
      canonicalUrl: `https://testcabinet.ai/runs/${COMPLETED}`,
      downgraded: false,
    });
  });

  it("opens the play page for /p/<code>", () => {
    const result = resolveShortLink("/p/2f81c4a9", INDEX);
    expect(result).toMatchObject({
      kind: "run",
      target: "play",
      canonicalUrl: `https://testcabinet.ai/runs/${COMPLETED}/play`,
    });
  });

  it("always lands on the gallery, never on the run's own build", () => {
    // The whole point of pointing a share link at the gallery: a bare build
    // deployment has no way back into the rest of the cabinet.
    for (const path of ["/r/2f81c4a9", "/p/2f81c4a9"]) {
      const result = resolveShortLink(path, INDEX);
      expect(result.kind).toBe("run");
      if (result.kind !== "run") continue;
      expect(result.canonicalUrl.startsWith("https://testcabinet.ai/")).toBe(
        true,
      );
      expect(result.canonicalUrl).not.toContain("pages.dev");
    }
  });

  it("downgrades a play link for a run that released no build", () => {
    const result = resolveShortLink("/p/tz4a98xx", INDEX);
    expect(result).toMatchObject({
      kind: "run",
      target: "verdict",
      canonicalUrl: `https://testcabinet.ai/runs/${FAILED}`,
      downgraded: true,
    });
  });

  it("does not downgrade that run's verdict link", () => {
    expect(resolveShortLink("/r/tz4a98xx", INDEX)).toMatchObject({
      target: "verdict",
      downgraded: false,
    });
  });

  it("resolves a code case-insensitively", () => {
    expect(resolveShortLink("/r/2F81C4A9", INDEX)).toMatchObject({
      kind: "run",
    });
  });

  it("resolves a longer prefix of the id, so an older link keeps working", () => {
    expect(resolveShortLink("/r/2f81c4a9-7b3e", INDEX)).toMatchObject({
      kind: "run",
      canonicalUrl: `https://testcabinet.ai/runs/${COMPLETED}`,
    });
  });

  it("sends an unknown code to the run index rather than erroring", () => {
    expect(resolveShortLink("/r/ffffffff", INDEX)).toEqual({
      kind: "elsewhere",
      url: "https://testcabinet.ai/runs",
    });
  });

  it("sends the bare root and any other path to the gallery", () => {
    for (const path of ["/", "/about", "/r", "/r/a/b", "/x/2f81c4a9"]) {
      expect(resolveShortLink(path, INDEX), path).toEqual({
        kind: "elsewhere",
        url: "https://testcabinet.ai",
      });
    }
  });

  it("sends every link to the gallery when nothing is published yet", () => {
    const empty: ShareIndex = { ...INDEX, entries: {} };
    expect(resolveShortLink("/r/2f81c4a9", empty)).toEqual({
      kind: "elsewhere",
      url: "https://testcabinet.ai/runs",
    });
  });

  it("tolerates a trailing slash on the configured origin", () => {
    const trailing: ShareIndex = {
      ...INDEX,
      origin: "https://testcabinet.ai/",
    };
    expect(resolveShortLink("/r/2f81c4a9", trailing)).toMatchObject({
      canonicalUrl: `https://testcabinet.ai/runs/${COMPLETED}`,
    });
  });
});
