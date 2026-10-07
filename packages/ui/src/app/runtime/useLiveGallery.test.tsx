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
import { HttpReadError } from "../../client/absence";

// A backend answering the reads the hook makes at mount, recording how often
// the model catalog was asked for.
function backend(models: { slug: string }[] = [], cases: string[] = []) {
  const listModels = vi.fn(async () => models);
  const listTestCases = vi.fn(async () => cases.map(testCaseSummary));
  const client = {
    listTestCases,
    listTestCaseGroups: async () => [],
    listModels,
  } as unknown as BackendClient;
  return { client, listModels, listTestCases };
}

// A case as `GET /test-cases` serves one, carrying the fields the catalog fold
// reads.
function testCaseSummary(slug: string) {
  return {
    slug,
    name: slug,
    testType: "end-to-end",
    difficulty: "hard",
    tags: [],
    summary: null,
    versions: ["1.0.0"],
    latestVersion: "1.0.0",
  };
}

// A model as `GET /models` serves one, carrying what `toModelSummary` reads.
function model(slug: string) {
  return {
    slug,
    name: slug,
    provider: "anthropic",
    aliases: [{ slug, harnessFamily: "openrouter" }],
    description: null,
    logoSvg: null,
    providerLogoUrl: null,
    openrouterSlug: null,
  } as unknown as { slug: string };
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

// A worker holding a fixed produced worklist. `listRuns` is a spy so a test can
// make one re-read fail without disturbing the ones around it.
function worker(ids: string[]): WorkerHandle & {
  listRuns: ReturnType<typeof vi.fn>;
} {
  const listRuns = vi.fn(async () => ids.map(storedRun));
  return {
    id: "w1",
    label: "w1",
    url: "https://w1.example",
    client: { listRuns } as unknown as WorkerClient,
    identity: null,
    backendMatch: "match",
    listRuns,
  } as unknown as WorkerHandle & { listRuns: ReturnType<typeof vi.fn> };
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

    // The reported defect, one layer down. The refresh token is bumped on every
    // finished run, so a single unreachable moment on a slow connection used to
    // empty the catalog under an open model page — and every not-found branch in
    // the app, written as "if loading show a spinner, else show unknown", then
    // reported a model the cabinet holds as one it has never heard of.
    it("keeps the loaded catalog when a refresh fails", async () => {
      const { client, listModels } = backend([model("claude")]);
      const { result } = mount(client, null);
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );
      expect(result.current.gallery.models).toHaveLength(1);

      listModels.mockRejectedValueOnce(new Error("network down"));
      act(() => result.current.runtime.requestRefresh());

      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("error"),
      );
      // The catalog on screen is untouched: a failed REFRESH is not an emptied
      // catalog, and a model page open on `claude` keeps resolving it.
      expect(result.current.gallery.models.map((m) => m.slug)).toEqual([
        "claude",
      ]);

      // And the next refresh re-reads in place rather than flipping the whole
      // section back to a spinner.
      act(() => result.current.runtime.requestRefresh());
      expect(result.current.gallery.modelsStatus).not.toBe("loading");
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );
    });

    // A FIRST load has nothing on screen to keep, so it clears — and says
    // `error`, never `ready` with an empty list, which would read as a cabinet
    // that curates no models.
    it("reports a failed first load as an error with no models", async () => {
      const { client, listModels } = backend([model("claude")]);
      listModels.mockRejectedValueOnce(new Error("network down"));
      const { result } = mount(client, null);

      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("error"),
      );
      expect(result.current.gallery.models).toEqual([]);

      // Nothing was ever loaded from this backend, so the retry is a first load
      // again and reads as one.
      act(() => result.current.runtime.requestRefresh());
      expect(result.current.gallery.modelsStatus).toBe("loading");
      await waitFor(() =>
        expect(result.current.gallery.modelsStatus).toBe("ready"),
      );
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

  describe("the test-case catalog", () => {
    // The same split the model catalog makes, for the same reason: a catalog
    // already on screen is not emptied by a read that failed. Every page holding
    // it — the catalog index, a jam list, a case's detail chrome — would
    // otherwise blank, and the not-found branches beneath them would start
    // reporting cases the cabinet holds as cases it has never heard of.
    it("keeps the loaded catalog when a re-read of it fails", async () => {
      const first = backend([], ["carom"]);
      const { result, swapBackend } = mount(first.client, null);
      await waitFor(() =>
        expect(result.current.gallery.testCasesStatus).toBe("ready"),
      );
      expect(result.current.gallery.testCases).toHaveLength(1);

      // Switch to a second backend whose read never lands, then switch back
      // before it does: the catalog on screen is still the first backend's, and
      // the re-read of it fails.
      const second = backend();
      second.listTestCases.mockReturnValue(new Promise(() => {}));
      swapBackend(second.client);
      first.listTestCases.mockRejectedValueOnce(new Error("network down"));
      swapBackend(first.client);

      await waitFor(() =>
        expect(result.current.gallery.testCasesStatus).toBe("error"),
      );
      // Untouched: a failed READ of a catalog already on screen is not an
      // emptied catalog, and the pages holding it keep resolving their cases.
      expect(result.current.gallery.testCases.map((c) => c.slug)).toEqual([
        "carom",
      ]);
    });

    // A FIRST load has nothing to keep, so it clears — and says `error`, never
    // `ready` with an empty catalog, which reads as a cabinet holding no cases.
    it("reports a failed first load as an error with no cases", async () => {
      const { client, listTestCases } = backend([], ["carom"]);
      listTestCases.mockRejectedValueOnce(new Error("network down"));
      const { result } = mount(client, null);

      await waitFor(() =>
        expect(result.current.gallery.testCasesStatus).toBe("error"),
      );
      expect(result.current.gallery.testCases).toEqual([]);
    });

    // A switched backend is a different catalog entirely, so it starts over from
    // `loading` rather than showing the old backend's cases as the new one's.
    it("starts over from loading on a switched backend", async () => {
      const first = backend([], ["carom"]);
      const { result, swapBackend } = mount(first.client, null);
      await waitFor(() =>
        expect(result.current.gallery.testCasesStatus).toBe("ready"),
      );

      const second = backend([], ["coil"]);
      swapBackend(second.client);

      expect(result.current.gallery.testCasesStatus).toBe("loading");
      await waitFor(() =>
        expect(result.current.gallery.testCasesStatus).toBe("ready"),
      );
      expect(result.current.gallery.testCases.map((c) => c.slug)).toEqual([
        "coil",
      ]);
    });
  });

  describe("the produced worklist", () => {
    // The worklist is what decides which runs the console offers to delete, and
    // it is re-read on every refresh token — every finished run, every cancel,
    // every publish. One unreachable moment used to empty it, which silently
    // withdrew the Delete control from every unpublished run on screen.
    it("keeps what it holds when a re-read fails", async () => {
      const { client } = backend();
      const handle = worker(["run-a"]);
      const { result } = mount(client, handle);
      await waitFor(() =>
        expect(result.current.gallery.localIds.has("run-a")).toBe(true),
      );

      handle.listRuns.mockRejectedValueOnce(new Error("worker unreachable"));
      act(() => result.current.runtime.requestRefresh());
      await waitFor(() =>
        expect(result.current.gallery.runsLoading).toBe(false),
      );

      expect(result.current.gallery.localIds.has("run-a")).toBe(true);
      expect(result.current.gallery.producedSummaries).toHaveLength(1);
    });
  });

  describe("resolving one run", () => {
    // A worker whose `readRun` is whatever the test hands it. The run store is
    // reached through the worker client here, which is the path a console takes
    // for a run it produced.
    function mountWithReadRun(readRun: (id: string) => Promise<unknown>) {
      const { client } = backend();
      const handle = {
        id: "w1",
        label: "w1",
        url: "https://w1.example",
        client: {
          listRuns: async () => [],
          readRun,
        } as unknown as WorkerClient,
        identity: null,
        backendMatch: "match",
      } as unknown as WorkerHandle;
      return mount(client, handle);
    }

    // The same rule at the record level: only the store's own 404 says the store
    // holds no such run. Anything else is a read that never got an answer, and
    // the run-detail page must be told so rather than being handed a null it
    // would render as "No run found".
    it("rejects a failed read and resolves a 404 to nothing", async () => {
      const readRun = vi
        .fn<(id: string) => Promise<unknown>>()
        .mockRejectedValueOnce(new HttpReadError("/runs/r", 503, "gateway"))
        .mockRejectedValueOnce(
          new HttpReadError("/runs/r", 404, "no such run"),
        );
      const { result } = mountWithReadRun(readRun);
      await waitFor(() =>
        expect(result.current.gallery.runsLoading).toBe(false),
      );

      await expect(result.current.gallery.readRun?.("r")).rejects.toThrow(
        "HTTP 503",
      );
      await expect(result.current.gallery.readRun?.("r")).resolves.toBeNull();
    });

    // The status is decided on the error's `status` field, never on its text.
    // This line used to match `/\bHTTP 404\b/` against `String(e)`, and the
    // transports' message ends in the backend's own envelope sentence — which is
    // free to quote an upstream's reply. A broken store therefore rendered as
    // "No run found for <id>": the very defect the 404-only rule exists to stop,
    // arriving through the string instead of through a collapsed catch.
    it("rejects a 500 whose message quotes “HTTP 404”", async () => {
      const readRun = vi
        .fn<(id: string) => Promise<unknown>>()
        .mockRejectedValue(
          new HttpReadError(
            "/runs/r",
            500,
            "artifact fetch https://artifacts.example/runs/r failed: HTTP 404",
          ),
        );
      const { result } = mountWithReadRun(readRun);
      await waitFor(() =>
        expect(result.current.gallery.runsLoading).toBe(false),
      );

      await expect(result.current.gallery.readRun?.("r")).rejects.toThrow(
        "HTTP 500",
      );
    });

    // A read that never reached a store carries no status, and a request with no
    // answer cannot be the store answering "no such run".
    it("rejects a statusless network failure", async () => {
      const readRun = vi
        .fn<(id: string) => Promise<unknown>>()
        .mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = mountWithReadRun(readRun);
      await waitFor(() =>
        expect(result.current.gallery.runsLoading).toBe(false),
      );

      await expect(result.current.gallery.readRun?.("r")).rejects.toThrow(
        "Failed to fetch",
      );
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
