package gg;

/**
 * A text file's window, as the {@link TextFile} arm of a read carries it.
 *
 * @param contents The file's text, or just the requested window under a capped read policy.
 * @param firstLine The 1-based first line returned.
 * @param lastLine The 1-based last line returned.
 * @param totalLines The file's total line count, so you know whether to page again.
 * @param byteTruncated Whether a 256 KiB byte ceiling cut the returned text.
 */
public record TextFile(String contents, int firstLine, int lastLine, int totalLines,
        boolean byteTruncated) implements FileRead {
}
