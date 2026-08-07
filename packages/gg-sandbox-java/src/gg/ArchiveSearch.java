package gg;

import java.util.List;

/**
 * What {@code context.searchArchive} found.
 *
 * @param archiveEmpty Nothing has been archived yet, so there was nothing to search. Deliberately
 *     distinct from a search that ran and matched nothing, so you do not archive again believing
 *     the first archive failed.
 * @param hits The matches, most recent first, at most 8.
 */
public record ArchiveSearch(boolean archiveEmpty, List<ArchiveHit> hits) {
}
