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

// Return to the configuration keeping the agent's edits — the only way back other than
// discarding them with Cancel.
function saveAgent() {
  fireEvent.click(screen.getByRole("button", { name: "Save agent" }));
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
    expect(screen.getByText("Roster")).toBeInTheDocument();
    expect(screen.getByText("Custom instructions")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    // Multi-model is gone (each agent carries its own model).
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
  });

  it("navigates into an agent and back, hiding the configuration's own controls", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    // An agent is not the configuration: its identity fields and its save go away, and
    // the agent's own pair takes their place.
    expect(
      screen.queryByPlaceholderText("e.g. no-compaction"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /configuration/i }),
    ).not.toBeInTheDocument();

    saveAgent();
    // Back on the top-level form.
    expect(screen.getByText("Model slots")).toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toBeVisible();
  });

  it("discards an agent's edits when its editing is cancelled", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The rename never reached the configuration.
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("conductor")).not.toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    // "Workflows" lives in the Delegation group, which starts collapsed.
    expect(screen.queryByText("Workflows")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Workflows")).toBeInTheDocument();
  });

  it("requires a name, then saves the capability set under it", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shell-heavy" },
    });
    // Turn a capability on, on the root agent, so the saved set is distinguishable.
    openFirstAgent();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Shell/i })[0]!);
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
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
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The ablation is per agent now.
    const { disabledTools } =
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0];
    // Every way a memory is revised goes with the lever, whichever strategy the run
    // picks — `update_memory` under the scratchpad, `edit_memory` under the two
    // file-shaped ones, and `delete_memory` under all three.
    expect(new Set(disabledTools)).toEqual(
      new Set(["update_memory", "edit_memory", "delete_memory"]),
    );
  });

  it("adds an agent and lets the Root put it on its roster", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // Add a second agent, then in the Root's view enable it as a subagent with a
    // caller-scoped description.
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    openFirstAgent();
    // The roster lists both Root (self) and the new agent-2, each with one toggle per
    // scope. Grant agent-2 the Reviewer scope alone: the scopes are independent, so a
    // reviewer need not also be spawnable.
    const reviewerToggles = screen.getAllByRole("checkbox", {
      name: /Reviewer/i,
    });
    fireEvent.click(reviewerToggles[reviewerToggles.length - 1]!);
    fireEvent.change(screen.getByPlaceholderText("when to use this agent"), {
      target: { value: "for reviews" },
    });
    saveAgent();

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
      { agent: "agent-2", description: "for reviews", scopes: ["reviewer"] },
    ]);
  });

  // The root is a flag, not the name "Root": renaming it has to leave a configuration
  // that still saves, with the renamed profile still written first.
  it("renames the root agent and keeps it the root", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renamed-root" },
    });
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });
    saveAgent();
    expect(screen.getByText("conductor")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual(["conductor"]);
  });

  // Handing the root role to another profile reorders the saved set, because gg reads
  // the root off the first agent.
  it("moves the root flag to another agent", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "second-root" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    fireEvent.click(screen.getByRole("button", { name: "Make root" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual([
      "agent-2",
      "Root",
    ]);
  });

  // Every agent can be removed, the root included — but a configuration with none of
  // them cannot be saved.
  it("removes the root agent, passing the flag on, and refuses an empty configuration", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shrinking" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the Root agent" }),
    );
    // The survivor took the role over, so there is no "Make root" left to offer.
    expect(screen.getByText("agent-2")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make root" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the agent-2 agent" }),
    );
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(screen.getByText(/no agents/i)).toBeInTheDocument();
  });

  // A roster entry points at a profile, not at the spelling of its name, so renaming
  // the target used to break the configuration and now does not.
  it("keeps a roster entry pointed at an agent that is renamed", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renaming" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    // Put agent-2 on the root's roster …
    openFirstAgent();
    const reviewerToggles = screen.getAllByRole("checkbox", {
      name: /Reviewer/i,
    });
    fireEvent.click(reviewerToggles[reviewerToggles.length - 1]!);
    saveAgent();
    // … then rename agent-2 out from under it.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "critic" },
    });
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents[0].subagents).toEqual([
      { agent: "critic", description: "", scopes: ["reviewer"] },
    ]);
  });

  // A model slot is bound by identity too, so its name is free to change.
  it("keeps an agent bound to a model slot that is renamed", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renamed-slot" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. primary"), {
      target: { value: "critic" },
    });
    // No "declares no slot" complaint: the binding moved with the name.
    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents, modelSlots } =
      createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(modelSlots).toEqual([{ name: "critic" }]);
    expect(agents[0].modelSlot).toBe("critic");
  });

  // The compaction model is read by the handoff strategies alone, so its box only
  // appears once one of them is selected.
  it("offers the compaction model only under a handoff strategy", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgent();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Compaction/i }));
    expect(
      screen.queryByPlaceholderText("e.g. openai/gpt-4.1-mini"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: /Summarization strategy/i }),
      { target: { value: "handoff-compaction" } },
    );
    expect(
      screen.getByPlaceholderText("e.g. openai/gpt-4.1-mini"),
    ).toBeInTheDocument();
  });

  it("stores no system-prompt override unless it is edited", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "stock-prompt" },
    });
    openFirstAgent();
    saveAgent();
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
