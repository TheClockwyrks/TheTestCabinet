package gg;

/**
 * An inclusive span of turn numbers, the unit {@code context.archiveThread} moves out of the
 * window.
 *
 * <p>The numbers are the ones on the header of every result you are given, so
 * {@code new TurnRange(4, 19)} means exactly the turns you can see numbered 4 through 19 — both
 * ends included.
 *
 * @param from The first turn in the span.
 * @param to The last turn in the span, inclusive.
 */
public record TurnRange(int from, int to) {
}
