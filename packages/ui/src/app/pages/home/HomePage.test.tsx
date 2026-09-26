import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import type { CabinetStats } from "../../data/cabinetStats";
import {
  GalleryDataProvider,
  type GalleryDataInput,
  type RunDetail,
} from "../../data/galleryContext";
import type { ModelSummary } from "../../data/models";
import { runSummaryPage, type RunQuery } from "../../data/runQuery";
import type { TestCaseGroupSummary } from "../../data/testCases";
import { HomePage } from "./HomePage";

// The replay player fetches and decodes a recording; the page's contract is
// that a replay showcase entry mounts it on the resolved URL, in the
// presentation that plays itself (the same seam ShowcaseSection.test.tsx cuts).
vi.mock("../runs/replay/ReplayPlayer", () => ({
  ReplayPlayer: ({
    url,
    label,
    presentation,
  }: {
    url: string;
    label: string;
    presentation?: string;
  }) => (
    <p>
      replay player {label} @ {url} as {presentation}
    </p>
  ),
}));

const MODELS = [
  {
    slug: "claude",
    name: "Claude",
    provider: "anthropic",
    modelIds: ["anthropic/claude"],
    aliases: [],
    isConfigured: true,
    openrouterUrl: null,
    description: null,
    logoSvg: null,
  },
] as unknown as ModelSummary[];

function run(overrides: {
  id: string;
  startedAt?: string;
  publishedAt?: string | null;
  modelId?: string;
  harnessSlug?: string;
  engineSlug?: string;
  testCaseSlug?: string;
  aesthetic?: string | null;
  rating?: string | null;
  state?: string;
  cost?: number | null;
  score?: { earned: number; total: number; overallGrade?: string } | null;
}): RunSummary {
  const {
    id,
    startedAt = "2026-08-01T00:00:00Z",
    publishedAt = "2026-08-02T00:00:00Z",
    modelId = "anthropic/claude",
    harnessSlug = "pi",
    engineSlug,
    testCaseSlug = "carom",
    aesthetic = null,
    rating = "great",
    state = "completed",
    cost = 1,
    score = { earned: 8, total: 10 },
  } = overrides;
  return {
    id,
    publishedAt,
    startedAt,
    finishedAt: startedAt,
    caseName: "Carom",
    subject: {
      testCaseSlug,
      testCaseVersion: "v1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug,
      harnessVersion: "1",
      modelId,
      ...(engineSlug ? { engineSlug } : {}),
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: cost, actual: cost },
    },
    state,
    rating,
    aesthetic,
    score: score ? { ...score, reviews: 1 } : null,
    validatorRated: false,
  } as unknown as RunSummary;
}

function stats(overrides?: Partial<CabinetStats>): CabinetStats {
  return {
    runs: 1234,
    tokens: { total: 552960, unreportedRuns: 0 },
    cost: { total: 48230.55, unreportedRuns: 0 },
    testCases: 12,
    models: 34,
    weekly: [
      { weekStart: "2026-08-17", runs: 0 },
      { weekStart: "2026-08-24", runs: 3 },
    ],
    ...overrides,
  };
}

// The page against one host shape, rendered exactly as the static site mounts
// it: gallery provider + router, no backend/worker/auth. `queryRunSummaries`
// answers with the same pure page function the static gallery uses, so the
// showcase's aesthetic slice and the boards' testCases/latestVersions drains
// run the real filter logic. Run details resolve from a per-id map holding only
// what the page reads (its `showcase`) — ids absent from the map resolve a
// detail that OMITS the key, the pre-showcase record shape.
function galleryValue(opts: {
  summaries?: RunSummary[];
  showcases?: Record<string, RunDetail["showcase"]>;
  showcaseUrls?: Record<string, Record<string, string>>;
  testCaseGroups?: TestCaseGroupSummary[];
  getCabinetStats?: () => Promise<CabinetStats | null>;
}): GalleryDataInput {
  const { summaries = [], showcases = {}, showcaseUrls } = opts;
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery) =>
      runSummaryPage(summaries, query),
    readRun: (id: string) =>
      Promise.resolve(
        (id in showcases
          ? { showcase: showcases[id] }
          : {}) as unknown as RunDetail,
      ),
    ...(showcaseUrls
      ? {
          showcaseMediaUrl: (id: string, file: string) =>
            showcaseUrls[id]?.[file] ?? null,
        }
      : {}),
    testCases: [],
    testCasesStatus: "ready",
    models: MODELS,
    modelsStatus: "ready",
    canExecute: false,
    testCaseGroups: opts.testCaseGroups,
    getCabinetStats: opts.getCabinetStats,
  } as unknown as GalleryDataInput;
}

