import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { TournamentDetailPage } from "./TournamentDetailPage";

// The page shell owns the animated backdrop, which says nothing about the header
// these tests exercise, so it is stubbed to a plain wrapper.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// No arena capability: the page degrades to its "not available here" note, which
// is exactly the state a deep link most needs a way out of.
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({ arena: null }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
vi.mock("../../data/useControllerName", () => ({
  useControllerName: () => () => "controller",
}));

describe("TournamentDetailPage", () => {
  // The tournament page shipped without the back control every other detail page
  // carries, stranding visitors with no way back to the list.
  it("offers a back control returning to the Tournaments list", () => {
    render(
      <MemoryRouter initialEntries={["/tournaments/t-1"]}>
        <Routes>
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const back = screen.getByRole("link", { name: "All tournaments" });
    expect(back.getAttribute("href")).toBe("/other/tournaments");
  });
});
