import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  AESTHETIC_META,
  AESTHETIC_RATINGS,
  RATINGS,
  RATING_META,
} from "../../data/ratings";
import { AboutRatingsPage } from "./AboutRatingsPage";

// The About layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function renderRatings() {
  return render(
    <MemoryRouter initialEntries={["/about/ratings"]}>
      <AboutRatingsPage />
    </MemoryRouter>,
  );
}

describe("AboutRatingsPage", () => {
  it("lists every functional tier under its scale", () => {
    renderRatings();
    const heading = screen.getByRole("heading", {
      name: "Functional rating scale",
    });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    for (const rating of RATINGS) {
      expect(
        within(section as HTMLElement).getByText(RATING_META[rating].label),
      ).toBeInTheDocument();
    }
  });

  it("lists every aesthetic tier under its scale", () => {
    renderRatings();
    const heading = screen.getByRole("heading", {
      name: "Aesthetic rating scale",
    });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    for (const rating of AESTHETIC_RATINGS) {
      expect(
        within(section as HTMLElement).getByText(AESTHETIC_META[rating].label),
      ).toBeInTheDocument();
    }
  });

  it("describes the aesthetic channel as run-wide, not per domain", () => {
    renderRatings();
    expect(screen.getByText(/for the whole run/)).toBeInTheDocument();
    expect(screen.getByText(/worst tier across its reviews/)).toBeInTheDocument();
    expect(screen.queryByText(/per domain/)).toBeNull();
  });
});