function renderHome(opts: Parameters<typeof galleryValue>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <GalleryDataProvider value={galleryValue(opts)}>
        <HomePage />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("the legendary showcase", () => {
  it("stages the newest legendary run as the hero and the rest as thumbnails", async () => {
    // Five legendary runs plus a newer non-legendary one that must not appear;
    // the newest legendary run leads whatever order the list arrives in.
    const summaries = [
      run({ id: "plain", startedAt: "2026-08-20T00:00:00Z" }),
      ...[1, 2, 3, 4, 5].map((n) =>
        run({
          id: `l${n}`,
          startedAt: `2026-08-0${n}T00:00:00Z`,
          aesthetic: "legendary",
        }),
      ),
    ];
    renderHome({
      summaries,
      showcases: {
        l5: {
          description: "",
          media: [
            { file: "cover.png", name: "Cover", kind: "image" },
            { file: "clip.json.gz", name: "A round", kind: "replay" },
          ],
        },
      },
      showcaseUrls: {
        l5: { "clip.json.gz": "https://cdn.example/l5/clip.json.gz" },
      },
    });

    // The hero picks the replay over the image and mounts the self-playing
    // presentation on the resolved URL.
    expect(
      await screen.findByText(
        "replay player A round @ https://cdn.example/l5/clip.json.gz as showcase",
      ),
    ).toBeTruthy();
    // The other four are the thumbnail row, each an overlay link into its run.
    const thumbs = screen.getAllByRole("link", { name: /^Open run: Carom —/ });
    expect(thumbs).toHaveLength(4);
    expect(thumbs.map((t) => t.getAttribute("href"))).toEqual([
      "/runs/l4",
      "/runs/l3",
      "/runs/l2",
      "/runs/l1",
    ]);
    // The newer but non-legendary run stages nowhere.
    expect(document.querySelector('a[href="/runs/plain"]')).toBeNull();
  });

  it("falls back through video, image, and the placeholder as media thins out", async () => {
    const summaries = [
      // Hero: no replay, so the muted autoplaying loop stages.
      run({
        id: "vid",
        startedAt: "2026-08-04T00:00:00Z",
        aesthetic: "legendary",
      }),
      // Thumb: image only.
      run({
        id: "img",
        startedAt: "2026-08-03T00:00:00Z",
        aesthetic: "legendary",
      }),
      // Thumb: a detail that omits the showcase key entirely.
      run({
        id: "bare",
        startedAt: "2026-08-02T00:00:00Z",
        aesthetic: "legendary",
      }),
      // Thumb: stageable media the host cannot serve (no URL behind the name).
      run({
        id: "lost",
        startedAt: "2026-08-01T00:00:00Z",
        aesthetic: "legendary",
      }),
    ];
    const { container } = renderHome({
      summaries,
      showcases: {
        vid: {
          description: "",
          media: [{ file: "demo.mp4", name: "Demo", kind: "video" }],
        },
        img: {
          description: "",
          media: [{ file: "shot.png", name: "Shot", kind: "image" }],
        },
        lost: {
          description: "",
          media: [{ file: "gone.png", name: "Gone", kind: "image" }],
        },
      },
      showcaseUrls: {
        vid: { "demo.mp4": "https://cdn.example/vid/demo.mp4" },
        img: { "shot.png": "https://cdn.example/img/shot.png" },
      },
    });

    const video = (await screen.findByLabelText("Demo")) as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.hasAttribute("loop")).toBe(true);
    expect(screen.getByRole("img", { name: "Shot" }).getAttribute("src")).toBe(
      "https://cdn.example/img/shot.png",
    );
    // The showcase-less run and the unservable one both hold the layout with
    // the quiet cabinet-mark placeholder rather than a broken viewer.
    const marks = container.querySelectorAll(
      'svg[aria-label="Arcade cabinet"]',
    );
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the section with a muted line when nothing is legendary", async () => {
    renderHome({ summaries: [run({ id: "plain" })] });
    expect(
      await screen.findByText("Nothing has been rated legendary yet."),
    ).toBeTruthy();
    expect(screen.getByText("Legendary Showcase")).toBeTruthy();
  });

  it("tags an unpublished legendary run", async () => {
    renderHome({
      summaries: [run({ id: "l1", aesthetic: "legendary", publishedAt: null })],
    });
    await screen.findByText("open run ›");
    expect(screen.getByTitle("Unpublished")).toBeTruthy();
  });
});

