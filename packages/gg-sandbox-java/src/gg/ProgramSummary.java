package gg;

import java.util.Optional;

/**
 * One program you have already run, as {@code programs.history} lists it.
 *
 * <p>It describes the program's <b>shape</b>, never its source: a directory that inlined every
 * program would put the whole session back in front of you, which is the one thing the library
 * exists to avoid. Fetch the source you actually want with {@code programs.get}.
 *
 * @param turn The turn it ran on — what {@code programs.get} takes.
 * @param lines How many lines of source it was.
 * @param chars How many characters of source it was.
 * @param ok Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping
 *     it.
 * @param error The error it ended with, when it did not run to its end.
 */
public record ProgramSummary(int turn, int lines, int chars, boolean ok, Optional<String> error) {
}
