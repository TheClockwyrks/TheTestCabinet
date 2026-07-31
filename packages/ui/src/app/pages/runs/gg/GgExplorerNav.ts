import { createContext, useContext } from "react";
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
   */
  openModule: (moduleId: string) => void;
  /**
   * Switch to the Agents tab and open one configured agent's row — the run read at the
   * grain a configuration is actually tuned at. A module's holder is an instance *of*
   * something, and "is this how the Reviewer profile is meant to be sharing?" is a
   * question about the profile, not about the instance.
   */
  openProfile: (name: string) => void;
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
