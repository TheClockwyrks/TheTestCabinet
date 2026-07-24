import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseReferencePage } from "./TestCaseReferencePage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The catalog is injected through `useTestCases`; mock it so each test seeds an
// exact fixture. The gallery data is read by both the layout (run/arena
// affordances) and the sheet view (the reference-media resolver), so it is stubbed
// per test — a host with no resolver at all is a case the view must handle.
const useTestCases = vi.fn();
vi.mock("../../../data/useTestCases", () => ({
  useTestCases: () => useTestCases(),
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
function testCase(extra: Partial<TestCaseSummary> = {}): TestCaseSummary {
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
  } as TestCaseSummary;
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
    useTestCases.mockReturnValue({
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
    useTestCases.mockReturnValue({
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
    useTestCases.mockReturnValue({
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
    useTestCases.mockReturnValue({
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

  it("plays the scored factories through the reference engine for the performance case", async () => {
    // A performance case produces an engine, not a page or an image, so its
    // reference is what the authoritative engine does — and it ships with the
    // bundle rather than being published, so no variant signal and no host
    // resolver is involved.
    useTestCases.mockReturnValue({
      testCases: [
        testCase({
          slug: "lattice",
          name: "Lattice",
          testType: "performance",
          difficulty: "hard",
          sheet: null,
          variants: [variant()],
        }),
      ],
      status: "ready",
    });
    galleryData.mockReturnValue({ canExecute: false, arena: undefined });
    renderReference("lattice");

    // All three factories, each launchable, each labelled by scale and grid — and
    // nothing else. The tab is the reference, so the rows carry no prose.
    const play = screen.getAllByRole("button", { name: "▶ Play" });
    expect(play).toHaveLength(3);
    expect(screen.getByText("Small — 24×12")).toBeTruthy();
    expect(screen.getByText("Medium — 48×32")).toBeTruthy();
    expect(screen.getByText("Large — 72×40")).toBeTruthy();

    // The tab is offered off the case alone — this variant declares neither of the
    // published reference signals.
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

  it("offers no reference playback for a performance case the bundle has no factories for", () => {
    // The scenarios are vendored for one case at build time, so a future performance
    // case must not be handed Lattice's factories. It falls through to the ordinary
    // per-variant signals, and has neither.
    useTestCases.mockReturnValue({
      testCases: [
        testCase({
          slug: "some-other-performance-case",
          testType: "performance",
          sheet: null,
          variants: [variant()],
        }),
      ],
      status: "ready",
    });
    galleryData.mockReturnValue({ canExecute: false, arena: undefined });
    renderReference("some-other-performance-case");

    expect(screen.queryByRole("button", { name: "▶ Play" })).toBeNull();
    expect(screen.getByText(/No reference implementation/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reference" })).toBeNull();
  });

  it("shows the no-reference placeholder when the variant declares neither", () => {
    // Only reachable by hand-typed URL (the layout hides the tab), but it must not
    // render an empty embed.
    useTestCases.mockReturnValue({
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
