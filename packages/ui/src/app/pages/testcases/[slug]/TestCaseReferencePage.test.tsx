import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
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
// exact fixture. The gallery data is read by both the layout (run/arena
// affordances) and the sheet view (the reference-media resolver), so it is stubbed
// per test — a host with no resolver at all is a case the view must handle.
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
    referenceBuild: null,
    referenceSheet: null,
    ...extra,
  } as VariantSummary;
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

function renderReference(slug = "lattice-belt") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseReference(slug)]}>
      <Routes>
        <Route
          path={routePatterns.testCaseReference}
          element={<TestCaseReferencePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseReferencePage", () => {
  it("renders the published frames and their action logs for an asset case", () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          variants: [variant({ referenceSheet: { frames: [0, 1] } })],
        }),
      ],
      status: "ready",
    });
    galleryData.mockReturnValue({
      canExecute: false,
      arena: undefined,
      referenceMediaUrl,
    });
    renderReference();

    // One image per published frame, at the deterministic key.
    const frame0 = screen.getByAltText("Reference frame 0") as HTMLImageElement;
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
    // tab off that signal alone — no `referenceBuild` involved.
    expect(screen.getByRole("link", { name: "Reference" })).toBeTruthy();
  });

  it("degrades to a placeholder when the host serves no reference media", () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({ variants: [variant({ referenceSheet: { frames: [0] } })] }),
      ],
      status: "ready",
    });
    // A host with no snapshot bucket wired up supplies no resolver at all.
    galleryData.mockReturnValue({ canExecute: false, arena: undefined });
    renderReference();

    expect(screen.getByText(/not available here/)).toBeTruthy();
    expect(screen.queryByAltText("Reference frame 0")).toBeNull();
  });

  it("shows the frames without animations when the host omits the sheet spec", () => {
    // The static snapshot may not carry the case's `[sheet]`; the frames still
    // stand on their own, they just cannot be played as sequences.
    catalog.mockReturnValue({
      testCases: [
        testCase({
          sheet: null,
          variants: [variant({ referenceSheet: { frames: [0, 1] } })],
        }),
      ],
      status: "ready",
    });
    galleryData.mockReturnValue({
      canExecute: false,
      arena: undefined,
      referenceMediaUrl,
    });
    renderReference();

    expect(screen.getByAltText("Reference frame 0")).toBeTruthy();
    expect(screen.queryByText("Animated sequences")).toBeNull();
  });

  it("still embeds a deployed reference build for an end-to-end variant", () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          testType: "end-to-end",
          sheet: null,
          variants: [
            variant({ referenceBuild: "https://ref.example/carom/base/" }),
          ],
        }),
      ],
      status: "ready",
    });
    galleryData.mockReturnValue({ canExecute: false, arena: undefined });
    renderReference();

    const frame = screen.getByTitle("Reference implementation for Base");
    expect(frame.getAttribute("src")).toBe("https://ref.example/carom/base/");
  });

  it("shows the no-reference placeholder when the variant declares neither", () => {
    // Only reachable by hand-typed URL (the layout hides the tab), but it must not
    // render an empty embed.
    catalog.mockReturnValue({
      testCases: [testCase({ variants: [variant()] })],
      status: "ready",
    });
    galleryData.mockReturnValue({ canExecute: false, arena: undefined });
    renderReference();

    expect(screen.getByText(/No reference implementation/)).toBeTruthy();
    // …and the layout offers no tab to reach it by — which is also what a backend
    // old enough to send no `referenceSheet` at all produces.
    expect(screen.queryByRole("link", { name: "Reference" })).toBeNull();
  });
});
