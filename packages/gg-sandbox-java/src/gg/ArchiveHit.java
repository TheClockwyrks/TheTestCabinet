package gg;

/**
 * One archived message that matched a search.
 *
 * @param seq The archived message's sequence number.
 * @param role Who said it.
 * @param text The message text.
 */
public record ArchiveHit(int seq, MessageRole role, String text) {
}
