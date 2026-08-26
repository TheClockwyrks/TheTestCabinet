import { render, screen } from "@testing-library/react";
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
