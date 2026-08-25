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
function variantSummary(ref: CaseVariantRef): VariantSummary {
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
  // but reading an old deliverable must never masquerade as the current one.
  it("marks a superseded version selection", async () => {
    renderLayout();
    await screen.findByText("body v2.0.0/base/none");
    expect(screen.queryByText("superseded")).toBeNull();

    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "v1.0.0" },
    });

    expect(await screen.findByText("superseded")).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toHaveAttribute(
      "data-superseded",
      "true",
    );
    await screen.findByText("body v1.0.0/base/none");
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
