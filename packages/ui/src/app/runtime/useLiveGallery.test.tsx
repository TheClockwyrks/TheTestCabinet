import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BackendClient, WorkerClient } from "../../client/clients";
import type { StoredRun } from "../../client/types";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkerHandle,
  type WorkersContextValue,
} from "../../client/context";
import { RunsRuntimeProvider, useRunsRuntime } from "./runsRuntime";
import { useLiveGallery } from "./useLiveGallery";

// A backend answering the reads the hook makes at mount, recording how often
// the model catalog was asked for.
function backend() {
  const listModels = vi.fn(async () => []);
  const client = {
    listTestCases: async () => [],
    listTestCaseGroups: async () => [],
    listModels,
  } as unknown as BackendClient;
  return { client, listModels };
}

// A produced run as the worker's worklist serves one, carrying the fields the
// gallery's ingest (`toRunSummary`) reads.
function storedRun(id: string): StoredRun {
  return {
    id,
    record: {
      id,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:01:00Z",
      subject: {
        testCaseSlug: "carom",
        testCaseVersion: "1.0.0",
        testType: "playable",
        variant: "base",
        harnessSlug: "claude",
        harnessVersion: "1",
        engineSlug: "simple-2d",
        modelId: "anthropic/claude",
      },
      metrics: {
        runTimeSeconds: 60,
        tokens: {
          uncachedInput: 100,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
        cost: { comparable: 1, actual: 1 },
      },
      validation: { loaded: true, proofs: [] },
      links: { sourceRepo: null, playableBuild: null },
      status: { state: "completed" },
    },
    reviews: [],
    published: false,
    rating: null,
    aesthetic: null,
    validatorRated: false,
    score: null,
  } as unknown as StoredRun;
}

// A worker holding a fixed produced worklist.
function worker(ids: string[]): WorkerHandle {
  return {
    id: "w1",
    label: "w1",
    url: "https://w1.example",
    local: false,
    client: {
      listRuns: async () => ids.map(storedRun),
    } as unknown as WorkerClient,
    identity: null,
    backendMatch: "match",
  } as unknown as WorkerHandle;
}

// The hook under the three providers it reads, with the backend swappable
// between renders (the wrapper reads it off a holder, and `rerender()` renders
// the whole tree again).
function mount(client: BackendClient | null, active: WorkerHandle | null) {
  const holder = { client };
  const wrapper = ({ children }: { children: ReactNode }) => {
    const backendValue = {
      client: holder.client,
      identity: null,
      status: "ready",
      error: null,
      // No URL, so the hook makes no config fetches over the network.
      url: null,
      setUrl: () => {},
    } as BackendContextValue;
    const workersValue = {
      workers: active ? [active] : [],
      activeId: active?.id ?? null,
      active,
      setActive: () => {},
      addWorker: () => {},
      removeWorker: () => {},
    } as WorkersContextValue;
    return (
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue}>
          <RunsRuntimeProvider>{children}</RunsRuntimeProvider>
        </WorkersProvider>
      </BackendProvider>
    );
  };
  const view = renderHook(
    () => ({ gallery: useLiveGallery(), runtime: useRunsRuntime() }),
    { wrapper },
  );
  return {
    result: view.result,
    swapBackend(next: BackendClient | null) {
      holder.client = next;
      view.rerender();
    },
  };
}

describe("useLiveGallery", () => {
  describe("the model catalog", () => {
    // The defect this pins: the refresh token is bumped every time a run
    // finishes, and a re-fetch that flipped the loaded catalog back to
    // `loading` blanked every open model page for the duration.
    it("re-fetches on a refresh without leaving the ready state", async () => {
      const { client, listModels } = backend();
      const { result } = mount(client, null);
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );
      expect(listModels).toHaveBeenCalledTimes(1);

      act(() => result.current.runtime.requestRefresh());

      expect(result.current.gallery.modelsStatus).toBe("ready");
      await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));
      expect(result.current.gallery.modelsStatus).toBe("ready");
    });

    // A switched backend is a different catalog entirely, so it starts over
    // from `loading` rather than showing the old backend's models as if they
    // were the new one's.
    it("starts over from loading on a switched backend", async () => {
      const first = backend();
      const { result, swapBackend } = mount(first.client, null);
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );

      const second = backend();
      swapBackend(second.client);

      expect(result.current.gallery.modelsStatus).toBe("loading");
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );
      expect(second.listModels).toHaveBeenCalledTimes(1);
    });
  });

  describe("the resolvers", () => {
    // The Events tab's read, the variant cache and the media memos all key on
    // these; a refresh that re-reads the same worklist must not hand them a
    // new identity.
    it("keep their identity across a refresh of the produced worklist", async () => {
      const { client } = backend();
      const { result } = mount(client, worker(["run-a"]));
      await waitFor(() =>
        expect(result.current.gallery.localIds.has("run-a")).toBe(true),
      );
      const before = result.current.gallery;

      act(() => result.current.runtime.requestRefresh());
      await waitFor(() =>
        expect(result.current.gallery.runsLoading).toBe(false),
      );
      const after = result.current.gallery;

      expect(after.fetchRunEvents).toBe(before.fetchRunEvents);
      expect(after.proofMediaUrl).toBe(before.proofMediaUrl);
      expect(after.assetMediaUrl).toBe(before.assetMediaUrl);
      expect(after.validationMediaUrl).toBe(before.validationMediaUrl);
      expect(after.showcaseMediaUrl).toBe(before.showcaseMediaUrl);
      // The re-read found the same ids, so the set itself is unchanged too.
      expect(after.localIds).toBe(before.localIds);
    });

    // Identity is held by reading the worklist through a ref, which is only
    // right if the resolvers still answer from the CURRENT worklist.
    it("still answer from the current worklist", async () => {
      const { client } = backend();
      const { result } = mount(client, worker(["run-a"]));
      await waitFor(() =>
        expect(result.current.gallery.localIds.has("run-a")).toBe(true),
      );
      const { proofMediaUrl } = result.current.gallery;
      // A produced run's media is the worker's; any other run's would be the
      // backend's, which this host has no URL for.
      expect(proofMediaUrl?.("run-a", "p.png")).toBe(
        "https://w1.example/runs/run-a/proof/p.png",
      );
      expect(proofMediaUrl?.("run-b", "p.png")).toBeNull();
    });
  });
});
