/**
 * How much of the run's durable-memory budget is used, after the call that returned it.
 *
 * Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only some
 * of them, so a `null` means nothing bounds that axis — check before subtracting.
 *
 * @property count Memories currently held.
 * @property maxCount The most memories this run allows, if it limits the count.
 * @property totalChars Characters of body currently held, across all memories.
 * @property maxTotalChars The most characters of body this run allows in total, if it limits the
 *   aggregate.
 * @property indexChars Characters the memory index occupies, under a run that keeps one.
 * @property maxIndexChars The most characters the index may occupy, if it is limited.
 */
public data class MemoryUsage(
    val count: Int,
    val maxCount: Int?,
    val totalChars: Int,
    val maxTotalChars: Int?,
    val indexChars: Int?,
    val maxIndexChars: Int?,
)

/**
 * One memory `memory.searchMemories` matched, and the numbers it was ranked by.
 *
 * @property name The memory's slug — what `memory.readMemory` takes.
 * @property description Its description, or `""` when it was created without one.
 * @property matched How many of your distinct keywords it matched — the primary ranking.
 * @property occurrences How many times those keywords occur in it — the tiebreak.
 * @property excerpt A short window of the memory around its first match.
 */
public data class MemoryHit(
    val name: String,
    val description: String,
    val matched: Int,
    val occurrences: Int,
    val excerpt: String,
)
