// The Shell file: every command line gg ran on one agent's behalf, with its exit code
// as the verdict and its streams behind the row.
//
// These pin three things. The fold: that each `shell` telemetry event becomes one entry
// on the emitting agent's own partition, with the omitted-when-zero dropped counts read
// back as zeros. The gating: the file rides on the shell capability, per agent, not on
// the instance's surface. And the rendering: every row collapsed, the verdict and origin
// on the row, the directory only when it is not the agent's own root, and the streams
// (with their truncation captions) inside.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgCapabilityConfig,
  GgCapabilitySet,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";
import { ShellView, cwdLabel } from "./ShellView";
import { filesFor } from "./ggAgentEntries";

const TS = "2026-08-23T00:00:00Z";

function gg(kind: GgTelemetryKind, agentId = "root"): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

function shellEvent(
  overrides: Partial<Extract<GgTelemetryKind, { type: "shell" }>> = {},
  agentId = "root",
): HarnessEvent {
  return gg(
    {
      type: "shell",
      origin: "tool",
      command: "npm test",
      cwd: { type: "workspace" },
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      ...overrides,
    } as GgTelemetryKind,
    agentId,
  );
}

function caps(ids: readonly string[]): GgCapabilitySet {
  const capabilities: GgCapabilityConfig[] = ids.map((id) => ({
    id,
    enabled: true,
    params: {},
  }));
  return {
    agents: [
      {
        slug: "root",
        name: "Root",
        capabilities,
        modelId: "mock/x",
        openingTurn: { modules: [], functions: [] },
      },
    ],
  };
}

describe("shell fold", () => {
  it("folds each shell event into an entry, reading omitted dropped counts as zero", () => {
    const { shellCommands } = reduceGgEvents([
      shellEvent(),
      shellEvent({
        origin: "hook",
        command: "cargo build",
        cwd: { type: "relative", path: "web" },
        exitCode: 101,
        stdout: "tail",
        stderr: "boom",
        stdoutDropped: 12,
      }),
    ]);
    expect(shellCommands).toEqual([
      {
        timestamp: TS,
        origin: "tool",
        command: "npm test",
        cwd: { type: "workspace" },
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        stdoutDropped: 0,
        stderrDropped: 0,
      },
      {
        timestamp: TS,
        origin: "hook",
        command: "cargo build",
        cwd: { type: "relative", path: "web" },
        exitCode: 101,
        stdout: "tail",
        stderr: "boom",
        stdoutDropped: 12,
        stderrDropped: 0,
      },
    ]);
  });

  it("lands each command on the emitting agent's own partition", () => {
    const perAgent = reduceGgEventsPerAgent([
      shellEvent({}, "root"),
      shellEvent({ command: "git status" }, "agent-1"),
    ]);
    expect(perAgent.get("root")?.shellCommands.map((c) => c.command)).toEqual([
      "npm test",
    ]);
    expect(
      perAgent.get("agent-1")?.shellCommands.map((c) => c.command),
    ).toEqual(["git status"]);
  });
});

describe("shell file", () => {
  it("is offered exactly to an agent whose profile enables the shell capability", () => {
    expect(filesFor(caps(["shell"]), "root")).toContain("shell");
    expect(filesFor(caps([]), "root")).not.toContain("shell");
    expect(filesFor(null, "root")).not.toContain("shell");
  });

  it("lists every command collapsed, the verdict and origin on the row", () => {
    const { shellCommands } = reduceGgEvents([
      shellEvent(),
      shellEvent({
        origin: "hook",
        command: "cargo build",
        cwd: { type: "relative", path: "web" },
        exitCode: 101,
        stderr: "boom",
      }),
    ]);
    render(<ShellView commands={shellCommands} live={false} />);
    const rows = screen.getAllByRole("group");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toHaveAttribute("open");

    const summary = (row: HTMLElement) =>
      within(row.querySelector("summary") as HTMLElement);
    expect(summary(rows[0]!).getByText("npm test")).toBeInTheDocument();
    expect(summary(rows[0]!).getByText("exit 0")).toBeInTheDocument();
    expect(summary(rows[0]!).getByText("tool")).toBeInTheDocument();
    // The agent's own root is the ordinary case and earns no directory cell.
    expect(summary(rows[0]!).queryByTitle(/Ran in/)).toBeNull();

    expect(summary(rows[1]!).getByText("exit 101")).toBeInTheDocument();
    expect(summary(rows[1]!).getByText("hook")).toBeInTheDocument();
    expect(summary(rows[1]!).getByText("web")).toBeInTheDocument();

    // Inside a row: the command, then each stream — a stream that carried nothing says
    // so rather than rendering an empty block.
    expect(within(rows[1]!).getByText("Stdout")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Stderr")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("boom")).toBeInTheDocument();
    // The first row's stderr carried nothing, and its section says so rather than
    // rendering an empty block.
    expect(
      within(rows[0]!).getByText("The stream carried nothing."),
    ).toBeInTheDocument();
  });

  it("captions a capped stream with what the cap dropped", () => {
    const { shellCommands } = reduceGgEvents([
      shellEvent({ stdout: "tail", stdoutDropped: 4321 }),
    ]);
    render(<ShellView commands={shellCommands} live={false} />);
    expect(
      screen.getByText("Stdout · first 4,321 characters dropped"),
    ).toBeInTheDocument();
  });

  it("shows a waiting state while live and an empty state when not", () => {
    const { rerender } = render(<ShellView commands={[]} live={true} />);
    expect(
      screen.getByText("Waiting for the first command…"),
    ).toBeInTheDocument();
    rerender(<ShellView commands={[]} live={false} />);
    expect(screen.getByText("No commands were run.")).toBeInTheDocument();
  });
});

describe("cwdLabel", () => {
  it("names the directory only when it is not the agent's own root", () => {
    expect(cwdLabel({ type: "workspace" })).toBeNull();
    expect(cwdLabel({ type: "relative", path: "impl/web" })).toBe("impl/web");
    expect(cwdLabel({ type: "absolute", path: "/tmp/gg-shell" })).toBe(
      "/tmp/gg-shell",
    );
  });
});
