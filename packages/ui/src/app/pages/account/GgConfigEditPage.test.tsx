import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

// Standing in for the list of configurations, so a test can tell that leaving the
// editor actually left it rather than merely closing a dialog.
const CONFIG_LIST = "the gg configurations list";

function renderPage(path = "/account/gg/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/new" element={<GgConfigEditPage />} />
          <Route path="/account/gg" element={<div>{CONFIG_LIST}</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// Open one of the form's tabs by its label. Matched on the label element rather than the
// tab's accessible name, because a tab with something wrong on it also announces the
// count ("Agents, 1 problem").
function openTab(name: string) {
  const tab = screen
    .getAllByRole("tab")
    .find((entry) => entry.firstElementChild?.textContent?.trim() === name);
  if (!tab) throw new Error(`no "${name}" tab`);
  fireEvent.click(tab);
}

// Open the (first) agent's per-agent view — where its capabilities, model, prompt, hooks
// and roster live. The agent list is the configuration's Agents tab.
function openFirstAgent() {
  openTab("Agents");
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
}

// Open the first agent and go straight to the tab its capabilities are on.
function openFirstAgentTools() {
  openFirstAgent();
  openTab("Tools");
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

  it("renders the configuration's three sections, capabilities behind an agent", async () => {
    renderPage();
    // The configuration is its identity + the ceilings + the session hooks; the slots
    // and the agent list are the other two sections.
    expect(await screen.findByText("Run limits")).toBeInTheDocument();
    expect(screen.getByText("Session hooks")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toBeVisible();

    // The Slots tab is the slot list itself — the tab strip names the section, so
    // nothing repeats it above the first slot.
    openTab("Slots");
    expect(
      screen.getByRole("button", { name: "+ Add model slot" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Model slots")).not.toBeInTheDocument();

    // The unremovable Root agent is listed, and capabilities are not on this view.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();

    // Opening the Root reveals its own sections; its capabilities are one tab in.
    openFirstAgent();
    expect(screen.getByText("Custom instructions")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    openTab("Tools");
    expect(screen.getByText("Models & tools")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    // The tab and the section it opens share a name, so both match — which is the point.
    openTab("Roster");
    expect(screen.getAllByText("Roster").length).toBeGreaterThan(1);
    // Multi-model is gone (each agent carries its own model).
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
  });

  it("navigates into an agent and back, hiding the configuration's own controls", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    // An agent is not the configuration: its identity fields and its save go away, and
    // the agent's own pair takes their place.
    expect(screen.getByPlaceholderText("e.g. reviewer")).toBeVisible();
    expect(
      screen.queryByPlaceholderText("e.g. no-compaction"),
    ).not.toBeInTheDocument();
    // The configuration's own save is gone; the back control that returns to it is not
    // (it is how an operator gets there).
    expect(
      screen.queryByRole("button", { name: /^Create configuration$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Back to / }),
    ).toBeInTheDocument();

    saveAgent();
    // Back on the configuration — on the Agents tab the operator left from, not reset to
    // the first one, so the list they opened the agent out of is what they come back to.
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("e.g. reviewer"),
    ).not.toBeInTheDocument();
    openTab("Configuration");
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toBeVisible();
  });

  it("discards an agent's edits when its editing is cancelled", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The rename never reached the configuration.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("conductor")).not.toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgentTools();
    // "Fork" lives in the Delegation group, which starts collapsed.
    expect(screen.queryByText("Fork")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Fork")).toBeInTheDocument();
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
    openFirstAgentTools();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Shell/i })[0]!);
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const input = createGgConfig.mock.calls[0]![0];
    expect(input.name).toBe("shell-heavy");
    expect(input.capabilitySet.preset).toBe("shell-heavy");
    // A single Root agent, with the full catalog serialized (on or off) so two
    // configurations being compared stay symmetric.
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

  it("grants a capability's whole offering, less the sub-feature switched off", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-revise" },
    });
    openFirstAgentTools();
    // Turning Memories on expands its config, where its "Revise memories" slider lives —
    // already on, because switching the capability on granted everything it offers.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Memories/i }));
    const revise = screen.getByRole("checkbox", { name: /Revise memories/i });
    expect(revise).toBeChecked();
    fireEvent.click(revise);
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The allowlist is per agent, and it is written in the tool vocabulary because this
    // agent answers with tool calls.
    const { tools, operations } =
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0];
    expect(operations).toBeUndefined();
    // The rest of the capability arrived whole...
    for (const tool of [
      "write_memory",
      "create_memory",
      "read_memory",
      "search_memories",
    ]) {
      expect(tools).toContain(tool);
    }
    // ...and every way a memory is REVISED went with the lever, whichever strategy the run
    // picks — `update_memory` under the scratchpad, `edit_memory` under the two
    // file-shaped ones, and `delete_memory` under all three.
    for (const tool of ["update_memory", "edit_memory", "delete_memory"]) {
      expect(tools).not.toContain(tool);
    }
  });

  it("adds an agent and lets the Root put it on its roster", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // Add a second agent, then in the Root's view enable it as a subagent with a
    // caller-scoped description.
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    openFirstAgent();
    // The roster lists both Root (self) and the new agent-2, each with one toggle per
    // scope. Grant agent-2 the Reviewer scope alone: the scopes are independent, so a
    // reviewer need not also be spawnable.
    openTab("Roster");
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
    openTab("Agents");
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
    openTab("Agents");
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
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    // Put agent-2 on the root's roster …
    openFirstAgent();
    openTab("Roster");
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
    openTab("Slots");
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
    openFirstAgentTools();
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

  it("buys the extended prompt-cache lifetime for one agent and leaves the other at the default", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // A second agent, so the choice is visibly per agent rather than run-wide.
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Add agent" }));
    openFirstAgent();
    fireEvent.change(screen.getByLabelText(/Prompt cache/i), {
      target: { value: "extended" },
    });
    saveAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const agents = createGgConfig.mock.calls[0]![0].capabilitySet.agents;
    expect(agents[0].promptCacheTtl).toBe("extended");
    // The untouched agent writes no key at all, so it keeps paying the base rate.
    expect(agents[1].promptCacheTtl).toBeUndefined();
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

// The back chevron beside the title goes up exactly one step. While an agent is open that
// step is the **configuration**, not the list of configurations — the list is two steps up
// and leaving for it would throw away the whole configuration rather than this agent's
// edits. It behaves like Cancel, except that it asks first when there is something to lose.
describe("going back from an open agent", () => {
  beforeEach(() => createGgConfig.mockClear());

  // The back control, which is a button (not a link) while an agent is open.
  function backControl() {
    return screen.getByRole("button", { name: /^Back to / });
  }

  it("returns to the configuration without asking when nothing was edited", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    expect(screen.getByPlaceholderText("e.g. reviewer")).toBeVisible();

    fireEvent.click(backControl());
    // Straight back — an unedited agent has nothing to decide about.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
  });

  it("asks before discarding an edited agent, and keeps editing if told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // "Keep editing" is the safe way out: it leaves the agent open, edits intact.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. reviewer")).toHaveValue(
      "conductor",
    );
  });

  it("discards the agent's edits when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      }),
    );
    // Back on the configuration, and the rename never reached it.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("conductor")).not.toBeInTheDocument();
  });

  it("saves the agent when told to, keeping the edits on the configuration", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Save agent",
      }),
    );
    // Back on the configuration with the rename kept — the dialog's Save is the same
    // commit the Save agent button performs.
    openTab("Agents");
    expect(screen.getByText("conductor")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("refuses to save an agent that is not well-formed, and says why", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    // An agent with no name cannot be committed; the dialog must not offer a Save that
    // silently does nothing.
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Save agent" }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/needs a name/i)).toBeInTheDocument();
    // Discarding is still open to them, and puts the agent back as it was.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
  });
});

