import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { CatalogTabs } from "./catalog-tabs";
import type { TestCaseSummary } from "../../data/testCases";
import { routes } from "../../routes";

// The bar reads the catalog, the host, and whether the transport exposes the
// suite reads. Mock all three so a test picks the host without standing up the
// provider stack.
const useTestCases = vi.fn<() => unknown>();
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => useTestCases(),
}));
const useGalleryData = vi.fn<() => unknown>();
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => useGalleryData(),
}));
const useSuiteReads = vi.fn<() => unknown>();
vi.mock("../../data/use-test-suites", () => ({
  useSuiteReads: () => useSuiteReads(),
}));

function testCase(name: string): TestCaseSummary {
  return {
    slug: name.toLowerCase(),
    name,
    testType: "end-to-end",
    difficulty: "hard",
    tags: [],
    summary: "",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
  } as unknown as TestCaseSummary;
}

function renderBar(
  {
    suiteReads,
    canExecute = true,
  }: { suiteReads: boolean; canExecute?: boolean },
  active: Parameters<typeof CatalogTabs>[0]["active"] = "end-to-end",
) {
  useTestCases.mockReturnValue({
    testCases: [testCase("Sunfront")],
    status: "ready",
  });
  useGalleryData.mockReturnValue({ canExecute });
  useSuiteReads.mockReturnValue(suiteReads);
  return render(
    <MemoryRouter initialEntries={["/test-cases/end-to-end"]}>
      <CatalogTabs active={active} />
    </MemoryRouter>,
  );
}

function bar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Test type" });
}

describe("CatalogTabs", () => {
  it("leads with Test Suites where the transport exposes the suite reads", () => {
    renderBar({ suiteReads: true });

    const links = within(bar()).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Test Suites");
    expect(links[0]).toHaveAttribute("href", routes.testCasesSuites());
  });

  it("omits Test Suites where the transport lacks the suite reads", () => {
    renderBar({ suiteReads: false });

    expect(
      within(bar()).queryByRole("link", { name: "Test Suites" }),
    ).not.toBeInTheDocument();
    // The bar is otherwise exactly the one the catalog has always rendered.
    expect(within(bar()).getAllByRole("link")[0]).toHaveTextContent("E2E");
  });

  it("marks the Test Suites entry active when it is the selection", () => {
    renderBar({ suiteReads: true }, "suites");

    const suites = within(bar()).getByRole("link", { name: "Test Suites" });
    expect(suites.className).toMatch(/tabActive/);
    expect(
      within(bar()).getByRole("link", { name: "E2E" }).className,
    ).not.toMatch(/tabActive/);
  });

  it("on the static site, still advertises only tabs the catalog has cases for", () => {
    renderBar({ suiteReads: false, canExecute: false });

    within(bar()).getByRole("link", { name: "E2E" });
    expect(
      within(bar()).queryByRole("link", { name: "Performance" }),
    ).not.toBeInTheDocument();
  });
});