describe("the totals band and activity chart", () => {
  it("renders the five tiles and the weekly chart from the host's stats", async () => {
    renderHome({ getCabinetStats: () => Promise.resolve(stats()) });

    expect(await screen.findByText("1,234")).toBeTruthy();
    expect(screen.getByText("553K")).toBeTruthy();
    expect(screen.getByText("$48,230.55")).toBeTruthy();
    // "Test cases" (sentence case) is the tile's label; the topbar's nav link
    // is "Test Cases", so the query stays unambiguous.
    expect(screen.getByText("Test cases")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("notes unreported runs on the tokens and spend tiles", async () => {
    renderHome({
      getCabinetStats: () =>
        Promise.resolve(
          stats({
            tokens: { total: 552960, unreportedRuns: 2 },
            cost: { total: 48230.55, unreportedRuns: 1 },
          }),
        ),
    });
    expect(
      await screen.findByTitle(
        "2 runs reported no tokens, contributing nothing to this total.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        "1 run reported no comparable cost, contributing nothing to this total.",
      ),
    ).toBeTruthy();
  });

  it("quietly holds the band back when the host lacks the figures", async () => {
    renderHome({});
    await screen.findByText("Nothing has been rated legendary yet.");
    expect(screen.queryByText("Activity")).toBeNull();
    expect(screen.queryByText("Test cases")).toBeNull();
  });

  it("quietly holds the band back when the fetch resolves null", async () => {
    renderHome({ getCabinetStats: () => Promise.resolve(null) });
    await screen.findByText("Nothing has been rated legendary yet.");
    expect(screen.queryByText("Activity")).toBeNull();
  });
});

const GROUP: TestCaseGroupSummary = {
  slug: "arcade",
  name: "Arcade",
  summary: null,
  cases: ["carom", "spectra"],
};

describe("the group leaderboards", () => {
  it("ranks rows by mean score fraction, not by points", async () => {
    // Claude: one carom run at 8/10 (0.8). GPT: two spectra runs at 10/20 and
    // 20/20 (mean fraction 0.75) — more POINTS on average than Claude, so a
    // points ranking would invert this board. Cross-case totals differ; only
    // the fraction is comparable.
    renderHome({
      summaries: [
        run({ id: "a", score: { earned: 8, total: 10 } }),
        run({
          id: "b1",
          modelId: "openai/gpt",
          testCaseSlug: "spectra",
          score: { earned: 10, total: 20 },
          cost: null,
        }),
        run({
          id: "b2",
          modelId: "openai/gpt",
          testCaseSlug: "spectra",
          score: { earned: 20, total: 20 },
          cost: null,
        }),
      ],
      testCaseGroups: [GROUP],
    });

    const board = await screen.findByRole("table", {
      name: "Arcade leaderboard",
    });
    const rows = within(board).getAllByRole("row");
    expect(rows).toHaveLength(2);
    // The catalog resolves Claude's name; GPT is off-catalog and reads as its
    // canonical id.
    expect(rows[0]?.textContent).toContain("Claude");
    expect(rows[0]?.textContent).toContain("80%");
    expect(rows[0]?.textContent).toContain("$1.00");
    expect(rows[1]?.textContent).toContain("openai/gpt");
    expect(rows[1]?.textContent).toContain("75%");
    // No run of GPT's reported a comparable cost: an em dash, never $0.
    expect(rows[1]?.textContent).toContain("—");
    // The member-slug line links into each case.
    expect(
      screen.getByRole("link", { name: "carom" }).getAttribute("href"),
    ).toBe("/test-cases/carom");
  });

  it("marks engines only when the group's rows span more than one", async () => {
    renderHome({
      summaries: [
        run({ id: "a", engineSlug: "simple-2d" }),
        run({ id: "b", modelId: "openai/gpt", engineSlug: "structured-2d" }),
      ],
      testCaseGroups: [GROUP],
    });
    const board = await screen.findByRole("table", {
      name: "Arcade leaderboard",
    });
    expect(within(board).getByText(/Simple 2D/)).toBeTruthy();
    expect(within(board).getByText(/Structured 2D/)).toBeTruthy();
  });

  it("shows no engine marker on a single-engine board", async () => {
    renderHome({
      summaries: [
        run({ id: "a", engineSlug: "simple-2d" }),
        run({ id: "b", modelId: "openai/gpt", engineSlug: "simple-2d" }),
      ],
      testCaseGroups: [GROUP],
    });
    const board = await screen.findByRole("table", {
      name: "Arcade leaderboard",
    });
    expect(within(board).queryByText(/Simple 2D/)).toBeNull();
  });

  it("badges a jam row by its overall grade", async () => {
    renderHome({
      summaries: [
        run({
          id: "jam",
          rating: null,
          score: { earned: 40, total: 50, overallGrade: "incredible" },
        }),
      ],
      testCaseGroups: [GROUP],
    });
    const board = await screen.findByRole("table", {
      name: "Arcade leaderboard",
    });
    expect(within(board).getByText("Incredible")).toBeTruthy();
  });

  it("shows a muted line for a group with no scored runs", async () => {
    renderHome({
      summaries: [run({ id: "a", state: "failed", score: null })],
      testCaseGroups: [GROUP],
    });
    expect(
      await screen.findByText("No scored runs in this group yet."),
    ).toBeTruthy();
  });

  it("renders no boards section at all for a host without groups", async () => {
    renderHome({ summaries: [run({ id: "a" })] });
    await screen.findByText("Nothing has been rated legendary yet.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
