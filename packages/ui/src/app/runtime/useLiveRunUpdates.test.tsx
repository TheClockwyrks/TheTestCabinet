import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkersProvider } from "../../client/context";
import type { WorkerHandle, WorkersContextValue } from "../../client/context";
import type { WorkerClient } from "../../client/clients";
import {
  resetLiveRunUpdatesForTest,
  useLiveRunUpdates,
} from "./useLiveRunUpdates";

afterEach(() => resetLiveRunUpdatesForTest());

// A worker whose client records only what this hook calls.
function worker(id: string) {
  const setRunLifecycleEnabled = vi.fn(async () => {});
  const handle = {
    id,
    label: id,
    url: `https://${id}.example`,
    local: false,
    client: { setRunLifecycleEnabled } as unknown as WorkerClient,
    identity: null,
    backendMatch: "match",
  } as unknown as WorkerHandle;
  return { handle, setRunLifecycleEnabled };
}

function wrap(workers: WorkerHandle[]) {
  const value = {
    workers,
    activeId: workers[0]?.id ?? null,
    active: workers[0] ?? null,
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as WorkersContextValue;
  return ({ children }: { children: ReactNode }) => (
    <WorkersProvider value={value}>{children}</WorkersProvider>
  );
}

// A component whose only job is to declare the need.
function Consumer() {
  useLiveRunUpdates();
  return null;
}

describe("useLiveRunUpdates", () => {
  it("enables the topic on mount and disables it on unmount", () => {
    const { handle, setRunLifecycleEnabled } = worker("w1");
    const Wrapper = wrap([handle]);

    const view = render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true]]);

    view.unmount();
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("sends one request however many consumers are mounted", () => {
    // The runs tab bar and the runs page both declare the need; the second must ride
    // the first's subscription rather than re-asking for it.
    const { handle, setRunLifecycleEnabled } = worker("w1");
    const Wrapper = wrap([handle]);

    const view = render(
      <Wrapper>
        <Consumer />
        <Consumer />
        <Consumer />
      </Wrapper>,
    );
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true]]);

    view.unmount();
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the topic on while any consumer is still mounted", () => {
    // The navigation case this ref-counting exists for: React mounts the incoming
    // page before unmounting the outgoing one, so a naive hook would switch the topic
    // off immediately after switching it on and leave the console subscribed to
    // nothing exactly while it is showing the list.
    const { handle, setRunLifecycleEnabled } = worker("w1");
    const Wrapper = wrap([handle]);

    const view = render(
      <Wrapper>
        <Consumer key="a" />
        <Consumer key="b" />
      </Wrapper>,
    );
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true]]);

    // The outgoing page unmounts; the incoming one is still there.
    view.rerender(
      <Wrapper>
        <Consumer key="b" />
      </Wrapper>,
    );
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true]]);

    view.unmount();
    expect(setRunLifecycleEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("counts each worker separately", () => {
    // Each worker holds its own stream, so the topic is negotiated per worker.
    const first = worker("w1");
    const second = worker("w2");
    const Wrapper = wrap([first.handle, second.handle]);

    const view = render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );
    expect(first.setRunLifecycleEnabled.mock.calls).toEqual([[true]]);
    expect(second.setRunLifecycleEnabled.mock.calls).toEqual([[true]]);

    view.unmount();
    expect(first.setRunLifecycleEnabled.mock.calls).toEqual([[true], [false]]);
    expect(second.setRunLifecycleEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it("does nothing where no workers provider is mounted", () => {
    // The static site renders the runs tab bar but mounts no <WorkersProvider>;
    // declaring the need there must be inert rather than throwing.
    expect(() => render(<Consumer />)).not.toThrow();
  });
});
