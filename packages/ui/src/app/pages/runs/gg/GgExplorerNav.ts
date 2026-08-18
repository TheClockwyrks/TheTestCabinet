import { createContext, useContext } from "react";
import type { GgModuleKind } from "@test-cabinet/run-record/gg";
import type { AgentEntry } from "./ggAgentEntries";

// A tiny navigation channel from the run-wide panels into the explorers that read one
// thing at a time.
//
// The Dashboard's agent overview, the Agents tab's instance chips and a module's board
// read-out all let you click through to somewhere else in the panels, but the selected
// tab and each explorer's selection are state owned by {@link GgRunPanels}. Rather than
// thread a callback down through the `dashboard` node the host builds, the panels
// *provide* this context: the Dashboard node is rendered as a descendant of the panels,
// so a card inside it reads the channel by render tree, not by where it was constructed.
// Null when no provider is mounted (a Dashboard shown outside the panels), in which case
// every consumer degrades to plain, un-clickable text.
export interface GgExplorerNav {
  /**
   * Switch to the Instances tab and open one agent instance, landing on `entry` when the
   * caller has one in mind (a module's holder chip means "this store, read from that
   * instance") and on its Overview when it does not.
   */
  openAgent: (agentId: string, entry?: AgentEntry) => void;
  /**
   * Switch to the Modules tab and open one module instance — the store read as a store:
   * every instance that ever held it, its whole lifetime, and what it costs the run. The
   * counterpart of {@link openAgent}: that one reads a store from an agent, this one
   * reads it from nobody in particular.
   *
   * **Absent when the run has no Modules tab.** The tab is offered only for a run whose
   * profiles enable a module-backed capability, while a `history` module — which has no
   * capability behind it — is on every instance of every run, so a link to a tab that does
   * not exist is reachable in ordinary runs. Rendering it would switch to a tab the
   * selector immediately falls back out of, dropping the reader on the Dashboard and losing
   * their place; so the absence of the method *is* the answer, and a caller renders plain
   * text (or nothing) instead of a dead button.
   */
  openModule?: (moduleId: string) => void;
  /**
   * Switch to the Modules tab and open one module *kind's* whole-run read-out — how many
   * stores of it the run opened, how widely they are shared, what they cost and how much
   * they hold.
   *
   * The counterpart of {@link openModule} for a question that no single store answers:
   * "twelve private notebooks holding two notes each" against "one store four agents
   * curate" is only legible with every instance of the kind side by side, which is what a
   * profile whose stores are one-per-instance has to hand its reader through to. Optional
   * on the same terms as {@link openModule}.
   */
  openModuleKind?: (kind: GgModuleKind) => void;
  /**
   * Switch to the Agents tab and open one configured agent's row, by profile ID — the run
   * read at the grain a configuration is actually tuned at. A module's holder is an
   * instance *of* something, and "is this how the Reviewer profile is meant to be
   * sharing?" is a question about the profile, not about the instance.
   */
  openProfile: (profileId: string) => void;
  /**
   * Switch to the run-global Project tab — the board itself. A module read-out links here
   * rather than drawing a second board: the board is one thing the whole run shares, and
   * two renderings of it is exactly the duplication module identity exists to stop.
   */
  openProject: () => void;
}

export const GgExplorerNavContext = createContext<GgExplorerNav | null>(null);

export function useGgExplorerNav(): GgExplorerNav | null {
  return useContext(GgExplorerNavContext);
}
