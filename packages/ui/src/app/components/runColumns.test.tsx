import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InProgressRun } from "../../client/types";
import {
  RUN_COLUMNS,
  type RunColumn,
  type RunRenderContext,
} from "./runColumns";

const activeRun: InProgressRun = {
  runId: "r-1",
  testCaseSlug: "carom",
  testCaseVersion: "v1.2.0",
  variant: "base",
  harnessSlug: "claude",
  modelId: "claude-opus-4-8",
  state: "running",
};

function column(id: string): RunColumn {
  const col = RUN_COLUMNS.find((c) => c.id === id);
  if (!col) throw new Error(`no column ${id}`);
  return col;
}

function ctx(overrides: Partial<RunRenderContext> = {}): RunRenderContext {
  return {
    visible: new Set(),
    testCaseName: (slug) => slug,
    testCaseType: () => "end-to-end",
    modelName: (modelId) => modelId,
    ...overrides,
  };
}

// Columns that don't depend on the run result must fill their in-progress cell
// (not dash), since the values are known from the launch identity / catalog.
describe("run column in-progress cells", () => {
  it("shows the launched version for an in-progress run", () => {
    const { container } = render(
      column("version").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("v1.2.0");
  });

  it("resolves the category from the catalog for an in-progress run", () => {
    const { container } = render(
      column("category").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("End-to-end");
  });

  it("dashes the category only when the catalog doesn't know the case", () => {
    const { container } = render(
      column("category").renderActive(
        activeRun,
        ctx({ testCaseType: () => null }),
      ),
    );
    expect(container.textContent).toBe("—");
  });

  it("shows the model for an in-progress third-party-harness run", () => {
    const { container } = render(
      column("model").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("claude-opus-4-8");
  });

  it("shows the configuration for an in-progress gg run", () => {
    // A gg run binds a model per agent, so its configuration — not the
    // representative primary-slot model — is what names the row.
    const { container } = render(
      column("model").renderActive(
        { ...activeRun, harnessSlug: "gg", ggPreset: "planning-A" },
        ctx(),
      ),
    );
    expect(container.textContent).toBe("planning-A");
  });

  it("falls back to the model for a gg run with no configuration name", () => {
    const { container } = render(
      column("model").renderActive({ ...activeRun, harnessSlug: "gg" }, ctx()),
    );
    expect(container.textContent).toBe("claude-opus-4-8");
  });
});
