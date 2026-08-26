import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseReviewingPage } from "./TestCaseReviewingPage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

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

function testCase(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
    difficulty: "easy",
    tags: ["arcade"],
    summary: "A duel.",
    description: null,
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    domains: [],
    variants: [{ slug: "base", name: "Base", referenceBuilds: {} }],
    variantsByVersion: { "v1.0.0": [{ slug: "base", name: "Base" }] },
    enginesByVersion: { "v1.0.0": ["none"] },
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

/** The rubric the fixture variant carries: one domain and one checklist item. */
function variant(extra: Partial<VariantSummary> = {}): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    referenceBuilds: {},
    referenceSheet: null,
    domains: [
      {
        id: "gameplay",
        name: "Gameplay",
        description: "How the duel actually plays.",
      },
    ],
    reviewItems: [
      {
        id: "cue-rebounds",
        title: "Cue rebounds",
        text: "The cue ball rebounds off every rail.",
        weight: 2,
        domain: "gameplay",
      },
    ],
    validatorRated: false,
    ...extra,
  } as VariantSummary;
}

function renderReviewing(fixture: VariantSummary) {
  // A NEW resolver per render: the layout's coordinate resolution is cached per
  // resolver identity, so sharing one across tests would leak resolutions.
  galleryData.mockReturnValue({
    canExecute: false,
    arena: undefined,
    fetchCaseVariant: () => Promise.resolve(fixture),
  });
  catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
  return render(
    <MemoryRouter initialEntries={[routes.testCaseReviewing("carom")]}>
      <Routes>
        <Route
          path={routePatterns.testCaseReviewing}
          element={<TestCaseReviewingPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseReviewingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the domains and checklist, linking the rating scales to About → Ratings", async () => {
    renderReviewing(variant());
    expect(
      await screen.findByRole("heading", { name: "Scoring domains" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Gameplay")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reviewer checklist" }),
    ).toBeInTheDocument();
    // The row prefixes the title with its number and suffixes the weight, so
    // match the title as a substring of the composed row text.
    expect(screen.getByText(/Cue rebounds/)).toBeInTheDocument();

    // The scales themselves moved to About → Ratings; the intro links there.
    expect(
      screen.queryByRole("heading", { name: /rating scale/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ratings" })).toHaveAttribute(
      "href",
      routes.aboutRatings(),
    );
  });

  it("keeps the scales off a validator-rated variant too", async () => {
    renderReviewing(variant({ validatorRated: true }));
    expect(
      await screen.findByRole("heading", { name: "Scoring domains" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/validator-rated/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /rating scale/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ratings" })).toHaveAttribute(
      "href",
      routes.aboutRatings(),
    );
  });
});
