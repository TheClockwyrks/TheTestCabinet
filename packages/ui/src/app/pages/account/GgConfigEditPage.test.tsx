import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgConfigEditPage } from "./GgConfigEditPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the editor under test. Stub it, mirroring the other page tests, so
// only the configuration form is exercised.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// A signed-in operator: saving a configuration is account-scoped, so the token is
// what unlocks the form.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

const createGgConfig = vi.fn().mockResolvedValue({ id: "c1" });

function backendValue(): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([]),
      listGgConfigs: vi.fn().mockResolvedValue([]),
      createGgConfig,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage(path = "/account/gg/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/new" element={<GgConfigEditPage />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// Open the (first) agent's per-agent view — where its capabilities, model, prompt,
// and subagent allowlist live.
function openFirstAgent() {
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
}

describe("GgConfigEditPage", () => {
  // The save spy is module-scoped, so its call log accumulates across tests unless
  // cleared — every "called once" assertion counts from a fresh slate.
  beforeEach(() => createGgConfig.mockClear());

  it("renders the top-level configuration surface, capabilities behind an agent", async () => {
    renderPage();
    // The top level is limits + model slots + the agent list — capabilities are now
    // per agent, not a run-global list.
    expect(await screen.findByText("Run limits")).toBeInTheDocument();
    expect(screen.getByText("Model slots")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    // The unremovable Root agent is listed, and capabilities are not on this view.
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();

    // Opening the Root reveals its capability catalog and per-agent sections.
    openFirstAgent();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Models & tools")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    expect(screen.getByText("Subagents")).toBeInTheDocument();
    expect(screen.getByText("Custom instructions")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    // Multi-model is gone (each agent carries its own model).
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
  });

  it("navigates into an agent and back", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Back to configuration/i }),
    );
    // Back on the top-level form.
    expect(screen.getByText("Model slots")).toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    // "Worktrees" lives in the Delegation group, which starts collapsed.
    expect(screen.queryByText("Worktrees")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Worktrees")).toBeInTheDocument();
  });

  it("requires a name, then saves the capability set under it", async () => {
    renderPage();
    const save = await screen.findByRole("button", {
      name: "Create configuration",
    });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shell-heavy" },
    });
    // Turn a capability on, on the Root agent, so the saved set is distinguishable.
    openFirstAgent();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Shell/i })[0]!);
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const input = createGgConfig.mock.calls[0]![0];
    expect(input.name).toBe("shell-heavy");
    expect(input.capabilitySet.preset).toBe("shell-heavy");
    // A single Root agent, with the full catalog serialized (on or off) so ablation
    // arms stay symmetric.
    expect(input.capabilitySet.agents).toHaveLength(1);
    const root = input.capabilitySet.agents[0];
    expect(root.name).toBe("Root");
    const ids = root.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain("shell");
    expect(ids).toContain("read-file");
    // The Root defers to a declared `primary` model slot rather than pinning a model,
    // which keeps one configuration reusable across models.
    expect(root.modelId).toBe("");
    expect(root.modelSlot).toBe("primary");
    expect(input.capabilitySet.modelSlots).toEqual([{ name: "primary" }]);
  });

  it("withholds a capability's sub-feature from inside its config", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-revise" },
    });
    openFirstAgent();
    // Turning Memories on expands its config, where its "Revise memories" slider lives.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Memories/i }));
    const revise = screen.getByRole("checkbox", { name: /Revise memories/i });
    expect(revise).toBeChecked();
    fireEvent.click(revise);

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The ablation is per agent now.
    const { disabledTools } = createGgConfig.mock.calls[0]![0].capabilitySet
      .agents[0];
    expect(new Set(disabledTools)).toEqual(
      new Set(["update_memory", "delete_memory"]),
    );
  });

  it("adds an agent and lets the Root list it as a subagent", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // Add a second agent, then in the Root's view enable it as a subagent with a
    // caller-scoped description.
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    openFirstAgent();
    // The subagents allowlist lists both Root (self) and the new agent-2.
    const subToggle = screen.getByRole("checkbox", { name: /agent-2/i });
    fireEvent.click(subToggle);
    fireEvent.change(
      screen.getByPlaceholderText("when to use this agent"),
      { target: { value: "for reviews" } },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual([
      "Root",
      "agent-2",
    ]);
    expect(agents[0].subagents).toEqual([
      { agent: "agent-2", description: "for reviews" },
    ]);
  });

  it("stores no system-prompt override unless it is edited", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "stock-prompt" },
    });
    openFirstAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The default template is seeded into the editor but not stored as an override.
    expect(
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0]
        .systemPromptTemplate,
    ).toBeUndefined();
  });
});
