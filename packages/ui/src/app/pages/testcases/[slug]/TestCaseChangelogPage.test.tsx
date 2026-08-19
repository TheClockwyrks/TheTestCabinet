import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseDetail } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseChangelogPage } from "./TestCaseChangelogPage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The catalog is injected through `useTestCase`; mock it so each test seeds an
// exact fixture. The layout also reads `useGalleryData` for the run/arena
// affordances — none of which the Changelog tab needs — so stub it minimally.
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

// A catalog entry carrying only the fields the Changelog tab and its layout read.
function testCase(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
    difficulty: "easy",
    tags: ["arcade"],
    summary: "A duel.",
    description: null,
    versions: ["v1.0.1", "v1.0.0"],
    latestVersion: "v1.0.1",
    variants: [{ slug: "base", name: "Base" }],
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

function renderChangelog(slug = "carom") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseChangelog(slug)]}>
      <Routes>
        <Route
          path={routePatterns.testCaseChangelog}
          element={<TestCaseChangelogPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseChangelogPage", () => {
  it("lists every version's entry newest-first", () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          changelog: [
            { version: "v1.0.1", body: "Proof clips are now WebM." },
            { version: "v1.0.0", body: "Introduced." },
          ],
        }),
      ],
      status: "ready",
    });
    renderChangelog();

    // Each entry renders as a collapsed accordion panel labeled with its version;
    // the bodies stay out of the DOM until a panel is opened. (The header also
    // shows the latest version, so "v1.0.1" legitimately appears more than once.)
    expect(screen.getAllByText("v1.0.1").length).toBeGreaterThan(0);
    expect(screen.getByText("v1.0.0")).toBeTruthy();
    expect(screen.queryByText("Proof clips are now WebM.")).toBeNull();
    expect(screen.queryByText("Introduced.")).toBeNull();

    // The newest version leads: its entry's toggle precedes the older one in
    // document order (Node.DOCUMENT_POSITION_FOLLOWING === 4 when `older` follows
    // `newer`).
    const newer = screen.getByRole("button", { name: /v1\.0\.1/ });
    const older = screen.getByRole("button", { name: /v1\.0\.0/ });
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows an empty state when no changelog is recorded", () => {
    catalog.mockReturnValue({
      testCases: [testCase({ changelog: [] })],
      status: "ready",
    });
    renderChangelog();

    expect(screen.getByText(/No changelog has been recorded/)).toBeTruthy();
  });
});
