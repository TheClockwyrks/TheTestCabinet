import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../client/auth";
import type { WorkerClient } from "../../../client/clients";
import { WorkersProvider } from "../../../client/context";
import type { WorkersContextValue } from "../../../client/context";
import type { UnreadableRun } from "../../../client/types";
import { ConfirmDialogProvider } from "../../components/ConfirmDialog";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { RunsRuntimeProvider } from "../../runtime/runsRuntime";
import { UnreadableRunsPage } from "./UnreadableRunsPage";

// One row of the unreadable listing: the identity the backend lifted into columns
// plus the error its stored record produces now. Deliberately carries no record —
// that is the whole reason the run is on this listing.
function unreadable(
  id: string,
  opts: { published?: boolean; error?: string } = {},
): UnreadableRun {
  const { published = false, error = "missing field `interp`" } = opts;
  return {
    id,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T01:00:00Z",
    testCaseSlug: "voxel-rig",
    testCaseVersion: "v1.0.0",
    variant: "base",
    engineSlug: "none",
    harnessSlug: "claude",
    modelId: "anthropic/claude",
    ggPreset: null,
    testType: "asset-generation",
    state: "completed",
    published,
    reviewCount: 0,
    error,
  };
}

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    // The produced worklist never holds an unreadable run, which is exactly why
    // the delete gate on this page does not consult it.
    localIds: new Set<string>(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function renderPage(runs: UnreadableRun[], opts: { total?: number } = {}) {
  localStorage.setItem(
    "tcab.auth",
    JSON.stringify({ token: "tok", account: { username: "zach" } }),
  );
  const deleteRun = vi.fn(async () => {});
  const listUnreadableRuns = vi.fn(
    async (_opts?: { limit?: number; offset?: number }) => ({
      runs,
      total: opts.total ?? runs.length,
    }),
  );
  const client = {
    listUnreadableRuns,
    deleteRun,
    setRunLifecycleEnabled: async () => {},
  } as unknown as WorkerClient;
  const workers = {
    workers: [],
    activeId: "w1",
    active: { id: "w1", label: "Worker", url: null, local: true, client },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  render(
    <MemoryRouter>
      <WorkersProvider value={workers}>
        <AuthProvider>
          <ConfirmDialogProvider>
            <RunsRuntimeProvider>
              <GalleryDataProvider value={galleryValue()}>
                <UnreadableRunsPage />
              </GalleryDataProvider>
            </RunsRuntimeProvider>
          </ConfirmDialogProvider>
        </AuthProvider>
      </WorkersProvider>
    </MemoryRouter>,
  );
  return { deleteRun, listUnreadableRuns };
}

describe("UnreadableRunsPage", () => {
  beforeEach(() => localStorage.clear());

  it("lists each run with the error its stored record produces", async () => {
    renderPage([unreadable("r1"), unreadable("r2", { error: "expected `,`" })]);

    await waitFor(() =>
      expect(screen.getByText("missing field `interp`")).toBeTruthy(),
    );
    expect(screen.getByText("expected `,`")).toBeTruthy();
    // The run id is shown because it is the only handle an operator has on a run
    // with no readable record and no detail page.
    expect(screen.getByText(/r1/)).toBeTruthy();
  });

  it("deletes a row through the worker after confirming", async () => {
    const { deleteRun } = renderPage([unreadable("r1")]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Destructive, so it goes through the shared confirmation rather than firing
    // on the first click.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete run" })).toBeTruthy(),
    );
    expect(deleteRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));
    await waitFor(() => expect(deleteRun).toHaveBeenCalledWith("r1", "tok"));
  });

  it("offers delete for a published row", async () => {
    const { deleteRun } = renderPage([unreadable("r1", { published: true })]);

    await waitFor(() => expect(screen.getByText("Published")).toBeTruthy());
    // A published run this build cannot read is already out of the snapshot and the
    // gallery, so the backend deletes it and this page is the only place it can be
    // got rid of.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete run" }));
    await waitFor(() => expect(deleteRun).toHaveBeenCalledWith("r1", "tok"));
  });

  it("sizes its pager from the total and asks for the chosen page", async () => {
    // The total counts every unreadable run rather than this page's rows, so a
    // cabinet holding more than one page's worth gets a pager that reaches them.
    const { listUnreadableRuns } = renderPage([unreadable("r1")], {
      total: 45,
    });
    await waitFor(() =>
      expect(listUnreadableRuns).toHaveBeenCalledWith({ limit: 20, offset: 0 }),
    );

    const third = await screen.findByRole("button", { name: "Page 3" });
    // 45 rows over a page size of 20 is three pages and no fourth.
    expect(screen.queryByRole("button", { name: "Page 4" })).toBeNull();

    fireEvent.click(third);
    await waitFor(() =>
      expect(listUnreadableRuns).toHaveBeenCalledWith({
        limit: 20,
        offset: 40,
      }),
    );
  });

  it("renders no pager for a single page", async () => {
    renderPage([unreadable("r1")]);
    await waitFor(() =>
      expect(screen.getByText("missing field `interp`")).toBeTruthy(),
    );
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("shows the empty state when the cabinet holds none", async () => {
    renderPage([]);
    await waitFor(() =>
      expect(screen.getByText("No unreadable runs are stored.")).toBeTruthy(),
    );
  });
});
