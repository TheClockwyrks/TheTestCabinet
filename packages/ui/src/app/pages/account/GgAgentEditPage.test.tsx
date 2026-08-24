// The saved-agent editor, on the three things only the whole page shows.
//
// 1. What it writes. A saved agent is one profile, and the model slots its bindings defer
//    to travel *on* that profile — they are the agent's own declaration of the models it
//    is handed at launch, so an import carries them along and the configuration that
//    imports it decides how each one reaches the launch form.
// 2. That it is the same per-agent form a configuration opens. An operator authoring an
//    agent here and one editing it inside a configuration must be looking at one form,
//    or the library is a second, drifting editor — which is why the slots are edited on
//    the editor's own Slots tab rather than in a section this page adds around it.
// 3. Which half of a profile's identity the operator is handed. A profile carries two: an
//    opaque internal id, minted once and shown to nobody, which is what an importing
//    configuration's link and every reference inside it points at; and the **slug**, the
//    name the model is shown and passes back, which is the operator's to write. This form
//    offers exactly one of them — and a saved agent written back under a fresh id would
//    silently detach every configuration following it.

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgSavedAgent } from "@test-cabinet/run-record/gg";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgAgentEditPage } from "./GgAgentEditPage";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// A signed-in operator: a saved agent is account-scoped, so the token unlocks the form.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

const createGgAgent = vi.fn().mockResolvedValue({ id: "a1" });
const updateGgAgent = vi.fn().mockResolvedValue({ id: "saved-1" });

// One agent as the library already holds it: an internal id minted in whatever session
// created it, the slug the operator wrote beside it, and the one slot its binding defers
// to. Written out the way the contract carries it, because that is what `GET /gg/agents`
// hands the page — the form's job is to open on it and give it back.
const STORED_AGENT: GgSavedAgent = {
  id: "saved-1",
  name: "Critic",
  description: "reads what the implementer wrote",
  agent: {
    id: "a-minted-earlier",
    slug: "critic",
    name: "Critic",
    capabilities: [],
    modelId: "",
    modelSlot: "primary",
    modelSlots: [{ name: "primary", passthrough: true }],
  },
  updatedAt: "2026-08-18T00:00:00Z",
};

// What `GET /gg/agents` answers with. Empty except where a test opens a stored agent: the
// page reads the library only when it has one to load or duplicate.
let library: GgSavedAgent[] = [];

beforeEach(() => {
  library = [];
});

function backendValue(): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([]),
      listGgAgents: vi.fn().mockResolvedValue(library),
      createGgAgent,
      updateGgAgent,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

// Standing in for the list of agents, so a test can tell that saving actually left the
// editor rather than merely clearing the form.
const AGENT_LIST = "the gg agents list";

