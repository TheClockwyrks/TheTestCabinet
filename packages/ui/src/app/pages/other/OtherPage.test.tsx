import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestType } from "@clockwyrks/run-record";
import type { TestCaseSummary } from "../../data/testCases";
import { routes } from "../../routes";
import { OtherPage, type OtherTab } from "./OtherPage";

// The page's chrome pulls in contexts (backdrop settings, prompt cursor) that are
// irrelevant to the tab behavior under test; stub them to bare wrappers.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// The Tournaments body reads the arena capability itself and is covered by its
// own tests; this suite is about which tabs the section offers.
vi.mock("../tournaments/TournamentsPage", () => ({
  TournamentsList: () => <p>tournaments body</p>,
}));

// The catalog is injected through `useTestCases`; mock it so each test seeds an
// exact fixture set rather than standing up a GalleryDataProvider.
const useTestCases = vi.fn();
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => useTestCases(),
}));

// The page reads `canExecute` (console vs. static site) and the arena capability
// off the gallery context; mock it so each test picks the host without a provider.
const useGalleryData = vi.fn();
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => useGalleryData(),
}));

// A catalog entry carrying only the fields the page reads; cast to the full
// summary rather than spell out every unused field.
function testCase(name: string, testType: TestType): TestCaseSummary {
  return {
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    testType,
    difficulty: "hard",
    tags: ["cozy"],
    summary: `${name} summary`,
  } as TestCaseSummary;
}

// Seed the catalog and the host. `canExecute` defaults to a console (true), where
// the tab bar is always the full set; pass `false` for the static gallery site,
// which shows only tabs it has entries for. A console carries the arena
// capability; the static site never does.
function ready(
  testCases: TestCaseSummary[],
  {
    canExecute = true,
    arena = canExecute,
  }: { canExecute?: boolean; arena?: boolean } = {},
) {
  useTestCases.mockReturnValue({ testCases, status: "ready" });
  useGalleryData.mockReturnValue({
    canExecute,
    arena: arena ? {} : undefined,
  });
}

// Seed the catalog with a read that did not settle: `status` without a resolved
// catalog (a first load in flight, or one that failed) and, for the stale case, a
// catalog that IS held with a failed re-read over it.
function unsettled(
  status: "loading" | "error",
  testCases: TestCaseSummary[] = [],
) {
  useTestCases.mockReturnValue({ testCases, status });
  useGalleryData.mockReturnValue({ canExecute: true, arena: {} });
}

function renderPage(tab: OtherTab = "game-jams") {
  const to =
    tab === "game-jams" ? routes.otherGameJams() : routes.otherTournaments();
  return render(
    <MemoryRouter initialEntries={[to]}>
      <OtherPage tab={tab} />
    </MemoryRouter>,
  );
}

function tabBar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Other sections" });
}

describe("OtherPage", () => {
  it("on a console, offers both tabs regardless of what the host holds", () => {
    ready([testCase("Sunfront", "end-to-end")]);

    renderPage("game-jams");

    const nav = tabBar();
    expect(
      within(nav).getByRole("link", { name: "Game Jams" }),
    ).toHaveAttribute("href", routes.otherGameJams());
    expect(
      within(nav).getByRole("link", { name: "Tournaments" }),
    ).toHaveAttribute("href", routes.otherTournaments());
    expect(
      within(nav).getByRole("link", { name: "Game Jams" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("on the static gallery, offers Game Jams and drops the tournaments tab it cannot list", () => {
    ready([testCase("Comfort Zone", "game-jam")], { canExecute: false });

    renderPage("game-jams");

    const nav = tabBar();
    within(nav).getByRole("link", { name: "Game Jams" });
    expect(within(nav).queryByRole("link", { name: "Tournaments" })).toBeNull();
  });

  it("on the static gallery, drops the game-jams tab when the catalog holds no jam", () => {
    ready([testCase("Sunfront", "end-to-end")], { canExecute: false });

    renderPage("game-jams");

    expect(within(tabBar()).queryAllByRole("link")).toEqual([]);
    expect(screen.getByText("No game jams yet.")).toBeInTheDocument();
  });

  it("lists every jam in the catalog, alphabetically, linking to its detail page", () => {
    ready(
      [
        testCase("Plot Twist", "game-jam"),
        testCase("Sunfront", "end-to-end"),
        testCase("Comfort Zone", "game-jam"),
      ],
      { canExecute: false },
    );

    renderPage("game-jams");

    expect(
      screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Comfort Zone", "Plot Twist"]);
    expect(screen.getByRole("link", { name: /Comfort Zone/ })).toHaveAttribute(
      "href",
      routes.gameJamDetail("comfort-zone"),
    );
    expect(screen.queryByText("Sunfront")).not.toBeInTheDocument();
  });

  // Render order, the same rule the models catalog follows: the jams the page
  // holds decide, and the read state only speaks when it holds none.
  it("keeps listing the jams it holds when a re-read fails", () => {
    unsettled("error", [testCase("Comfort Zone", "game-jam")]);

    renderPage("game-jams");

    expect(screen.getByRole("link", { name: /Comfort Zone/ })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/out of date/i);
    expect(screen.queryByText(/catalog is unavailable/i)).toBeNull();
    expect(screen.queryByText("No game jams yet.")).not.toBeInTheDocument();
  });

  it("waits rather than saying there are no jams while the catalog loads", () => {
    unsettled("loading");

    renderPage("game-jams");

    expect(screen.queryByText("No game jams yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/Loading catalog/i)).toBeTruthy();
  });

  it("reports an unreadable catalog as a failure, not as an empty one", () => {
    unsettled("error");

    renderPage("game-jams");

    expect(screen.queryByText("No game jams yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/catalog is unavailable/i)).toBeTruthy();
  });
});
