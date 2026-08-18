// The saved-agent editor, on the two things only the whole page shows.
//
// 1. What it writes. A saved agent is one profile plus the model slots it defers to,
//    and the slots are the half that is easy to get wrong: they belong to the
//    configuration that runs the agent, so the library records the names it expects
//    rather than a binding.
// 2. That it is the same per-agent form a configuration opens. An operator authoring an
//    agent here and one editing it inside a configuration must be looking at one form,
//    or the library is a second, drifting editor.

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
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

function backendValue(): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([]),
      listGgAgents: vi.fn().mockResolvedValue([]),
      createGgAgent,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/account/gg/agents/new"]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/agents/new" element={<GgAgentEditPage />} />
          <Route path="/account/gg/agents" element={<div>{AGENT_LIST}</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgAgentEditPage", () => {
  it("opens on the per-agent form, with no configuration-level sections", () => {
    renderPage();
    // The agent's own sections, and nothing a configuration owns: an agent carries no
    // run ceilings and no session hooks, because those happen once per run.
    expect(screen.getByRole("tab", { name: /^Agent/ })).toBeVisible();
    expect(screen.queryByText("Run limits")).toBeNull();
    expect(screen.queryByText("Session hooks")).toBeNull();
    expect(screen.getByText("Model slots")).toBeVisible();
  });

  it("saves the profile and the slot names its bindings defer to", async () => {
    createGgAgent.mockClear();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "reviewer" },
    });
    fireEvent.change(screen.getByPlaceholderText("what this agent is for"), {
      target: { value: "reviews what the implementer wrote" },
    });
    // The slot the agent defers to is named here, not bound: which model runs it is
    // settled by the configuration that imports it and the launch that fills the slot.
    fireEvent.change(screen.getByPlaceholderText("e.g. primary"), {
      target: { value: "critic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(createGgAgent).toHaveBeenCalled());
    const [input] = createGgAgent.mock.calls[0]!;
    expect(input.agent.name).toBe("reviewer");
    expect(input.description).toBe("reviews what the implementer wrote");
    expect(input.agent.modelSlot).toBe("critic");
    expect(input.modelSlots).toEqual([{ name: "critic" }]);
    // The run-level halves of a configuration are not an agent's to carry.
    expect(input.agent).not.toHaveProperty("limits");
    expect(await screen.findByText(AGENT_LIST)).toBeVisible();
  });

  it("refuses to save an agent with no name", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("e.g. reviewer"), {
      target: { value: "  " },
    });
    expect(screen.getByRole("button", { name: "Create agent" })).toBeDisabled();
    expect(screen.getByText("Every agent needs a name.")).toBeVisible();
  });

  it("flags a declared slot nothing in the agent binds", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "+ Add model slot" }));
    expect(
      screen.getByText(/This agent binds nothing to this slot/),
    ).toBeVisible();
  });
});
