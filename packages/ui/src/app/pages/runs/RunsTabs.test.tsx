import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkerClient } from "../../../client/clients";
import { WorkersProvider } from "../../../client/context";
import type { WorkersContextValue } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { RunsRuntimeProvider } from "../../runtime/runsRuntime";
import { RunsTabs } from "./RunsTabs";

function galleryValue(canExecute: boolean): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set<string>(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute,
  } as unknown as GalleryDataInput;
}

function renderTabs(opts: { canExecute?: boolean; unreadable?: number } = {}) {
  const { canExecute = true, unreadable = 0 } = opts;
  const client = {
    listUnreadableRuns: async () => ({ runs: [], total: unreadable }),
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
        <RunsRuntimeProvider>
          <GalleryDataProvider value={galleryValue(canExecute)}>
            <RunsTabs active="runs" />
          </GalleryDataProvider>
        </RunsRuntimeProvider>
      </WorkersProvider>
    </MemoryRouter>,
  );
}

describe("RunsTabs", () => {
  beforeEach(() => localStorage.clear());

  it("carries no Unreadable tab while the cabinet holds none", async () => {
    renderTabs({ unreadable: 0 });
    await waitFor(() => expect(screen.getByText("Unpublished")).toBeTruthy());
    // A worklist that is always empty is a tab that is always a dead end, so it
    // only exists while there is something behind it.
    expect(screen.queryByText(/Unreadable/)).toBeNull();
  });

  it("carries the Unreadable tab with its count once the cabinet holds one", async () => {
    renderTabs({ unreadable: 2 });
    await waitFor(() =>
      expect(screen.getByText("Unreadable (2)")).toBeTruthy(),
    );
  });

  it("carries no Unreadable tab on a host that cannot execute runs", async () => {
    renderTabs({ canExecute: false, unreadable: 2 });
    await waitFor(() => expect(screen.getByText("Tests")).toBeTruthy());
    expect(screen.queryByText(/Unreadable/)).toBeNull();
  });
});
