package gg;

import java.util.OptionalInt;

/**
 * What a command {@code system.shell} ran reported when it finished.
 *
 * @param exitCode The process's exit status; empty when a signal killed it. Zero means success.
 * @param output Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads
 *     shell output, at the configured line/character ceiling, with a note naming the files holding
 *     the whole of it. Under the default {@code adaptive} mode a command that succeeded returns
 *     just that note.
 * @param truncated Whether the cap cut {@code output}, dropping the head and keeping the tail.
 */
public record ShellOutput(OptionalInt exitCode, String output, boolean truncated) {
}
