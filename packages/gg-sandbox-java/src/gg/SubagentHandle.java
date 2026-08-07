package gg;

/**
 * A child agent that was spawned and is now running in parallel.
 *
 * @param id The child's id — pass it to {@code agents.waitForSubagents} or
 *     {@code agents.sendMessage}.
 * @param slot The agent profile it runs as.
 * @param modelId The model actually bound to that agent.
 */
public record SubagentHandle(String id, String slot, String modelId) {
}
