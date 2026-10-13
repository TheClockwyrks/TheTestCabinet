import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSubscription } from "../../client/clients";
import { useArtifactStorage } from "../runtime/artifactStorage";
import { NotificationsLayer } from "./NotificationsLayer";

// The layer reads its workers off the client context. Two stand in here, each
// recording the handlers its stream was opened with so a test can deliver frames.
const workers = vi.hoisted(() => ({
  list: [] as {
    id: string;
    client: {
      listActiveRuns: () => Promise<never[]>;
      subscribeToNotifications: (handlers: unknown) => () => void;
    };
  }[],
  handlers: new Map<string, unknown>(),
}));
vi.mock("../../client/context", () => ({
  useWorkers: () => ({ workers: workers.list }),
}));

function worker(id: string) {
  return {
    id,
    client: {
      listActiveRuns: async () => [],
      subscribeToNotifications: (handlers: unknown) => {
        workers.handlers.set(id, handlers);
        return () => {
          workers.handlers.delete(id);
        };
      },
    },
  };
}

function stream(id: string): NotificationSubscription {
  return workers.handlers.get(id) as NotificationSubscription;
}

const GIB = 1024 ** 3;
const blocked = {
  state: "blocked" as const,
  runsOnHold: true,
  runsWaitingToStore: 0,
  warnBytes: 3 * GIB,
  stopBytes: 2 * GIB,
};

beforeEach(() => {
  workers.handlers.clear();
  useArtifactStorage.setState({ byWorker: {} });
});

describe("NotificationsLayer storage status", () => {
  it("records each backend's storage frame under that backend", async () => {
    workers.list = [worker("w1"), worker("w2")];
    render(
      <MemoryRouter>
        <NotificationsLayer />
      </MemoryRouter>,
    );

    await act(async () => {
      stream("w1").onStorage?.(blocked);
      stream("w2").onStorage?.({ ...blocked, state: "ok", runsOnHold: false });
    });

    const { byWorker } = useArtifactStorage.getState();
    expect(byWorker.w1?.state).toBe("blocked");
    expect(byWorker.w2?.state).toBe("ok");
  });

  it("drops the status of a backend that leaves the console", async () => {
    workers.list = [worker("w1"), worker("w2")];
    const view = render(
      <MemoryRouter>
        <NotificationsLayer />
      </MemoryRouter>,
    );
    await act(async () => {
      stream("w1").onStorage?.(blocked);
      stream("w2").onStorage?.(blocked);
    });

    workers.list = [workers.list[1]!];
    await act(async () => {
      view.rerender(
        <MemoryRouter>
          <NotificationsLayer />
        </MemoryRouter>,
      );
    });

    expect(Object.keys(useArtifactStorage.getState().byWorker)).toEqual(["w2"]);
  });
});
