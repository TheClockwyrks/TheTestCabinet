package gg;

import java.util.Optional;

/**
 * One child agent's collected result.
 *
 * @param id The child's id.
 * @param status How it finished; empty when it produced no return value at all.
 * @param summary Its final message.
 */
public record SubagentResult(String id, Optional<AgentEnding> status, String summary) {
}
