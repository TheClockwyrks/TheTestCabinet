import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseReferencePage } from "./TestCaseReferencePage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The catalog is injected through `useTestCase`; mock it so each test seeds an
// exact fixture. The gallery data is read by the layout (run/arena affordances
// and the coordinate resolver) and the sheet view (the reference-media
// resolver), so it is stubbed per test — a host with no media resolver at all is
// a case the view must handle, and a NEW `fetchCaseVariant` per test keeps the
// layout's per-resolver resolution cache from leaking between tests.
const catalog = vi.fn<() => { testCases: TestCaseDetail[]; status: string }>();
// The layout resolves the case it is about through `useTestCase` (a per-slug
// fetch), so the stub answers from the fixture catalog each test seeds — the same
// lookup the real hook performs against the host.
vi.mock("../../../data/useTestCase", () => ({
  useTestCase: (slug: string | undefined) => {
    const { testCases, status } = catalog();
    return { testCase: testCases.find((c) => c.slug === slug), status };
  },
}));
const galleryData = vi.fn();
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => galleryData(),
}));

// Resolve reference media the way a configured host does: the deterministic layout
// from `crates/core/src/asset_reference.rs`, rooted at a snapshot base.
const referenceMediaUrl = (
  slug: string,
  version: string,
  variant: string,
  file: string,
) =>
  `https://snap.example/media/references/${slug}/${version}/${variant}/${file}`;

function variant(extra: Partial<VariantSummary> = {}): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    referenceBuilds: {},
    referenceSheet: null,
    ...extra,
  } as VariantSummary;
}

// The gallery-data stub for one test: the affordance flags, a fresh coordinate
// resolver answering with exactly the given variant, and (optionally) the
// media resolver.
function seedGalleryData(
  resolved: VariantSummary,
  extra: Record<string, unknown> = {},
) {
  galleryData.mockReturnValue({
    canExecute: false,
    arena: undefined,
    fetchCaseVariant: () => Promise.resolve(resolved),
    ...extra,
  });
}

// A catalog entry carrying only the fields the Reference tab and its layout read.
function testCase(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "lattice-belt",
    name: "Lattice Belt",
    testType: "asset-generation",
    difficulty: "medium",
    tags: [],
    summary: null,
    description: null,
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    variants: [variant()],
    variantsByVersion: { "v1.0.0": [{ slug: "base", name: "Base" }] },
    enginesByVersion: { "v1.0.0": ["none"] },
    changelog: [],
    errata: [],
    sheet: {
      frameWidth: 32,
      frameHeight: 32,
      frames: [0, 1],
      sequences: [{ slug: "run", name: "Run", frames: [0, 1], fps: 8 }],
    },
    ...extra,
  } as TestCaseDetail;
}

// Where a sheetless coordinate's redirect lands: the detail landing route,
// probed so a test can assert both the arrival and that the query string (the
// anchored coordinate) survived the hop.
function LandingProbe() {
  const { search } = useLocation();
  return <p>landing{search}</p>;
}

