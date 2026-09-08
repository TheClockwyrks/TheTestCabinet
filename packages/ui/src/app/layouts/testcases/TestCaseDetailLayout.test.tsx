import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseVariantRef } from "../../data/galleryContext";
import type { TestCaseDetail, VariantSummary } from "../../data/testCases";
import { routePatterns, routes } from "../../routes";
import { TestCaseDetailLayout } from "./TestCaseDetailLayout";

// The layout's chrome pulls in PageLayout (backdrop/prompt contexts) that are
// irrelevant here; stub it to a bare wrapper.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const catalog = vi.fn<() => { testCases: TestCaseDetail[]; status: string }>();
// The layout resolves the case it is about through `useTestCase` (a per-slug
// fetch), so the stub answers from the fixture catalog each test seeds.
vi.mock("../../data/useTestCase", () => ({
  useTestCase: (slug: string | undefined) => {
    const { testCases, status } = catalog();
    return { testCase: testCases.find((c) => c.slug === slug), status };
  },
}));

// The host the layout resolves the anchored coordinate through. Held in a
// hoisted cell (a `vi.mock` factory is hoisted above module scope) so each test
// seeds its own resolver: the resolution cache keys on the resolver's identity,
// and a fresh function per test keeps one test's resolved coordinates from
// leaking into the next.
const host = vi.hoisted(() => ({
  canExecute: true,
  fetchCaseVariant: (() => Promise.resolve(null)) as (
    ref: CaseVariantRef,
  ) => Promise<VariantSummary | null>,
}));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({
    canExecute: host.canExecute,
    arena: undefined,
    fetchCaseVariant: host.fetchCaseVariant,
  }),
}));

// A resolved rendering named after the coordinates it was asked for, so a test
// can tell from the body alone which coordinate the layout actually resolved.
function variantSummary(
  ref: CaseVariantRef,
  extra: Partial<VariantSummary> = {},
): VariantSummary {
  return {
    slug: ref.variant,
    name: "Base",
    description: null,
    prompt: "Build the thing.",
    seededInputs: [],
    packages: [],
    referenceScreenshots: [],
    reviewItems: [],
    domains: [],
    validatorRated: false,
    referenceBuilds: {},
    referenceSheet: null,
    ...extra,
  } as VariantSummary;
}

function testCase(): TestCaseDetail {
  return {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
    difficulty: "easy",
    tags: [],
    summary: null,
    description: null,
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
    enginesByVersion: {
      "v2.0.0": ["none", "simple-2d"],
      "v1.0.0": ["none"],
    },
    variantsByVersion: {
      "v2.0.0": [{ slug: "base", name: "Base" }],
      "v1.0.0": [{ slug: "base", name: "Base" }],
    },
    variants: [{ slug: "base", name: "Base", referenceBuilds: {} }],
    changelog: [],
    errata: [],
  } as unknown as TestCaseDetail;
}