// The configuration's own back control leaves for the list of configurations, and asks
// the same question an open agent's does — through the same dialog. Two prompts for one
// question (a browser `confirm` here, a component dialog one step in) made a single form
// read as two, and only one of them could offer "save and go" at all.
describe("going back from the configuration", () => {
  beforeEach(() => createGgConfig.mockClear());

  // The back control on the configuration itself, which is a button rather than a link
  // because leaving has to wait for the dialog's answer.
  function backControl() {
    return screen.getByRole("button", { name: "All gg configurations" });
  }

  it("leaves without asking when nothing was edited", async () => {
    renderPage();
    await screen.findByText("Run limits");

    fireEvent.click(backControl());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(CONFIG_LIST)).toBeInTheDocument();
  });

  it("asks before discarding an edited configuration, and keeps editing if told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toHaveValue(
      "no-shell",
    );
  });

  it("discards the configuration when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      }),
    );
    expect(screen.getByText(CONFIG_LIST)).toBeInTheDocument();
    expect(createGgConfig).not.toHaveBeenCalled();
  });

  // The third way out the browser's own prompt could never offer: commit the work and
  // leave, in one press.
  it("saves and leaves when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Create configuration",
      }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    expect(createGgConfig.mock.calls[0]![0].name).toBe("no-shell");
    expect(await screen.findByText(CONFIG_LIST)).toBeInTheDocument();
  });

  // A configuration that cannot be saved must not offer a Save that silently does
  // nothing — the same refusal the agent dialog makes, said in the same place.
  it("refuses to save a configuration that is not well-formed, and says why", async () => {
    renderPage();
    await screen.findByText("Run limits");
    // A name is what makes a configuration savable; typing one and taking it away
    // again leaves the form dirty *and* unsavable.
    const nameField = screen.getByPlaceholderText("e.g. no-compaction");
    fireEvent.change(nameField, { target: { value: "no-shell" } });
    openTab("Agents");
    fireEvent.click(
      screen.getByRole("button", { name: /^Remove the .* agent$/ }),
    );

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/at least one agent/i)).toBeInTheDocument();
  });
});