function renderReference(search = "", slug = "lattice-belt") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseReference(slug) + search]}>
      <Routes>
        <Route
          path={routePatterns.testCaseReference}
          element={<TestCaseReferencePage />}
        />
        <Route path={routePatterns.testCaseDetail} element={<LandingProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseReferencePage", () => {
  it("renders the published frames and their action logs for an asset case", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(variant({ referenceSheet: { frames: [0, 1] } }), {
      referenceMediaUrl,
    });
    renderReference();

    // One image per published frame, at the deterministic key.
    const frame0 = (await screen.findByAltText(
      "Reference frame 0",
    )) as HTMLImageElement;
    expect(frame0.src).toBe(
      "https://snap.example/media/references/lattice-belt/v1.0.0/base/frames/0.png",
    );
    expect(screen.getByAltText("Reference frame 1")).toBeTruthy();

    // The action log — the output a run is actually scored on — is reachable from
    // every frame, at its own key beside the image.
    const logs = screen.getAllByRole("link", { name: "log" });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.getAttribute("href")).toBe(
      "https://snap.example/media/references/lattice-belt/v1.0.0/base/frames/0.actions.json",
    );

    // The case's own sheet spec supplies the sequences, so the motion is played
    // rather than only listed.
    expect(screen.getByLabelText("Run")).toBeTruthy();
    expect(screen.getByText("Run")).toBeTruthy();

    // A published sheet is a reference in its own right, so the layout offers the
    // tab off that signal alone — no `referenceBuilds` involved.
    expect(screen.getByRole("link", { name: "Reference" })).toBeTruthy();
  });

  it("resolves the frames under the ANCHORED version, not the latest", async () => {
    // A reference is published per case version, so anchoring an older version
    // must fetch that version's objects — the latest version's frames belong to
    // a different deliverable.
    catalog.mockReturnValue({
      testCases: [
        testCase({
          versions: ["v1.1.0", "v1.0.0"],
          latestVersion: "v1.1.0",
          variantsByVersion: {
            "v1.1.0": [{ slug: "base", name: "Base" }],
            "v1.0.0": [{ slug: "base", name: "Base" }],
          },
          enginesByVersion: { "v1.1.0": ["none"], "v1.0.0": ["none"] },
        }),
      ],
      status: "ready",
    });
    seedGalleryData(variant({ referenceSheet: { frames: [0] } }), {
      referenceMediaUrl,
    });
    renderReference("?version=v1.0.0");

    const frame0 = (await screen.findByAltText(
      "Reference frame 0",
    )) as HTMLImageElement;
    expect(frame0.src).toBe(
      "https://snap.example/media/references/lattice-belt/v1.0.0/base/frames/0.png",
    );
  });

  it("degrades to a placeholder when the host serves no reference media", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    // A host with no snapshot bucket wired up supplies no resolver at all.
    seedGalleryData(variant({ referenceSheet: { frames: [0] } }));
    renderReference();

    expect(await screen.findByText(/not available here/)).toBeTruthy();
    expect(screen.queryByAltText("Reference frame 0")).toBeNull();
  });

  it("shows the frames without animations when the host omits the sheet spec", async () => {
    // The static snapshot may not carry the case's `[sheet]`; the frames still
    // stand on their own, they just cannot be played as sequences.
    catalog.mockReturnValue({
      testCases: [testCase({ sheet: null })],
      status: "ready",
    });
    seedGalleryData(variant({ referenceSheet: { frames: [0, 1] } }), {
      referenceMediaUrl,
    });
    renderReference();

    expect(await screen.findByAltText("Reference frame 0")).toBeTruthy();
    expect(screen.queryByText("Animated sequences")).toBeNull();
  });

  it("redirects a builds-only variant to the detail landing, keeping the anchor", async () => {
    // A deployed reference BUILD no longer has a tab of its own — it folds into
    // the landing tab's Play surface — so a hand-typed /reference URL (or a
    // variant switch to a builds-only coordinate) lands there, with the query
    // string (the anchored coordinate) intact.
    catalog.mockReturnValue({
      testCases: [
        testCase({
          testType: "end-to-end",
          sheet: null,
          enginesByVersion: { "v1.0.0": ["none", "simple-2d"] },
        }),
      ],
      status: "ready",
    });
    seedGalleryData(
      variant({
        referenceBuilds: {
          "simple-2d": "https://ref.example/carom/base/simple-2d/",
        },
      }),
    );
    renderReference("?engine=simple-2d");

    expect(await screen.findByText("landing?engine=simple-2d")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("plays the scored factories through the reference engine for the performance case", async () => {
    // A performance case produces an engine, not a page or an image, so its
    // reference is what the authoritative engine does — and it ships with the
    // bundle rather than being published, so no variant signal and no host media
    // resolver is involved.
    catalog.mockReturnValue({
      testCases: [
        testCase({
          slug: "lattice",
          name: "Lattice",
          testType: "performance",
          difficulty: "hard",
          sheet: null,
        }),
      ],
      status: "ready",
    });
    seedGalleryData(variant());
    renderReference("", "lattice");

    // All three factories, each launchable, each labelled by scale and grid — and
    // nothing else. The tab is the reference, so the rows carry no prose.
    const play = await screen.findAllByRole("button", { name: "▶ Play" });
    expect(play).toHaveLength(3);
    expect(screen.getByText("Small — 24×12")).toBeTruthy();
    expect(screen.getByText("Medium — 48×32")).toBeTruthy();
    expect(screen.getByText("Large — 72×40")).toBeTruthy();

    // The tab is offered off the CASE alone — this variant declares neither of the
    // published reference signals, so the layout and the page have to agree that a
    // bundled playback is a reference in its own right.
    expect(screen.getByRole("link", { name: "Reference" })).toBeTruthy();

    // Nothing plays until asked: stepping a factory builds thousands of frames.
    expect(
      screen.queryByRole("dialog", { name: "Factory playback" }),
    ).toBeNull();
    fireEvent.click(play[2]!);
    const player = screen.getByRole("dialog", { name: "Factory playback" });
    // The player carries the same name that was clicked, so a full-viewport player
    // is still identifiable.
    expect(within(player).getByText("Large — 72×40")).toBeTruthy();

    // The player then goes off to fetch the vendored engine and scenario, which
    // jsdom cannot serve (there is no canvas or wasm here either — that stack is
    // covered by `renderer.integration.test.ts` against the real engine). Let that
    // failure land inside the test rather than after it, and assert the player
    // reports it instead of hanging on a blank canvas.
    await waitFor(() =>
      expect(
        within(player).getByText(/Could not play this scenario/),
      ).toBeTruthy(),
    );
  });

  it("offers no reference playback for a performance case the bundle has no factories for", async () => {
    // The scenarios are vendored for one case at build time, so a future
    // performance case must not be handed Lattice's factories. It falls through to
    // the ordinary per-variant signals, has neither, and so redirects to the
    // landing exactly like any other coordinate with nothing to show.
    catalog.mockReturnValue({
      testCases: [
        testCase({
          slug: "some-other-performance-case",
          testType: "performance",
          sheet: null,
        }),
      ],
      status: "ready",
    });
    seedGalleryData(variant());
    renderReference("", "some-other-performance-case");

    expect(await screen.findByText("landing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "▶ Play" })).toBeNull();
  });

  it("redirects to the detail landing when the variant declares no reference at all", async () => {
    // Only reachable by hand-typed URL (the layout offers no tab), but it must
    // not dead-end on an empty page — which is also what a backend old enough to
    // send no `referenceSheet` field produces.
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    seedGalleryData(variant());
    renderReference();

    expect(await screen.findByText("landing")).toBeTruthy();
  });
});
