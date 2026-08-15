import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Erratum, TestCaseDetail } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseErrataPage } from "./TestCaseErrataPage";

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
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: false, arena: undefined }),
}));

function erratum(extra: Partial<Erratum> = {}): Erratum {
  return {
    id: "cue-clips-rail",
    title: "Cue ball clips the rail",
    date: "2026-07-17",
    severity: "major",
    affectsScoring: true,
    body: "Known tunnelling at high speed.",
    resolvedIn: "v1.1.0",
    variant: null,
    review: null,
    ...extra,
  };
}

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
    variants: [{ slug: "base", name: "Base" }],
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

function renderErrata(slug = "carom") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseErrata(slug)]}>
      <Routes>
        <Route
          path={routePatterns.testCaseErrata}
          element={<TestCaseErrataPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseErrataPage", () => {
  it("lists a version's errata with their badges", () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          errata: [{ version: "v1.0.0", errata: [erratum()] }],
        }),
      ],
      status: "ready",
    });
    renderErrata();
    expect(
      screen.getByRole("heading", { level: 2, name: "v1.0.0" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cue ball clips the rail")).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Affects scoring")).toBeInTheDocument();
    expect(screen.getByText("Resolved in v1.1.0")).toBeInTheDocument();
    expect(
      screen.getByText("Known tunnelling at high speed."),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no errata are recorded", () => {
    catalog.mockReturnValue({
      testCases: [testCase({ errata: [] })],
      status: "ready",
    });
    renderErrata();
    expect(
      screen.getByText(/No errata have been recorded for Carom/),
    ).toBeInTheDocument();
  });
});
