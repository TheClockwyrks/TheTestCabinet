import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../client/auth";
import type { WorkerClient } from "../../client/clients";
import {
  WorkersProvider,
  type WorkersContextValue,
} from "../../client/context";
import { RunsRuntimeProvider } from "../runtime/runsRuntime";
import { GalleryDataProvider, type GalleryDataInput } from "./galleryContext";
import { useRunDeletion } from "./useRunDeletion";

interface HostOptions {
  /** The ids the produced worklist has caught up with. */
  localIds?: string[];
  canExecute?: boolean;
  signedIn?: boolean;
  /** Whether the worker's transport can delete at all. */
  canTransportDelete?: boolean;
}

function mount({
  localIds = [],
  canExecute = true,
  signedIn = true,
  canTransportDelete = true,
}: HostOptions = {}) {
  if (signedIn) {
    localStorage.setItem(
      "tcab.auth",
      JSON.stringify({ token: "tok", account: { username: "zach" } }),
    );
  }
  const client = (canTransportDelete
    ? { deleteRun: async () => {} }
    : {}) as unknown as WorkerClient;
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
    localIds: new Set(localIds),
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WorkersProvider value={workers}>
      <AuthProvider>
        <RunsRuntimeProvider>
          <GalleryDataProvider value={gallery}>{children}</GalleryDataProvider>
        </RunsRuntimeProvider>
      </AuthProvider>
    </WorkersProvider>
  );
  return renderHook(() => useRunDeletion(), { wrapper }).result;
}

describe("useRunDeletion's gate", () => {
  beforeEach(() => localStorage.clear());

  // The reported defect. A canceled gg run's record only lands once its driver
  // has stopped the harness, drained the largest event stream in the cabinet and
  // posted the partial record back — seconds later. Until then the produced
  // worklist does not hold it, and the worklist was the ONLY per-run term in this
  // gate, so the Delete control vanished for a run the backend would happily
  // delete. The run's own publish state answers the question outright.
  it("allows deleting a run the worklist has not caught up with, on its own say-so", () => {
    const { current } = mount({ localIds: [] });
    expect(current.canDelete("run-canceled")).toBe(false);
    expect(current.canDelete({ id: "run-canceled", published: false })).toBe(
      true,
    );
  });

  it("refuses a published run however the caller asks", () => {
    const { current } = mount({ localIds: ["run-a"] });
    const gate = current.deletionGate({ id: "run-a", published: true });
    expect(gate.offered).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/published run cannot be deleted/i);
  });

  it("still answers from the worklist when the caller has only an id", () => {
    const { current } = mount({ localIds: ["run-a"] });
    expect(current.canDelete("run-a")).toBe(true);
    expect(current.canDelete("run-b")).toBe(false);
  });

  // Offered-but-disabled is the whole reason a transient state is now visible: a
  // control that simply vanishes tells the operator nothing about why.
  it("offers the control with a reason for a run it cannot yet place", () => {
    const { current } = mount({ localIds: [] });
    const gate = current.deletionGate("run-b");
    expect(gate.offered).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/not in the unpublished worklist yet/i);
  });

  // A host that can delete NOTHING hides the affordance rather than showing a
  // disabled button nobody on that host could ever use. Being signed out is not
  // that host — see below.
  it.each([
    ["a read-only gallery", { canExecute: false }],
    ["a transport that cannot delete", { canTransportDelete: false }],
  ])("offers nothing on %s", (_name, options: HostOptions) => {
    const { current } = mount({ localIds: ["run-a"], ...options });
    expect(current.deletionGate({ id: "run-a", published: false })).toEqual({
      offered: false,
      allowed: false,
      reason: null,
    });
    expect(current.unreadableGate()).toEqual({
      offered: false,
      allowed: false,
      reason: null,
    });
  });

  // The disagreement this pins: cancelling already showed a signed-out console a
  // disabled control with the reason, on the stated rationale that vanishing for
  // a state the operator can fix from the page they are on tells them nothing.
  // Deleting folded the token into the host gate instead, so the Delete control
  // simply was not there — which is also what the UI overview's "Deleting a run"
  // forbids: the affordance is hidden only where the host can delete NO run.
  it("offers a disabled control with its reason on a signed-out console", () => {
    const { current } = mount({ localIds: ["run-a"], signedIn: false });
    const gate = current.deletionGate({ id: "run-a", published: false });
    expect(gate.offered).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/sign in to delete runs/i);
    // Bare-id callers and the Unreadable worklist say the same thing.
    expect(current.deletionGate("run-a").reason).toMatch(
      /sign in to delete runs/i,
    );
    expect(current.unreadableGate()).toEqual({
      offered: true,
      allowed: false,
      reason: expect.stringMatching(/sign in to delete runs/i),
    });
  });

  // A published run is refused for good, so signing in would change nothing:
  // that permanent reason wins over the fixable one.
  it("names the published refusal over the signed-out one", () => {
    const { current } = mount({ signedIn: false });
    expect(
      current.deletionGate({ id: "run-a", published: true }).reason,
    ).toMatch(/published run cannot be deleted/i);
  });

  // Signed in, the Unreadable worklist's own gate is simply the host's: those
  // rows are in no listing, so publication does not gate them.
  it("allows deleting an unreadable run on a signed-in console", () => {
    const { current } = mount({});
    expect(current.unreadableGate()).toEqual({
      offered: true,
      allowed: true,
      reason: null,
    });
  });

  it("names the missing term when asked to delete anyway", async () => {
    const { current } = mount({ signedIn: false });
    await expect(current.deleteRun("run-a")).rejects.toThrow(
      "delete run-a refused: not signed in",
    );
  });
});
