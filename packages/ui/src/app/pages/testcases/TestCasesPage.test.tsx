import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestType } from "@test-cabinet/run-record";
import type { TestCaseSummary } from "../../data/testCases";
import type { CatalogTab } from "../../routes";
import { routes } from "../../routes";
import { TestCasesPage } from "./TestCasesPage";

// The page's chrome pulls in contexts (backdrop settings, prompt cursor) that
// are irrelevant to the catalog behavior under test; stub them to bare wrappers.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

// The catalog is injected through `useTestCases`; mock it so each test seeds an
// exact fixture set rather than standing up a GalleryDataProvider.
const useTestCases = vi.fn();
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => useTestCases(),
}));

// A catalog entry carrying only the fields the page reads; cast to the full
// summary rather than spell out every unused field.
function testCase(
  name: string,
  testType: TestType,
  extra: Partial<TestCaseSummary> = {},
): TestCaseSummary {
  return {
    slug: name.toLowerCase(),
    name,
    testType,
    difficulty: "hard",
    tags: ["arcade"],
    summary: `${name} summary`,
    ...extra,
  } as TestCaseSummary;
}

function ready(testCases: TestCaseSummary[]) {
  useTestCases.mockReturnValue({ testCases, status: "ready" });
}

// Render the page at a given tab, with the router's location set to that tab's
// route so the tab bar's active link resolves.
function renderPage(tab: CatalogTab = "end-to-end") {
  return render(
    <MemoryRouter initialEntries={[routes.testCasesCatalog(tab)]}>
      <TestCasesPage tab={tab} />
    </MemoryRouter>,
  );
}

function cardTitles(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

describe("TestCasesPage", () => {
  it("shows only the tab's cases and renders a tab bar over every type", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Skyshard", "asset-generation"),
      testCase("Foray", "adversarial"),
    ]);

    renderPage("end-to-end");

    // The end-to-end tab lists only that type's case.
    expect(cardTitles()).toEqual(["Sunfront"]);
    expect(screen.queryByText("Skyshard")).not.toBeInTheDocument();
    expect(screen.queryByText("Foray")).not.toBeInTheDocument();

    // The switcher is a nav with one link per tab, each pointing at its route,
    // and the current tab marked active.
    const nav = screen.getByRole("navigation", { name: "Test type" });
    for (const label of [
      "E2E",
      "Sprite",
      "Voxel",
      "Adversarial",
      "Performance",
    ]) {
      within(nav).getByRole("link", { name: label });
    }
    expect(within(nav).getByRole("link", { name: "Adversarial" })).toHaveAttribute(
      "href",
      routes.testCasesCatalog("adversarial"),
    );
    expect(within(nav).getByRole("link", { name: "E2E" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("scopes the grid to the rendered tab's type", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Foray", "adversarial"),
    ]);

    renderPage("adversarial");

    expect(cardTitles()).toEqual(["Foray"]);
    expect(screen.queryByText("Sunfront")).not.toBeInTheDocument();
  });

  it("splits asset-generation into a Sprite tab and a Voxel tab by asset kind", () => {
    const cases = [
      testCase("Skyshard", "asset-generation", { assetKind: "sprite" }),
      testCase("Flarefish", "asset-generation", { assetKind: "sprite-sheet" }),
      testCase("Aegis", "asset-generation", { assetKind: "voxel-animation" }),
      testCase("Lanternjaw", "asset-generation", { assetKind: "mc-model" }),
    ];

    // The Sprite tab keeps the two 2D sprite kinds.
    ready(cases);
    const sprite = renderPage("sprite");
    expect(cardTitles()).toEqual(["Flarefish", "Skyshard"]);
    sprite.unmount();

    // The Voxel tab keeps the 3D voxel/mesh kinds.
    ready(cases);
    renderPage("voxel");
    expect(cardTitles()).toEqual(["Aegis", "Lanternjaw"]);
  });

  it("treats an asset case with no asset kind as a sprite", () => {
    ready([testCase("Skyshard", "asset-generation")]);

    renderPage("sprite");

    expect(cardTitles()).toEqual(["Skyshard"]);
  });

  it("lists cases of a type alphabetically", () => {
    ready([
      testCase("Zephyr", "end-to-end"),
      testCase("Aurora", "end-to-end"),
      testCase("Meltdown", "end-to-end"),
    ]);

    renderPage("end-to-end");

    expect(cardTitles()).toEqual(["Aurora", "Meltdown", "Zephyr"]);
  });

  it("renders the difficulty and tag badges on the cards", () => {
    ready([
      testCase("Sunfront", "end-to-end", {
        difficulty: "hard",
        tags: ["rts", "arcade"],
      }),
    ]);

    renderPage("end-to-end");

    // The difficulty level renders as a badge and each tag as its own pill.
    expect(screen.getByText("hard")).toBeInTheDocument();
    expect(screen.getByText("rts")).toBeInTheDocument();
    expect(screen.getByText("arcade")).toBeInTheDocument();
  });

  it("searches over tags and difficulty as well as the title", () => {
    ready([
      testCase("Sunfront", "end-to-end", { difficulty: "hard", tags: ["rts"] }),
      testCase("Carom", "end-to-end", {
        difficulty: "easy",
        tags: ["arcade"],
      }),
    ]);

    renderPage("end-to-end");
    const search = screen.getByRole("searchbox", { name: "Search test cases" });

    // A tag term keeps only the case that carries it.
    fireEvent.change(search, { target: { value: "arcade" } });
    expect(cardTitles()).toEqual(["Carom"]);

    // A difficulty term filters the same way.
    fireEvent.change(search, { target: { value: "hard" } });
    expect(cardTitles()).toEqual(["Sunfront"]);
  });

  it("shows an empty notice when the tab has no cases", () => {
    ready([testCase("Skyshard", "asset-generation", { assetKind: "sprite" })]);

    renderPage("end-to-end");

    // The end-to-end tab has none of this asset-only catalog.
    expect(screen.getByText("No test cases match.")).toBeInTheDocument();
    expect(cardTitles()).toEqual([]);
  });
});
