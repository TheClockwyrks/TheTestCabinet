import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseChangelogPage } from "./TestCaseChangelogPage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The catalog is injected through `useTestCase`; mock it so each test seeds an
// exact fixture. The layout also reads `useGalleryData` for the run/arena
// affordances and the coordinate resolver — stub both per test.
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

// The anchored coordinate's variant, as the layout resolves it before it renders
// the tab body. The Changelog tab reads none of it beyond existing, so the
// minimum shape suffices.
function variantSummary(): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    referenceBuilds: {},
    referenceSheet: null,
  } as VariantSummary;
}

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
    variants: [{ slug: "base", name: "Base", referenceBuilds: {} }],
    variantsByVersion: {
      "v1.0.1": [{ slug: "base", name: "Base" }],
      "v1.0.0": [{ slug: "base", name: "Base" }],
    },
    enginesByVersion: { "v1.0.1": ["none"], "v1.0.0": ["none"] },
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

function renderChangelog(search = "", slug = "carom") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseChangelog(slug) + search]}>
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
  beforeEach(() => {
    // A NEW resolver per test: the coordinate resolution is cached per resolver
    // identity, so sharing one across tests would leak resolutions between them.
    galleryData.mockReturnValue({
      canExecute: false,
      arena: undefined,
      fetchCaseVariant: () => Promise.resolve(variantSummary()),
    });
  });

  it("lists every version newest-first with the anchored entry expanded", async () => {
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

    // Nothing anchors the page, so it opens on the latest version — whose entry
    // starts expanded (its body is in the DOM); the others stay collapsed.
    expect(await screen.findByText("Proof clips are now WebM.")).toBeTruthy();
    expect(screen.queryByText("Introduced.")).toBeNull();

    // The newest version leads: its entry's toggle precedes the older one in
    // document order (Node.DOCUMENT_POSITION_FOLLOWING === 4 when `older` follows
    // `newer`).
    const newer = screen.getByRole("button", { name: /v1\.0\.1/ });
    const older = screen.getByRole("button", { name: /v1\.0\.0/ });
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(newer.getAttribute("aria-expanded")).toBe("true");
    expect(older.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands the anchored version's entry when an older version is anchored", async () => {
    // The tab is whole-history — every version stays listed — but the entry the
    // reader came for is the anchored version's, so that one starts open.
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
    renderChangelog("?version=v1.0.0");

    expect(await screen.findByText("Introduced.")).toBeTruthy();
    expect(screen.queryByText("Proof clips are now WebM.")).toBeNull();
  });

  it("shows an empty state when no changelog is recorded", async () => {
    catalog.mockReturnValue({
      testCases: [testCase({ changelog: [] })],
      status: "ready",
    });
    renderChangelog();

    expect(
      await screen.findByText(/No changelog has been recorded/),
    ).toBeTruthy();
  });
});
