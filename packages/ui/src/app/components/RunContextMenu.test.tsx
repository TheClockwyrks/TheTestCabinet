import { act, render, screen } from "@testing-library/react";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { createRef } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACTS_NOT_STORED_LABEL,
  markArtifactsNotStored,
} from "../../client/artifactPresence";
import { RunContextMenu, type RunContextMenuHandle } from "./RunContextMenu";

// The menu's gates come from app-wide contexts. Stub each as a console that may
// do everything, so what these tests vary is the run alone.
vi.mock("../data/useModels", () => ({
  useFindModel: () => () => null,
  useModels: () => ({ status: "ready", refreshing: false }),
}));
vi.mock("../data/useRunDeletion", () => ({
  CONFIRM_DELETE_RUN: {},
  useRunDeletion: () => ({
    canDelete: false,
    deletionGate: () => ({ allowed: false, reason: null }),
    deleteRun: async () => {},
  }),
}));
vi.mock("../data/useRunKill", () => ({
  useRunKill: () => ({ canKill: false, killRun: async () => {} }),
}));
vi.mock("../data/useRunPublish", async (original) => ({
  // The real rule for which run is publishable; only the host gate is stubbed.
  ...(await original<typeof import("../data/useRunPublish")>()),
  useRunPublish: () => ({ canPublish: true, publishRun: async () => {} }),
}));
vi.mock("./ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: async () => false, alert: async () => {} }),
}));

// A completed validator-rated run with no publish behind it: the run the menu
// offers "Publish run" for.
function unpublishedRun(id: string): RunSummary {
  return {
    id,
    state: "completed",
    validatorRated: true,
    reviewCount: 0,
    publishedAt: "",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "v1.0.0",
      variant: "base",
      harnessSlug: "claude",
      modelId: "claude-sonnet-4-5",
    },
  } as unknown as RunSummary;
}

function openMenuFor(run: RunSummary) {
  const ref = createRef<RunContextMenuHandle>();
  render(
    <MemoryRouter>
      <RunContextMenu ref={ref} />
    </MemoryRouter>,
  );
  act(() => ref.current!.openAt(10, 10, { kind: "single", run }));
}

describe("RunContextMenu publish item", () => {
  it("offers Publish for an unpublished run whose tree is not known to be missing", () => {
    openMenuFor(unpublishedRun("kept"));

    expect(screen.getByRole("menuitem", { name: "Publish run" })).toBeTruthy();
    expect(screen.queryByTestId("artifacts-missing-note")).toBeNull();
  });

  it("states why no publish is offered for a run with no stored artifacts", () => {
    const [lost] = markArtifactsNotStored([unpublishedRun("lost")], ["lost"]);
    openMenuFor(lost!);

    expect(screen.queryByRole("menuitem", { name: "Publish run" })).toBeNull();
    // The reason sits where the publish would have been, and is not an action.
    const note = screen.getByTestId("artifacts-missing-note");
    expect(note.textContent).toBe(ARTIFACTS_NOT_STORED_LABEL);
    expect(note.getAttribute("role")).toBe("note");
  });

  it("says nothing about artifacts on a run that is already published", () => {
    const [published] = markArtifactsNotStored(
      [{ ...unpublishedRun("old"), publishedAt: "2026-10-01T00:00:00Z" }],
      ["old"],
    );
    openMenuFor(published!);

    expect(screen.queryByRole("menuitem", { name: "Publish run" })).toBeNull();
    expect(screen.queryByTestId("artifacts-missing-note")).toBeNull();
  });
});
