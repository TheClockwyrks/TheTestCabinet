import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseOverviewPage } from "./TestCaseOverviewPage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The catalog is injected through `useTestCase`; mock it so each test seeds an
// exact fixture.
const catalog = vi.fn<() => { testCases: TestCaseDetail[]; status: string }>();
vi.mock("../../../data/useTestCase", () => ({
  useTestCase: (slug: string | undefined) => {
    const { testCases, status } = catalog();
    return { testCase: testCases.find((c) => c.slug === slug), status };
  },
}));

// The gallery data is read by the layout (run/arena affordances and the
// coordinate resolver) and by the Play body (the case-scoped showcase media
// resolver), so it is stubbed per test — a host with no media resolver at all is
// a shape the page must handle, and a NEW `fetchCaseVariant` per test keeps the
// layout's per-resolver resolution cache from leaking between tests.
const galleryData = vi.fn();
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => galleryData(),
}));

// The replay player fetches and decodes a recording; the carousel's contract is
// that a staged replay entry mounts it on the resolved URL, in the presentation
// that plays itself and keeps its transport off the layout.
vi.mock("../../runs/replay/ReplayPlayer", () => ({
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

// Resolve case showcase media the way a configured host does: the static site's
// build-time map from the (slug, version, variant) coordinate and served file
// name to a snapshot URL — a name the snapshot published resolves, anything
// else is null.
const mediaUrls: Record<string, string> = {
  "carom/v1.0.0/base/title.png":
    "https://cdn.example/media/cases/carom/v1.0.0/showcase/base/title.png",
  "carom/v1.0.0/base/rally.json.gz":
    "https://cdn.example/media/cases/carom/v1.0.0/showcase/base/rally.json.gz",
  "carom/v1.0.0/base/cover.png":
    "https://cdn.example/media/cases/carom/v1.0.0/showcase/base/cover.png",
};
const caseShowcaseMediaUrl = (
  slug: string,
  version: string,
  variant: string,
  file: string,
) => mediaUrls[`${slug}/${version}/${variant}/${file}`] ?? null;

function variant(extra: Partial<VariantSummary> = {}): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    referenceBuilds: {},
    referenceSheet: null,
    ...extra,
  } as VariantSummary;
}

/** The two-image-one-replay carousel most tests stage. */
function showcased(extra: Partial<VariantSummary> = {}): VariantSummary {
  return variant({
    showcase: {
      description: "Captured from the **reference** implementation.",
      media: [
        { file: "title.png", name: "Title screen", kind: "image" },
        { file: "rally.json.gz", name: "A rally", kind: "replay" },
        { file: "cover.png", name: "Cover art", kind: "image" },
      ],
    },
    ...extra,
  });
}

// The gallery-data stub for one test: the affordance flags, a fresh coordinate
// resolver answering with exactly the given variant, and (optionally) the
// media resolver.
function seedGalleryData(
  resolved: VariantSummary | null,
  extra: Record<string, unknown> = {},
) {
  galleryData.mockReturnValue({
    canExecute: false,
    arena: undefined,
    fetchCaseVariant: () => Promise.resolve(resolved),
    ...extra,
  });
}

// A catalog entry carrying only the fields the landing tab and its layout read.
function testCase(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
    difficulty: "easy",
    tags: [],
    summary: null,
    description: "A game of **banked** shots.",
    descriptionsByVersion: { "v1.0.0": "A game of **banked** shots." },
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    variants: [variant()],
    variantsByVersion: { "v1.0.0": [{ slug: "base", name: "Base" }] },
    enginesByVersion: { "v1.0.0": ["none"] },
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

function renderOverview(search = "") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseDetail("carom") + search]}>
      <Routes>
        <Route
          path={routePatterns.testCaseDetail}
          element={<TestCaseOverviewPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseOverviewPage", () => {
  it("stages the showcase carousel with case-scoped URLs, in authored order", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(showcased(), { caseShowcaseMediaUrl });
    renderOverview();

    // The first entry is staged, resolved through the case-scoped resolver.
    const staged = (await screen.findByRole("img", {
      name: "Title screen",
    })) as HTMLImageElement;
    expect(staged.src).toBe(
      "https://cdn.example/media/cases/carom/v1.0.0/showcase/base/title.png",
    );

    // The thumbnail strip keeps the authored carousel order.
    const thumbs = screen.getAllByRole("tab");
    expect(thumbs.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Show Title screen",
      "Show A rally",
      "Show Cover art",
    ]);
    expect(thumbs[0]?.getAttribute("aria-selected")).toBe("true");

    // A staged replay entry mounts the player on the resolved URL, in the
    // self-playing showcase presentation.
    fireEvent.click(screen.getByRole("tab", { name: "Show A rally" }));
    expect(
      screen.getByText(
        "replay player A rally @ https://cdn.example/media/cases/carom/v1.0.0/showcase/base/rally.json.gz as showcase",
      ),
    ).toBeTruthy();

    // …and the prev/next steppers walk the same order.
    fireEvent.click(screen.getByRole("button", { name: "Previous media" }));
    expect(screen.getByRole("img", { name: "Title screen" })).toBeTruthy();
  });

  it("renders the reference launch panel with the pinned copy and the inline embed", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(
      variant({ referenceBuilds: { none: "https://ref.example/carom/base/" } }),
    );
    renderOverview();

    const heading = await screen.findByRole("heading", {
      name: "Play the reference implementation",
    });
    // The subtitle names the variant and the ANCHORED engine, with no trailing
    // clause — the pinned copy.
    expect(heading.nextElementSibling?.textContent).toBe(
      "The reference build for Base · None.",
    );
    // The embed itself is the shared inline reference playable.
    expect(
      screen
        .getByTitle("Reference implementation for Base on None")
        .getAttribute("src"),
    ).toBe("https://ref.example/carom/base/");
  });

  it("renders the showcase description below the case description", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(
      showcased({
        showcase: {
          description: "![Cover](cover.png)\n\nAn honest pitch.",
          media: [{ file: "title.png", name: "Title screen", kind: "image" }],
        },
      }),
      { caseShowcaseMediaUrl },
    );
    renderOverview();

    // The case's own description always renders…
    expect(await screen.findByText("banked")).toBeTruthy();
    // …and the showcase.md renders beneath it, its bare relative image
    // references resolved to the served showcase files.
    expect(screen.getByText("An honest pitch.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Cover" }).getAttribute("src")).toBe(
      "https://cdn.example/media/cases/carom/v1.0.0/showcase/base/cover.png",
    );
  });

  it("renders the plain description alone when the coordinate has nothing to play", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(variant());
    renderOverview();

    expect(await screen.findByText("banked")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Play the reference implementation",
      }),
    ).toBeNull();
    // …which is also when the landing tab reads as the plain Overview.
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  });

  it("notes showcase media the host cannot serve instead of a broken viewer", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    // A host with no snapshot bucket wired up supplies no resolver at all.
    seedGalleryData(showcased());
    renderOverview();

    expect(
      await screen.findByText(/Title screen \(title\.png\) is not available/),
    ).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Title screen" })).toBeNull();
    // The tab still advertises the showcase — the media exists, this host just
    // cannot serve the bytes.
    expect(screen.getByRole("link", { name: "Play" })).toBeTruthy();
  });

  // A description ships with the version it describes, so an older version
  // shows its own text — never the latest one's, and never a line claiming the
  // text belongs to some other version.
  it("shows the anchored version's own description", async () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          description: "A game of **banked** shots.",
          descriptionsByVersion: {
            "v2.0.0": "A game of **banked** shots.",
            "v1.0.0": "A game of **straight** shots.",
          },
          versions: ["v2.0.0", "v1.0.0"],
          latestVersion: "v2.0.0",
          variantsByVersion: {
            "v2.0.0": [{ slug: "base", name: "Base" }],
            "v1.0.0": [{ slug: "base", name: "Base" }],
          },
          enginesByVersion: { "v2.0.0": ["none"], "v1.0.0": ["none"] },
        }),
      ],
      status: "ready",
    });
    seedGalleryData(variant());
    renderOverview("?version=v1.0.0");

    expect(await screen.findByText("straight")).toBeTruthy();
    expect(screen.queryByText("banked")).toBeNull();
    expect(screen.queryByText(/accompanies the latest/)).toBeNull();
    // The layout's notice, not the description, is what says an older version
    // is being viewed.
    expect(screen.getByText(/Viewing v1\.0\.0; latest is/)).toHaveTextContent(
      "Viewing v1.0.0; latest is v2.0.0",
    );
  });

  it("falls back to the description when the host cannot resolve the coordinate", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    // The host holds the case but not the anchored rendering: `fetchCaseVariant`
    // settles on null, and the description must stay readable regardless.
    seedGalleryData(null);
    renderOverview();

    expect(await screen.findByText("banked")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
