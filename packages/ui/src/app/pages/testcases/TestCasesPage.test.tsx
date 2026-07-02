import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestType } from "@test-cabinet/run-record";
import type { TestCaseSummary } from "../../data/testCases";
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

function renderPage() {
  return render(
    <MemoryRouter>
      <TestCasesPage />
    </MemoryRouter>,
  );
}

function cardTitles(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

describe("TestCasesPage", () => {
  it("shows only the selected type's cases and switches with the segmented control", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Skyshard", "asset-generation"),
      testCase("Foray", "adversarial"),
    ]);

    renderPage();

    // Defaults to the end-to-end segment: only that type's case is listed.
    expect(cardTitles()).toEqual(["Sunfront"]);
    expect(screen.queryByText("Skyshard")).not.toBeInTheDocument();
    expect(screen.queryByText("Foray")).not.toBeInTheDocument();

    // The switcher is an ARIA radio group with one segment per test type.
    const group = screen.getByRole("radiogroup", { name: "Test type" });
    for (const label of ["E2E", "Asset", "Adversarial", "Performance"]) {
      within(group).getByRole("radio", { name: label });
    }

    // Switching to Adversarial scopes the grid to that type alone.
    fireEvent.click(within(group).getByRole("radio", { name: "Adversarial" }));
    expect(cardTitles()).toEqual(["Foray"]);
    expect(screen.queryByText("Sunfront")).not.toBeInTheDocument();
  });

  it("lists cases of a type alphabetically", () => {
    ready([
      testCase("Zephyr", "end-to-end"),
      testCase("Aurora", "end-to-end"),
      testCase("Meltdown", "end-to-end"),
    ]);

    renderPage();

    expect(cardTitles()).toEqual(["Aurora", "Meltdown", "Zephyr"]);
  });

  it("renders the difficulty and tag badges on the cards", () => {
    ready([
      testCase("Sunfront", "end-to-end", {
        difficulty: "hard",
        tags: ["rts", "arcade"],
      }),
    ]);

    renderPage();

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

    renderPage();
    const search = screen.getByRole("searchbox", { name: "Search test cases" });

    // A tag term keeps only the case that carries it.
    fireEvent.change(search, { target: { value: "arcade" } });
    expect(cardTitles()).toEqual(["Carom"]);

    // A difficulty term filters the same way.
    fireEvent.change(search, { target: { value: "hard" } });
    expect(cardTitles()).toEqual(["Sunfront"]);
  });

  it("shows an empty notice when the selected type has no cases", () => {
    ready([testCase("Skyshard", "asset-generation")]);

    renderPage();

    // Default type is end-to-end, which this catalog has none of.
    expect(screen.getByText("No test cases match.")).toBeInTheDocument();
    expect(cardTitles()).toEqual([]);
  });
});
