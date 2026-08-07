package gg;

/** Who said an archived message. */
public enum MessageRole {
    /** The system prompt. */
    SYSTEM,
    /** A turn's input to you — a result, a view, or an operator's instruction. */
    USER,
    /** Something you said. */
    ASSISTANT,
    /** A tool result, on a session that made tool calls rather than writing programs. */
    TOOL
}
