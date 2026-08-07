package gg;

/**
 * One memory {@code memory.searchMemories} matched, and the numbers it was ranked by.
 *
 * @param name The memory's slug — what {@code memory.readMemory} takes.
 * @param description Its description, or {@code ""} when it was created without one.
 * @param matched How many of your distinct keywords it matched — the primary ranking.
 * @param occurrences How many times those keywords occur in it — the tiebreak.
 * @param excerpt A short window of the memory around its first match.
 */
public record MemoryHit(String name, String description, int matched, int occurrences,
        String excerpt) {
}
