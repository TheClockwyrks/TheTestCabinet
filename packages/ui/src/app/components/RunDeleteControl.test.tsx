import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../client/auth";
import type { WorkerClient } from "../../client/clients";
import {
  WorkersProvider,
  type WorkersContextValue,
} from "../../client/context";
import { ConfirmDialogProvider } from "./ConfirmDialog";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../data/galleryContext";
import { RunsRuntimeProvider } from "../runtime/runsRuntime";
import { RunDeleteControl } from "./RunDeleteControl";

function mount(
  props: { runId: string; published?: boolean },
  opts: { localIds?: string[]; canExecute?: boolean } = {},
) {
  localStorage.setItem(
    "tcab.auth",
    JSON.stringify({ token: "tok", account: { username: "zach" } }),
  );
  const client = {
    deleteRun: vi.fn(async () => {}),
  } as unknown as WorkerClient;
  const workers = {
    workers: [],
    activeId: "w1",
    active: { id: "w1", label: "w1", url: null, local: true, client },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  const gallery = {
    producedSummaries: [],
    localIds: new Set(opts.localIds ?? []),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: opts.canExecute ?? true,
  } as unknown as GalleryDataInput;
  const tree: ReactNode = (
    <MemoryRouter>
      <WorkersProvider value={workers}>
        <AuthProvider>
          <ConfirmDialogProvider>
            <RunsRuntimeProvider>
              <GalleryDataProvider value={gallery}>
                <RunDeleteControl {...props} />
              </GalleryDataProvider>
            </RunsRuntimeProvider>
          </ConfirmDialogProvider>
        </AuthProvider>
      </WorkersProvider>
    </MemoryRouter>
  );
  render(tree);
}

function button(): HTMLButtonElement | null {
  return screen.queryByRole("button", { name: "Delete run" });
}

describe("RunDeleteControl", () => {
  beforeEach(() => localStorage.clear());

  // The user's acceptance criterion: a canceled run keeps showing up so its data
  // can be analysed, and is still deletable like any other unpublished run — even
  // while the produced worklist, which lags behind the partial record its driver
  // is still writing, does not hold it.
  it("offers delete for an unpublished run the worklist has not caught up with", () => {
    mount({ runId: "run-canceled", published: false }, { localIds: [] });
    expect(button()?.disabled).toBe(false);
  });

  it("disables rather than hides for a published run, and says why", () => {
    mount({ runId: "run-a", published: true }, { localIds: [] });
    const el = button();
    expect(el).not.toBeNull();
    expect(el?.disabled).toBe(true);
    expect(el?.title).toMatch(/published run cannot be deleted/i);
  });

  // Hiding is reserved for a host that could never delete anything, where a
  // disabled button would be noise rather than information.
  it("hides entirely on a host that can delete nothing", () => {
    mount({ runId: "run-a", published: false }, { canExecute: false });
    expect(button()).toBeNull();
  });
});
