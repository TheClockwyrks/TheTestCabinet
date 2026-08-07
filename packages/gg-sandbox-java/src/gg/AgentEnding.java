package gg;

/** How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them. */
public enum AgentEnding {
    /** It finished normally: it called {@code harness.finish}, and its summary is what it returned. */
    COMPLETED,
    /** It hit the per-run turn ceiling. */
    EXHAUSTED,
    /** It passed its wall-clock deadline. */
    TIMED_OUT,
    /** A model turn failed. */
    MODEL_ERROR,
    /** The run's credential was refused. */
    AUTH_ERROR,
    /** An execution ceiling stopped it — consecutive errors, error rate, or cost. */
    LIMIT_EXCEEDED
}
