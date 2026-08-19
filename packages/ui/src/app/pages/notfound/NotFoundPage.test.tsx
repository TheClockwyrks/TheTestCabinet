import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

// The page reads only `canExecute` off the gallery context, and `PageLayout`
// reads the same. Stubbing the layout keeps this about the not-found body rather
// than about the app chrome, which has its own tests.
const gallery = vi.hoisted(() => ({ canExecute: false }));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: gallery.canExecute }),
}));
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <NotFoundPage />
    </MemoryRouter>,
  );
}

describe("NotFoundPage", () => {
  it("says what happened rather than rendering an empty body", () => {
    renderAt("/nonsense");
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Nothing at this address",
    );
  });

  it("echoes the path that was asked for, so a typo is visible", () => {
    renderAt("/runs/typoed-id/plya");
    expect(screen.getByText("/runs/typoed-id/plya")).toBeInTheDocument();
  });

  it("offers somewhere to go instead", () => {
    renderAt("/nonsense");
    const nav = screen.getByRole("navigation", {
      name: "Somewhere to go instead",
    });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recent runs" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "All runs" })).toHaveAttribute(
      "href",
      "/runs",
    );
  });

  it("offers About on the gallery and Other on a console, matching the nav", () => {
    gallery.canExecute = false;
    const { unmount } = renderAt("/nonsense");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
    unmount();

    gallery.canExecute = true;
    renderAt("/nonsense");
    expect(screen.getByRole("link", { name: "Other" })).toHaveAttribute(
      "href",
      "/other",
    );
  });
});
