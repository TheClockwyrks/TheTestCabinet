package gg;

/**
 * An issue that was just created: the id the board assigned it, and the board budget.
 *
 * @param id The id the board assigned ({@code AUTH-1}) — you do not choose it. Use it to block
 *     later issues on this one, or to wait for it.
 * @param board How much of the board budget is used.
 */
public record IssueCreated(String id, BoardUsage board) {
}
