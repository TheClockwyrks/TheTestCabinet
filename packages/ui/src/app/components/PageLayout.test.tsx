import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArtifactStorage } from "../runtime/artifactStorage";
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
  return screen.getAllByRole("navigation")[0]!;
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

// The standing notice about the artifact store sits in the chrome, so it is on
// whatever page the operator is on.
describe("PageLayout storage notice", () => {
  beforeEach(() => {
    useArtifactStorage.setState({ byWorker: {} });
  });

  it("shows nothing while no backend has reported a problem", () => {
    gallery.canExecute = true;
    renderLayout();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("states a hold on new runs above the page body", () => {
    gallery.canExecute = true;
    useArtifactStorage.getState().setStatus("w1", {
      state: "blocked",
      runsOnHold: true,
      runsWaitingToStore: 0,
      warnBytes: 3 * 1024 ** 3,
      stopBytes: 2 * 1024 ** 3,
    });
    renderLayout();

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      "New runs are on hold: artifact storage is full",
    );
    // Before the body in document order: under the topbar, not after the page.
    const body = screen.getByText("body");
    expect(
      notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
