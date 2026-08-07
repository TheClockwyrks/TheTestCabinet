package gg;

/**
 * An epic that was just created: the id its prefix resolved to, and the board budget.
 *
 * @param id The epic's id — the prefix you gave, upper-cased ({@code auth} → {@code AUTH}). Group
 *     issues under it with this, and its issues are numbered from it ({@code AUTH-1}).
 * @param board How much of the board budget is used.
 */
public record EpicCreated(String id, BoardUsage board) {
}
