import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Comparison } from "@clockwyrks/run-record/comparison";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { ConfirmDialogProvider } from "../../components/ConfirmDialog";
import { ComparisonsList } from "./ComparisonsList";

vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));
// An executing console: the mutating affordances are its to show. The value is a
// constant, as the real context's is — a fresh object each render would re-run
// the list's load effect on every render.
const GALLERY = { canExecute: true, comparisons: [] };
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => GALLERY,
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

const COMPARISON = {
  id: "cmp-1",
  userId: "u-1",
  name: "gg vs Pi",
  description: "",
  published: false,
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
  config: {
    controls: {
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
      engineSlug: "none",
    },
    arms: [
      { id: "a", label: "pi", harnessSlug: "pi", modelId: "m" },
      { id: "b", label: "gg", ggConfigId: "saved:x" },
    ],
    n: 3,
  },
  arms: [],
} as unknown as Comparison;

function renderList(overrides: Record<string, unknown> = {}) {
  const listComparisons = vi.fn().mockResolvedValue([COMPARISON]);
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <BackendProvider
          value={
            {
              client: { listComparisons, ...overrides },
              identity: null,
              status: "ready",
              error: null,
              url: null,
              setUrl: () => {},
            } as unknown as BackendContextValue
          }
        >
          <ComparisonsList />
        </BackendProvider>
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  return listComparisons;
}

describe("ComparisonsList", () => {
  it("links from the name only, so the card's other text is never underlined", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: "gg vs Pi" });
    // One link per row, named by the comparison alone. The whole card being an
    // `<a>` is what dragged the global `a:hover` underline across the stats and
    // the badge; the card is a click target again through a CSS overlay on this
    // link (`.rowTitleLink::after`), which adds no second link and no second
    // accessible name.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    // …and the stats are not inside it.
    expect(link).not.toHaveTextContent("N=3");
    expect(screen.getByText("N=3")).toBeInTheDocument();
  });

  it("keeps the delete button out of the card's link", async () => {
    // The overlay is the card's hit area, so the one control that must not
    // navigate has to stay outside the anchor — and above the overlay, which is
    // `.rowActions`' job in CSS.
    renderList({ deleteComparison: vi.fn() });
    const link = await screen.findByRole("link", { name: "gg vs Pi" });
    const button = screen.getByRole("button", { name: "Delete" });
    expect(link.contains(button)).toBe(false);
  });

  it("deletes a comparison through the themed dialog and refreshes the list", async () => {
    const deleteComparison = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const listComparisons = renderList({ deleteComparison });
    await screen.findByRole("link", { name: "gg vs Pi" });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Delete comparison");
    // The app's own modal, never the browser's (docs: UI overview → Dialogs).
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete comparison" }));
    await waitFor(() =>
      expect(deleteComparison).toHaveBeenCalledWith("cmp-1", "t"),
    );
    // Re-read, so the deleted row does not linger.
    await waitFor(() => expect(listComparisons).toHaveBeenCalledTimes(2));

    confirmSpy.mockRestore();
  });

  it("leaves the row alone when the question is answered no", async () => {
    const deleteComparison = vi.fn();
    renderList({ deleteComparison });
    await screen.findByRole("link", { name: "gg vs Pi" });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteComparison).not.toHaveBeenCalled();
  });

  it("shows no delete affordance to a host that cannot execute", async () => {
    // A transport with no `deleteComparison` — the read-only public gallery's —
    // offers nothing to press.
    renderList();
    await screen.findByRole("link", { name: "gg vs Pi" });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
