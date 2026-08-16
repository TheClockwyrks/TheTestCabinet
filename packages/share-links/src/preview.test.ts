import { describe, expect, it } from "vitest";
import type { ShareEntry } from "./entries.js";
import {
  escapeHtml,
  isCrawler,
  previewDescription,
  previewTitle,
  renderMetaTags,
  renderPreviewDocument,
} from "./preview.js";

function entry(overrides: Partial<ShareEntry> = {}): ShareEntry {
  return {
    code: "2f81c4a9",
    runId: "2f81c4a9-7b3e-4d1c-9a02-5e6f7a8b9c0d",
    caseName: "Carom",
    variant: "base",
    model: "claude-opus-5",
    harness: "claude-code",
    rating: "great",
    score: { earned: 42, total: 50 },
    reviews: 2,
    state: "completed",
    hasPlayableBuild: true,
    image: "https://snapshot.testcabinet.ai/media/runs/x/proof/a.png",
    ...overrides,
  };
}

describe("previewTitle", () => {
  it("names the case and the model", () => {
    expect(previewTitle(entry(), "verdict")).toBe("Carom · claude-opus-5");
  });

  it("says what a play link opens", () => {
    expect(previewTitle(entry(), "play")).toBe("Play Carom · claude-opus-5");
  });
});

describe("previewDescription", () => {
  it("leads with the verdict, then what produced the run", () => {
    expect(previewDescription(entry())).toBe(
      "Great · 42/50 points · 2 reviews · Built with claude-code on the base variant.",
    );
  });

  it("singularizes a lone review", () => {
    expect(previewDescription(entry({ reviews: 1 }))).toContain("1 review ·");
  });

  it("says what happened when a failure tier has no verdict to report", () => {
    // A shared link to a catastrophic run should read as one rather than as an
    // empty card.
    const text = previewDescription(
      entry({
        rating: null,
        score: null,
        reviews: 0,
        state: "catastrophic",
      }),
    );
    expect(text).toContain("Run ended: catastrophic");
  });

  it("spells a multi-word state readably", () => {
    const text = previewDescription(
      entry({ rating: null, score: null, reviews: 0, state: "harness_error" }),
    );
    expect(text).toContain("Run ended: harness error");
  });

  it("omits a score with nothing on offer rather than dividing by it", () => {
    const text = previewDescription(entry({ score: { earned: 0, total: 0 } }));
    expect(text).not.toContain("0/0");
  });
});

describe("renderMetaTags", () => {
  const url =
    "https://testcabinet.ai/runs/2f81c4a9-7b3e-4d1c-9a02-5e6f7a8b9c0d";

  it("carries the OpenGraph and Twitter tags an unfurl reads", () => {
    const tags = renderMetaTags(entry(), "verdict", url);
    expect(tags).toContain('property="og:title"');
    expect(tags).toContain('property="og:description"');
    expect(tags).toContain(`property="og:url" content="${url}"`);
    expect(tags).toContain(
      'property="og:site_name" content="The Test Cabinet"',
    );
    expect(tags).toContain(`<link rel="canonical" href="${url}" />`);
  });

  it("asks for a large card when there is an image, a small one otherwise", () => {
    expect(renderMetaTags(entry(), "verdict", url)).toContain(
      'name="twitter:card" content="summary_large_image"',
    );
    const noImage = renderMetaTags(entry({ image: null }), "verdict", url);
    expect(noImage).toContain('name="twitter:card" content="summary"');
    expect(noImage).not.toContain("og:image");
  });

  it("escapes values so a case name cannot break out of an attribute", () => {
    const tags = renderMetaTags(
      entry({ caseName: 'Ca"><script>alert(1)</script>' }),
      "verdict",
      url,
    );
    expect(tags).not.toContain("<script>");
    expect(tags).toContain("&quot;");
  });
});

describe("renderPreviewDocument", () => {
  const url = "https://testcabinet.ai/runs/abc";

  it("carries the tags and sends anything that is not a crawler onward", () => {
    const html = renderPreviewDocument(entry(), "verdict", url);
    expect(html).toContain('property="og:title"');
    expect(html).toContain(`content="0; url=${url}"`);
    expect(html).toContain(`href="${url}"`);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could break out of markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

describe("isCrawler", () => {
  it("recognizes the unfurlers a shared link actually meets", () => {
    for (const ua of [
      "facebookexternalhit/1.1",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0",
      "Discordbot/2.0",
      "WhatsApp/2.19",
      "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
    ]) {
      expect(isCrawler(ua), ua).toBe(true);
    }
  });

  it("matches case-insensitively", () => {
    expect(isCrawler("SLACKBOT")).toBe(true);
  });

  it("treats a browser as a person, so a click is never met with a stub", () => {
    expect(
      isCrawler(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("treats an absent user agent as a person", () => {
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler("")).toBe(false);
  });
});
