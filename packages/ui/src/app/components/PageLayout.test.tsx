import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PageLayout } from "./PageLayout";
import { routes } from "../routes";

// The bar reads `canExecute` and `ggData` off the gallery context; its other
// controls fall back to their own signed-out/empty defaults without a provider,
// so only the context needs standing in for.
const gallery = vi.hoisted(() => ({ canExecute: false }));
vi.mock("../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: gallery.canExecute, ggData: undefined }),
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={[routes.home()]}>
      <PageLayout>
        <p>body</p>
      </PageLayout>
    </MemoryRouter>,
  );
}

// The desktop nav and the mobile sheet render the same link set, so scope every
// lookup to the inline nav rather than matching a label twice.
function sectionNav(): HTMLElement {
  return screen.getAllByRole("navigation")[0];
}

describe("PageLayout section nav", () => {
  it("offers Other on a console, alongside the standing sections", () => {
    gallery.canExecute = true;
    renderLayout();

    const nav = sectionNav();
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Test Cases", "Runs", "Models", "Other"]);
    expect(within(nav).getByRole("link", { name: "Other" })).toHaveAttribute(
      "href",
      routes.other(),
    );
  });

  it("offers Other on the static gallery too, with About beside it", () => {
    gallery.canExecute = false;
    renderLayout();

    const nav = sectionNav();
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Test Cases", "Runs", "Models", "Other", "About"]);
    expect(within(nav).getByRole("link", { name: "Other" })).toHaveAttribute(
      "href",
      routes.other(),
    );
  });
});
