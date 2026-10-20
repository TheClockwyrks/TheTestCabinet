import type { RunSummary } from "@clockwyrks/run-record/snapshot";

/**
 * What one agent profile of a gg run spent, as the run log lists it beneath the
 * run's row: the profile, the model it ran on, how many instances of it the run
 * made, and the figures those instances summed to.
 *
 * A gg configuration declares profiles (Root, a reviewer, an implementer) and a
 * run makes as many instances of each as the work calls for, so the figures are
 * per profile rather than per instance, the same fold the gg run page's Agents
 * tab makes. A profile the configuration declares but the run never instantiated
 * is listed with no instances and nothing spent.
 */
export interface GgAgentFigures {
  /** The profile's slug, which every telemetry event names it by. */
  profile: string;
  /** The profile's display name at launch. */
  name: string;
  /** The model the profile's instances ran on. */
  modelId: string;
  /** Whether this is the configuration's primary (root) agent. */
  primary: boolean;
  /** How many instances of the profile the run made: zero for a profile it never
   * started. */
  instances: number;
  tokens: RunSummary["metrics"]["tokens"];
  cost: RunSummary["metrics"]["cost"];
}

/**
 * A gg run's per-agent figures, primary agent first and the rest in the order
 * the configuration declares them, or null when the run is not a gg run or its
 * summary carries none (a record from before the figures were lifted onto it).
 */
export function ggAgentsOf(summary: RunSummary): GgAgentFigures[] | null {
  // Proposed summary field: carried by the sample cabinet only until the
  // backend lifts it onto the card.
  const agents = (summary as { ggAgents?: GgAgentFigures[] | null }).ggAgents;
  if (!agents || agents.length === 0) return null;
  return [
    ...agents.filter((agent) => agent.primary),
    ...agents.filter((agent) => !agent.primary),
  ];
}
