import type { SuiteOut } from "@clockwyrks/backend-api";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TestSuitesPage } from "./test-suites-page";
import { routes } from "../../routes";

// The page's chrome pulls in contexts irrelevant to the listing under test; stub
// them, the way the catalog page's suite does.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => <div />,
}));
// The tab bar is covered by its own suite; the page's job is to render it with
// the suites selection.
vi.mock("./catalog-tabs", () => ({
  CatalogTabs: ({ active }: { active: string }) => (
    <div data-testid="catalog-tabs" data-active={active} />
  ),
}));

const useTestSuites = vi.fn<() => unknown>();
vi.mock("../../data/use-test-suites", () => ({
  useTestSuites: () => useTestSuites(),
}));

function suite(slug: string, experimental = false): SuiteOut {
  return {
    slug,
    // Oldest first, the order the backend serves.
    versions: [
      {
        version: "v1.0.0",
        name: "Carom",
        summary: "The first cut.",
        tags: ["arcade"],
        experimental: false,
      },
      {
        version: "v2.0.0",
        name: "Carom",
        summary: "A pool-table arcade game.",
        tags: ["arcade", "2d"],
        experimental,
      },
    ],
  };
}

function renderPage(state: {
  suites: SuiteOut[];
  status: "loading" | "ready" | "error";
  error?: string | null;
}) {
  useTestSuites.mockReturnValue({
    error: null,
    reload: () => Promise.resolve(),
    ...state,
  });
  return render(
    <MemoryRouter initialEntries={[routes.testCasesSuites()]}>
      <TestSuitesPage />
    </MemoryRouter>,
  );
}

describe("TestSuitesPage", () => {
  it("lists each suite with its identity at the newest version", () => {
    renderPage({ suites: [suite("carom")], status: "ready" });

    // Name, slug and newest version share the card's first row.
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Carom");
    expect(screen.getByText("carom")).toBeInTheDocument();
    // The newest version heads the card and leads the version links.
    expect(screen.getAllByText("v2.0.0")).toHaveLength(2);
    // The newest version's summary and tags, not the older version's.
    expect(screen.getByText("A pool-table arcade game.")).toBeInTheDocument();
    expect(screen.queryByText("The first cut.")).not.toBeInTheDocument();
    expect(screen.getByText("2d")).toBeInTheDocument();
    // The name links into the suite's detail surface.
    expect(
      within(heading).getByRole("link", { name: "Carom" }),
    ).toHaveAttribute("href", routes.testSuiteDetail("carom"));
  });

  it("makes every version the suite holds reachable, newest first", () => {
    renderPage({ suites: [suite("carom")], status: "ready" });

    const versions = screen
      .getAllByRole("link")
      .filter((link) => /^v\d/.test(link.textContent));
    expect(versions.map((link) => link.textContent)).toEqual([
      "v2.0.0",
      "v1.0.0",
    ]);
    expect(versions[1]).toHaveAttribute(
      "href",
      routes.testSuiteDetail("carom", "v1.0.0"),
    );
  });

  it("labels a suite the backend serves as experimental", () => {
    renderPage({ suites: [suite("carom", true)], status: "ready" });
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("leaves a suite served as non-experimental unlabeled", () => {
    renderPage({ suites: [suite("carom")], status: "ready" });
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  });

  it("renders the tab bar with the suites tab selected", () => {
    renderPage({ suites: [suite("carom")], status: "ready" });
    expect(screen.getByTestId("catalog-tabs")).toHaveAttribute(
      "data-active",
      "suites",
    );
  });

  it("shows the loading state until the first read settles", () => {
    renderPage({ suites: [], status: "loading" });
    expect(screen.getByText("Loading test suites…")).toBeInTheDocument();
  });

  it("shows the empty state for a deployment that offers none", () => {
    renderPage({ suites: [], status: "ready" });
    expect(
      screen.getByText("This deployment offers no test suites."),
    ).toBeInTheDocument();
  });

  it("shows a failed first read in place of the listing", () => {
    renderPage({ suites: [], status: "error", error: "boom" });
    expect(
      screen.getByText(/the test suites are unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a failed re-read as a notice above the rows it holds", () => {
    renderPage({ suites: [suite("carom")], status: "error", error: "boom" });

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("may be out of date");
    expect(notice).toHaveTextContent("boom");
    // The held listing is still rendered under it.
    screen.getByRole("heading", { level: 2, name: /Carom/ });
  });
});
