import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { GameJamPriorEntries } from "./GameJamPriorEntries";

function renderEntries(
  entries: { runId: string; finishedAt: string }[],
): void {
  render(
    <MemoryRouter>
      <GameJamPriorEntries entries={entries} />
    </MemoryRouter>,
  );
}

describe("GameJamPriorEntries", () => {
  it("lists each earlier entry, linked to the run it came from", () => {
    renderEntries([
      { runId: "run-older", finishedAt: "2026-01-01T00:00:00Z" },
      { runId: "run-newer", finishedAt: "2026-02-02T00:00:00Z" },
    ]);

    expect(screen.getByText("Previous entries (2)")).toBeTruthy();
    const older = screen.getByRole("link", { name: "run-older" });
    expect(older.getAttribute("href")).toBe("/runs/run-older");
    expect(screen.getByRole("link", { name: "run-newer" })).toBeTruthy();
  });

  // The negative case is the whole point of the panel: a reviewer asking why a
  // model rebuilt the same game needs to see that it *was* shown nothing, rather
  // than an absent panel they cannot tell apart from a missing feature.
  it("says so explicitly when the run was a model's first entry", () => {
    renderEntries([]);

    expect(screen.getByText("Previous entries")).toBeTruthy();
    expect(screen.getByText(/first entry for this jam/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
