package gg;

import java.util.List;

/**
 * What a context reclaim actually freed from the live context window.
 *
 * @param items Context items dropped from the live window.
 * @param reclaimedTokens Approximately how many tokens that freed.
 * @param paths The workspace paths whose views were evicted. Empty for an archive.
 * @param detail The prose summary of what was reclaimed.
 */
public record ReclaimReport(int items, int reclaimedTokens, List<String> paths, String detail) {
}
