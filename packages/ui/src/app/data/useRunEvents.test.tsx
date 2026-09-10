import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunEventStreams } from "../../client/types";
import { GalleryDataProvider, type GalleryDataInput } from "./galleryContext";
import { useRunEvents } from "./useRunEvents";

// The streams a run recorded — empty is enough, since these tests assert on
// when the read happens, not on what it returns.
const STREAMS: RunEventStreams = { events: [], raw: null };

// A fresh fetcher that answers with the streams, so a test can hand the hook a
// host whose transport changed identity without changing what it answers.
function fetcher() {
  return vi.fn(async (_runId: string) => STREAMS);
}

// The hook under a provider whose value the test can swap between renders —
// `renderHook`'s wrapper is fixed, so it reads the current value off a holder
// and `rerender()` re-renders the whole tree with whatever is in it.
function mount(runId: string, initial: GalleryDataInput) {
  const holder = { value: initial };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GalleryDataProvider value={holder.value}>{children}</GalleryDataProvider>
  );
  const view = renderHook(
    (props: { runId: string }) => useRunEvents(props.runId),
    {
      wrapper,
      initialProps: { runId },
    },
  );
  return {
    result: view.result,
    rerender(next: { runId?: string; value?: GalleryDataInput }) {
      if (next.value) holder.value = next.value;
      view.rerender({ runId: next.runId ?? runId });
    },
  };
}

describe("useRunEvents", () => {
  // The defect this pins: the console's gallery value is rebuilt whenever a run
  // finishes (the refresh re-reads the produced worklist), and a feed that
  // flipped back to loading on that rebuild unmounted the virtualized feed the
  // reader was scrolled through, then remounted it at the top. The host now
  // hands the same fetcher across such a rebuild (`useLiveGallery` pins that),
  // and the same fetcher must not restart the read.
  it("keeps a loaded feed across a host value rebuilt around the same fetcher", async () => {
    const fetch = fetcher();
    const { result, rerender } = mount("run-1", {
      fetchRunEvents: fetch,
    } as unknown as GalleryDataInput);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({
      value: {
        fetchRunEvents: fetch,
        runsLoading: true,
      } as unknown as GalleryDataInput,
    });

    expect(result.current.status).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the run id changes", async () => {
    const fetch = fetcher();
    const { result, rerender } = mount("run-1", {
      fetchRunEvents: fetch,
    } as unknown as GalleryDataInput);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ runId: "run-2" });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetch.mock.calls.map(([id]) => id)).toEqual(["run-1", "run-2"]);
  });

  // A new fetcher is a new transport — a switched backend, whose run store may
  // be the only one holding this run's events — and it is also the only retry a
  // settled failure ever gets: a read that failed on the old transport must not
  // stay stuck on its error once the host has a new one.
  it("re-reads through a replaced fetcher, recovering from a failed read", async () => {
    const failing = vi.fn(async (_runId: string): Promise<RunEventStreams> => {
      throw new Error("backend unreachable");
    });
    const { result, rerender } = mount("run-1", {
      fetchRunEvents: failing,
    } as unknown as GalleryDataInput);
    await waitFor(() => expect(result.current.status).toBe("error"));

    const replaced = fetcher();
    rerender({
      value: { fetchRunEvents: replaced } as unknown as GalleryDataInput,
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(replaced).toHaveBeenCalledWith("run-1", expect.any(Function));
  });

  it("reads as unsupported without a fetcher", () => {
    const { result } = mount("run-1", {} as unknown as GalleryDataInput);
    expect(result.current.status).toBe("unsupported");
  });
});