function renderLayout(url = routes.testCaseDetail("carom")) {
  catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path={routePatterns.testCaseDetail}
          element={
            <TestCaseDetailLayout tab="overview">
              {(ctx) => (
                <p>
                  body {ctx.version}/{ctx.variant.slug}/{ctx.engine}
                </p>
              )}
            </TestCaseDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseDetailLayout", () => {
  beforeEach(() => {
    host.canExecute = true;
    // A new identity per test — see the cell's comment.
    host.fetchCaseVariant = vi.fn(async (ref: CaseVariantRef) =>
      variantSummary(ref),
    );
  });

  // The Run action opens the new-run form on exactly what is being viewed, so
  // its href must carry the whole anchored coordinate — with the engineless
  // default elided, and re-built as the header selections change.
  it("carries the selected coordinate on the Run action", async () => {
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    expect(
      screen.getByRole("link", { name: "Run ▸" }).getAttribute("href"),
    ).toBe("/runs/new?slug=carom&version=v2.0.0&variant=base");

    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });
    await screen.findByText("body v2.0.0/base/simple-2d");
    expect(
      screen.getByRole("link", { name: "Run ▸" }).getAttribute("href"),
    ).toBe("/runs/new?slug=carom&version=v2.0.0&variant=base&engine=simple-2d");

    // Switching to the version that lacks the engine scrubs it from the
    // coordinate — and so from the launch link.
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "v1.0.0" },
    });
    await screen.findByText("body v1.0.0/base/none");
    expect(
      screen.getByRole("link", { name: "Run ▸" }).getAttribute("href"),
    ).toBe("/runs/new?slug=carom&version=v1.0.0&variant=base");
  });

  // A superseded selection is legitimate — its runs were judged against it —
  // but reading an old deliverable must never masquerade as the current one:
  // a line under the tab strip names the viewed version and links to the
  // latest. The selector itself carries no marker.
  it("notes a superseded version selection under the tab strip", async () => {
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");
    expect(screen.queryByText(/Viewing v/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "v1.0.0" },
    });

    await screen.findByText("body v1.0.0/base/none");
    const notice = screen.getByText(/Viewing v1\.0\.0; latest is/);
    expect(notice).toHaveTextContent("Viewing v1.0.0; latest is v2.0.0");
    expect(screen.getByLabelText("Version")).not.toHaveAttribute(
      "data-superseded",
    );
    expect(screen.queryByText("superseded")).toBeNull();

    // The latest version is a link that re-anchors the page to it, and the
    // notice then goes away.
    const latest = screen.getByRole("link", { name: "v2.0.0" });
    expect(latest.getAttribute("href")).toBe("/test-cases/carom");
    fireEvent.click(latest);
    await screen.findByText("body v2.0.0/base/none");
    expect(screen.queryByText(/Viewing v/)).toBeNull();
    expect(screen.getByLabelText("Version")).toHaveValue("v2.0.0");
  });

  // The header reads version and Run on the title row, engine then variant on
  // the tags row.
  it("lays the header out as version + Run, then engine + variant", async () => {
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    const version = screen.getByLabelText("Version");
    const run = screen.getByRole("link", { name: "Run ▸" });
    const engine = screen.getByLabelText("Engine");
    const variant = screen.getByLabelText("Variant");
    const rowOf = (el: HTMLElement) => el.closest("header > div");
    expect(rowOf(version)).not.toBeNull();
    expect(rowOf(version)).toBe(rowOf(run));
    expect(rowOf(engine)).toBe(rowOf(variant));
    expect(rowOf(engine)).not.toBe(rowOf(version));
    // The title row precedes the tags row.
    expect(
      rowOf(version)!.compareDocumentPosition(rowOf(engine)!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Engine precedes variant within the row.
    expect(
      engine.compareDocumentPosition(variant) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // The landing tab's label follows what the resolved coordinate can offer:
  // "Play" when there is something to play, the plain "Overview" otherwise. The
  // route and tab id never move, so both labels resolve to the same link.
  it("labels the landing tab Overview when the coordinate has nothing to play", async () => {
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    const landing = screen.getByRole("link", { name: "Overview" });
    expect(landing.getAttribute("href")).toBe("/test-cases/carom");
    expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  });

  it("labels the landing tab Play when the coordinate has showcase media", async () => {
    host.fetchCaseVariant = vi.fn(async (ref: CaseVariantRef) =>
      variantSummary(ref, {
        showcase: {
          description: "Captured from the reference implementation.",
          media: [{ file: "title.png", name: "Title screen", kind: "image" }],
        },
      }),
    );
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    const landing = screen.getByRole("link", { name: "Play" });
    expect(landing.getAttribute("href")).toBe("/test-cases/carom");
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
  });

  // A reference BUILD no longer earns its own tab: it folds into the landing
  // tab's Play surface, which the label advertises.
  it("labels the landing tab Play for reference builds and offers no Reference tab", async () => {
    host.fetchCaseVariant = vi.fn(async (ref: CaseVariantRef) =>
      variantSummary(ref, {
        referenceBuilds: { none: "https://ref.example/carom/base/" },
      }),
    );
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    expect(screen.getByRole("link", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reference" })).toBeNull();
  });

  // Published reference FRAMES (asset-generation cases) are the one shape that
  // still gets the Reference tab — and frames alone are nothing to "play", so
  // the landing label stays Overview.
  it("offers the Reference tab only for a variant with a reference sheet", async () => {
    host.fetchCaseVariant = vi.fn(async (ref: CaseVariantRef) =>
      variantSummary(ref, { referenceSheet: { frames: [0, 1] } }),
    );
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");

    expect(
      screen.getByRole("link", { name: "Reference" }).getAttribute("href"),
    ).toBe("/test-cases/carom/reference");
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
  });

  // Which tabs exist (Reference) is a fact about the resolved coordinate, so
  // the tab strip waits with the body rather than flashing a wrong set.
  it("holds the tab strip and body until the coordinate resolves", async () => {
    let release!: (value: VariantSummary | null) => void;
    host.fetchCaseVariant = () =>
      new Promise<VariantSummary | null>((resolve) => {
        release = resolve;
      });
    renderLayout();

    // The header is up (the selectors stay interactive) while the section
    // spinner stands in for tab strip and body.
    expect(screen.getByRole("heading", { name: "Carom" })).toBeInTheDocument();
    expect(screen.getByText("Loading test case…")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Test case sections" }),
    ).toBeNull();
    expect(screen.queryByText(/^body /)).toBeNull();

    await act(async () => {
      release(
        variantSummary({
          slug: "carom",
          version: "v2.0.0",
          variant: "base",
          engine: "none",
        }),
      );
    });

    expect(
      screen.getByRole("navigation", { name: "Test case sections" }),
    ).toBeInTheDocument();
    expect(screen.getByText("body v2.0.0/base/none")).toBeInTheDocument();
  });
});