function renderPage(path = "/account/gg/agents/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/agents/new" element={<GgAgentEditPage />} />
          <Route
            path="/account/gg/agents/:agentId/edit"
            element={<GgAgentEditPage />}
          />
          <Route path="/account/gg/agents" element={<div>{AGENT_LIST}</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// Open one of the per-agent form's tabs by its label. Matched on the label element rather
// than the tab's accessible name, because a tab with something wrong on it also announces
// the count ("Slots, 1 problem") — which is the point of the badge, and would make an
// exact name match depend on whether the section happens to be complete.
function openTab(name: string) {
  const tab = screen
    .getAllByRole("tab")
    .find((entry) => entry.firstElementChild?.textContent?.trim() === name);
  if (!tab) throw new Error(`no "${name}" tab`);
  fireEvent.click(tab);
}

describe("GgAgentEditPage", () => {
  it("opens on the per-agent form, with no configuration-level sections", () => {
    renderPage();
    // The agent's own sections, and nothing a configuration owns: an agent carries no
    // run ceilings and no session hooks, because those happen once per run.
    expect(screen.getByRole("tab", { name: /^Agent/ })).toBeVisible();
    expect(screen.queryByText("Run limits")).toBeNull();
    expect(screen.queryByText("Session hooks")).toBeNull();

    // The slots are a section of the per-agent form, reached through its tab strip —
    // not a list this page stacks above the strip. The distinction is the whole point:
    // a slot belongs to the profile whose bindings defer to it, so the form that edits
    // the profile is the form that edits its slots.
    expect(screen.getByRole("tab", { name: /^Slots/ })).toBeVisible();
    expect(screen.queryByLabelText("Slot name")).toBeNull();
    openTab("Slots");
    expect(screen.getByLabelText("Slot name")).toBeVisible();
  });

  // The library entry's note is part of the agent's identity, so it belongs beside the
  // name and slug on the Agent tab — not stacked above the tab strip, where it was one
  // field of the form sitting outside the form.
  it("edits the description on the Agent tab, beside the name it describes", () => {
    renderPage();
    const description = screen.getByPlaceholderText("what this agent is for");
    expect(description).toBeVisible();
    // Inside the tab strip's panel: leaving the Agent tab takes it with it.
    openTab("Slots");
    expect(screen.queryByPlaceholderText("what this agent is for")).toBeNull();
  });

  it("saves the agent's own model slots on the agent, passthrough and all", async () => {
    createGgAgent.mockClear();
    renderPage();

    fireEvent.change(screen.getByLabelText(/^Agent name/), {
      target: { value: "reviewer" },
    });
    fireEvent.change(screen.getByPlaceholderText("what this agent is for"), {
      target: { value: "reviews what the implementer wrote" },
    });

    // A second binding to defer, so the agent declares more than the one slot it is born
    // with: the summarizer that condenses its window is a model of its own, and picking
    // it at launch is the whole reason a slot exists.
    openTab("Tools");
    fireEvent.click(screen.getByRole("checkbox", { name: /^Compaction/i }));
    fireEvent.change(
      screen.getByRole("combobox", { name: /Summarization strategy/i }),
      { target: { value: "handoff-compaction" } },
    );
    fireEvent.change(screen.getByLabelText(/^Model from/), {
      target: { value: "model-slot" },
    });

    // The slots are named here, not bound: which model runs each of them is settled by
    // the launch that fills it.
    openTab("Slots");
    fireEvent.change(screen.getByLabelText("Slot name"), {
      target: { value: "critic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add model slot" }));
    const names = screen.getAllByLabelText("Slot name");
    fireEvent.change(names[1]!, { target: { value: "summarizer" } });
    // Passthrough is what puts a slot on the launch form under `<slug>.<name>`; the one a
    // fresh profile is born with already carries it, so the added one is ticked by hand.
    fireEvent.click(
      screen.getAllByRole("checkbox", { name: /^Passthrough/ })[1]!,
    );

    // …and the compaction binding is pointed at the second slot, which is what stops it
    // being a declaration nothing defers to.
    openTab("Tools");
    const slotPicker = screen.getByLabelText(
      /^Model slot/,
    ) as HTMLSelectElement;
    fireEvent.change(slotPicker, {
      target: {
        value: (
          Array.from(slotPicker.options).find(
            (option) => option.textContent === "summarizer",
          ) as HTMLOptionElement
        ).value,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(createGgAgent).toHaveBeenCalled());
    const [input] = createGgAgent.mock.calls[0]!;
    expect(input.agent.name).toBe("reviewer");
    expect(input.description).toBe("reviews what the implementer wrote");
    // The binding names the slot, and the slot is declared on the agent beside it — the
    // library stores one whole profile, so there is no second half to send.
    expect(input.agent.modelSlot).toBe("critic");
    expect(input.agent.modelSlots).toEqual([
      { name: "critic", passthrough: true },
      { name: "summarizer", passthrough: true },
    ]);
    expect(input).not.toHaveProperty("modelSlots");
    // The run-level halves of a configuration are not an agent's to carry.
    expect(input.agent).not.toHaveProperty("limits");
    expect(await screen.findByText(AGENT_LIST)).toBeVisible();
  });

  it("refuses to save an agent with no name", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Agent name/), {
      target: { value: "  " },
    });
    expect(screen.getByRole("button", { name: "Create agent" })).toBeDisabled();
    expect(screen.getByText("Every agent needs a name.")).toBeVisible();
  });

  it("flags a declared slot nothing in the agent binds", () => {
    renderPage();
    openTab("Slots");
    fireEvent.click(screen.getByRole("button", { name: "+ Add model slot" }));
    expect(
      screen.getByText(/This agent binds nothing to this slot/),
    ).toBeVisible();
  });

  // A saved agent declares no configuration slots — it is one profile, and the launch
  // inputs are the importing configuration's business — so passthrough is the only way a
  // slot here reaches a launch form at all. Clearing it leaves a binding with nowhere to
  // get a model from, which is a state the library must not store.
  it("refuses to save a slot that reaches no launch input, and names both fixes", () => {
    renderPage();
    openTab("Slots");
    fireEvent.click(screen.getByRole("checkbox", { name: /^Passthrough/ }));

    // Said beside the slot, where it is fixed…
    expect(screen.getByText(/Nothing fills this slot/)).toBeVisible();
    // …and again on the save, which names the two ways out rather than only refusing.
    expect(screen.getByRole("button", { name: "Create agent" })).toBeDisabled();
    expect(
      screen.getByText(
        /reaches no launch input — map a configuration slot onto it, or mark it passthrough\./,
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("checkbox", { name: /^Passthrough/ }));
    expect(screen.getByRole("button", { name: "Create agent" })).toBeEnabled();
  });

  // The slug is what the model is shown and passes back, so it is the operator's to write
  // rather than whatever was minted from the name the profile was created under. It is one
  // of a profile's *three* strings and interchangeable with neither of the others: the
  // display name is prose that may repeat, and the internal id is the opaque thing every
  // reference points at, which is why writing a slug moves that one field alone.
  it("saves the profile under the slug the operator writes, and neither of its other names", async () => {
    createGgAgent.mockClear();
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Agent name/), {
      target: { value: "Reviewer" },
    });
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "merge-bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(createGgAgent).toHaveBeenCalled());
    const [input] = createGgAgent.mock.calls[0]!;
    expect(input.agent.slug).toBe("merge-bot");
    // The name the operator typed above it is untouched by the rename…
    expect(input.agent.name).toBe("Reviewer");
    // …and so is the id the profile was minted with, which is neither of them and is what
    // an importing configuration's link will point at.
    expect(input.agent.id).not.toBe("merge-bot");
    expect(input.agent.id).not.toBe("Reviewer");
  });

  // The same identity split, read back off a profile the library already holds. The slug is
  // the half the form offers — it is on a control, it is what the operator retypes — and the
  // internal id is the half it must carry through untouched: it was minted in whatever
  // session created this agent, and every configuration that imported it links to that
  // string. A save that re-minted it would detach each of them at once, silently and for
  // good, so the round trip is worth asserting rather than assuming.
  it("opens a stored agent on its slug and writes it back under the id it was minted with", async () => {
    library = [STORED_AGENT];
    updateGgAgent.mockClear();
    renderPage("/account/gg/agents/saved-1/edit");

    expect(await screen.findByLabelText(/^Slug/)).toHaveValue("critic");
    // The id is nobody's to read, so it is on no control and in no text of the page.
    expect(screen.queryByDisplayValue("a-minted-earlier")).toBeNull();
    expect(screen.queryByText("a-minted-earlier")).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "merge-bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agent" }));

    await waitFor(() => expect(updateGgAgent).toHaveBeenCalled());
    const [id, input] = updateGgAgent.mock.calls[0]!;
    expect(id).toBe("saved-1");
    expect(input.agent.slug).toBe("merge-bot");
    expect(input.agent.id).toBe("a-minted-earlier");
    // And the slot its binding defers to came back out with it, passthrough and all — the
    // slots are the agent's own, so a round trip through this form is what preserves them.
    expect(input.agent.modelSlot).toBe("primary");
    expect(input.agent.modelSlots).toEqual([
      { name: "primary", passthrough: true },
    ]);
  });

  it("refuses a slug gg could not hold, saying what shape one is", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "Merge Bot" },
    });
    // Beside the field, because that is where it is typed…
    expect(
      screen.getByText(/^A slug is lowercase letters and digits/),
    ).toBeVisible();
    // …and on the save, which will not write a profile the model could not name.
    expect(screen.getByRole("button", { name: "Create agent" })).toBeDisabled();
    expect(
      screen.getByText(/slug must be lowercase letters and digits/),
    ).toBeVisible();
  });
});
