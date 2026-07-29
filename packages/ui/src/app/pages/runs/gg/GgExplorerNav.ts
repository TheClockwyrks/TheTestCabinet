import { createContext, useContext } from "react";

// A tiny navigation channel from the run-wide panels into the Instances explorer.
//
// The Dashboard's agent overview and the Agents tab's instance chips both let you click
// through to one instance's files, but the selected tab and the explorer's selection are
// state owned by {@link GgRunPanels}. Rather than thread a callback down through the
// `dashboard` node the host builds, the panels *provide* this context: the Dashboard node is
// rendered as a descendant of the panels, so a card inside it reads the channel by
// render tree, not by where it was constructed. Null when no provider is mounted (a
// Dashboard shown outside the panels), in which case the overview renders its agents
// as plain, un-clickable rows.
export interface GgExplorerNav {
  // Switch to the Instances tab and focus the given instance's Overview.
  openAgent: (agentId: string) => void;
}

export const GgExplorerNavContext = createContext<GgExplorerNav | null>(null);

export function useGgExplorerNav(): GgExplorerNav | null {
  return useContext(GgExplorerNavContext);
}
