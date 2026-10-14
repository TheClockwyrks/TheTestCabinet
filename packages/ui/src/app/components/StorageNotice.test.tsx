import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import { useArtifactStorage } from "../runtime/artifactStorage";
import { StorageNotice } from "./StorageNotice";

const GIB = 1024 ** 3;

function status(
  overrides: Partial<ArtifactStorageStatus> = {},
): ArtifactStorageStatus {
  return {
    state: "ok",
    runsOnHold: false,
    runsWaitingToStore: 0,
    freeBytes: 10 * GIB,
    totalBytes: 20 * GIB,
    warnBytes: 3 * GIB,
    stopBytes: 2 * GIB,
    ...overrides,
  };
}

function report(workerId: string, next: ArtifactStorageStatus) {
  act(() => useArtifactStorage.getState().setStatus(workerId, next));
}

// The store is a module singleton; start each case with nothing reported.
beforeEach(() => {
  useArtifactStorage.setState({ byWorker: {} });
});

describe("StorageNotice", () => {
  it("renders nothing until a backend reports a problem", () => {
    const { container } = render(<StorageNotice />);
    expect(container).toBeEmptyDOMElement();

    report("w1", status());
    expect(container).toBeEmptyDOMElement();

    report("w1", status({ state: "unmonitored" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("warns, as a status, while storage is running low", () => {
    render(<StorageNotice />);
    report("w1", status({ state: "low" }));

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Artifact storage is running low");
    expect(notice).toHaveTextContent(
      "Less than 3 GiB is free. New runs go on hold under 2 GiB.",
    );
    expect(notice).toHaveAttribute("data-tone", "warn");
  });

  it("states the hold, as an alert, while storage is full", () => {
    render(<StorageNotice />);
    report("w1", status({ state: "blocked", runsOnHold: true }));

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      "New runs are on hold: artifact storage is full",
    );
    expect(notice).toHaveAttribute("data-tone", "hold");
  });

  it("states the hold while the artifact service stays unreachable", () => {
    render(<StorageNotice />);
    report("w1", status({ state: "unavailable" }));
    expect(screen.queryByRole("alert")).toBeNull();

    report("w1", status({ state: "unavailable", runsOnHold: true }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New runs are on hold: the artifact service cannot be reached",
    );
  });

  it("follows the state as it changes and clears on recovery", () => {
    const { container } = render(<StorageNotice />);

    report("w1", status({ state: "low" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    report("w1", status({ state: "blocked", runsOnHold: true }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    report("w1", status());
    expect(container).toBeEmptyDOMElement();
  });

  it("has no dismiss control: it lasts as long as the condition does", () => {
    render(<StorageNotice />);
    report("w1", status({ state: "blocked", runsOnHold: true }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the worst state among several backends", () => {
    render(<StorageNotice />);
    report("w1", status({ state: "low" }));
    report("w2", status({ state: "blocked", runsOnHold: true }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New runs are on hold: artifact storage is full",
    );

    // The blocked backend is removed from the console; the other's warning stays.
    act(() => useArtifactStorage.getState().retain(["w1"]));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Artifact storage is running low",
    );
  });
});
