import { createContext, useContext } from "react";

// A tiny navigation channel from the whole-run Dashboard into the Agents explorer.
//
// The Dashboard's agent overview lets you click an agent to jump straight to its
// files, but the Agents tab and the explorer's selection are state owned by
// {@link GgRunPanels}. Rather than thread a callback down through the `dashboard`
// node the host builds, the panels *provide* this context: the Dashboard node is
// rendered as a descendant of the panels, so a card inside it reads the channel by
// render tree, not by where it was constructed. Null when no provider is mounted (a
// Dashboard shown outside the panels), in which case the overview renders its agents
// as plain, un-clickable rows.
export interface GgExplorerNav {
  // Switch to the Agents tab and focus the given agent's Overview.
  openAgent: (agentId: string) => void;
}

export const GgExplorerNavContext = createContext<GgExplorerNav | null>(null);

export function useGgExplorerNav(): GgExplorerNav | null {
  return useContext(GgExplorerNavContext);
}
