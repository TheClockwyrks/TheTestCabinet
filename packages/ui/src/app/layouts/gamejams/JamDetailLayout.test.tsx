import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseDetail } from "../../data/testCases";
import { JamDetailLayout } from "./JamDetailLayout";

// The layout's chrome reads app-wide contexts (the backdrop settings the page
// shell owns) that say nothing about the header these tests exercise, so the
// shell is stubbed to a plain wrapper.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: false }),
}));
// The jam the layout resolves from the slug. Held in a hoisted cell so a test
// can swap it before rendering (a `vi.mock` factory is hoisted above module
// scope and so cannot close over an ordinary `let`).
const fixture = vi.hoisted(() => ({ jam: null as unknown }));
vi.mock("../../data/useTestCase", () => ({
  useTestCase: () => ({ testCase: fixture.jam, status: "ready" }),
}));

function jam(): TestCaseDetail {
  return {
    slug: "neon-drift",
    name: "Neon Drift",
    testType: "game-jam",
    latestVersion: "v1.0.0",
    tags: ["arcade"],
    description: null,
    changelog: [],
    errata: [],
    variants: [{ slug: "base", name: "Base" }],
    domains: [],
  } as unknown as TestCaseDetail;
}

function renderLayout() {
  fixture.jam = jam();
  render(
    <MemoryRouter initialEntries={["/game-jams/neon-drift"]}>
      <Routes>
        <Route
          path="/game-jams/:slug"
          element={
            <JamDetailLayout tab="overview">
              {() => <p>body</p>}
            </JamDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JamDetailLayout", () => {
  it("titles the header with the jam", () => {
    renderLayout();
    expect(screen.getByRole("heading", { name: "Neon Drift" })).toBeTruthy();
  });

  // The jam pages shipped without the back control every other detail page
  // carries, stranding visitors on a jam with no way back to the list.
  it("offers a back control returning to the Game Jams list", () => {
    renderLayout();
    const back = screen.getByRole("link", { name: "All game jams" });
    expect(back.getAttribute("href")).toBe("/other/game-jams");
  });
});
