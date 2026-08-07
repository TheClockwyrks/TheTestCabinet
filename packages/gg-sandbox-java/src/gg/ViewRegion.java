package gg;

/**
 * The window of lines a <b>paged</b> file view covers.
 *
 * @param offset The 1-based first line the view shows.
 * @param limit How many lines it shows.
 */
public record ViewRegion(int offset, int limit) {
}
