package gg;

/**
 * What a child agent is briefed with.
 *
 * <p>The choice is a type rather than a pair of optional arguments, so "both" and "neither" are
 * programs that do not compile instead of calls that fail at run time:
 * {@code agents.spawnSubagent("builder", Brief.prompt("write the parser"))} or
 * {@code agents.spawnSubagent("builder", Brief.issue("AUTH-1"))}.
 */
public final class Brief {
    private final String field;
    private final String value;

    private Brief(String field, String value) {
        this.field = field;
        this.value = value;
    }

    /**
     * Brief the child with self-contained instructions, so it needs no other context.
     *
     * @param instructions Everything the child needs to know, written for a reader with no other
     *     context.
     * @return the brief to hand to {@code agents.spawnSubagent}
     */
    public static Brief prompt(String instructions) {
        return new Brief("prompt", instructions);
    }

    /**
     * Brief the child from a board issue, as {@code project.createIssue} returned its id.
     *
     * @param issueId The id of the issue to brief the child from.
     * @return the brief to hand to {@code agents.spawnSubagent}
     */
    public static Brief issue(String issueId) {
        return new Brief("issueId", issueId);
    }

    /** Which field of the request this brief fills. */
    String field() {
        return field;
    }

    /** What it fills it with. */
    String value() {
        return value;
    }
}
