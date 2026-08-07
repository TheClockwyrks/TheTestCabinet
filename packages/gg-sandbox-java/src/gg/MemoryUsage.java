package gg;

import java.util.OptionalInt;

/**
 * How much of the run's durable-memory budget is used, after the call that returned it.
 *
 * <p>Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
 * only some of them, so an empty one means nothing bounds that axis — check before subtracting.
 *
 * @param count Memories currently held.
 * @param maxCount The most memories this run allows, if it limits the count.
 * @param totalChars Characters of body currently held, across all memories.
 * @param maxTotalChars The most characters of body this run allows in total, if it limits the
 *     aggregate.
 * @param indexChars Characters the memory index occupies, under a run that keeps one.
 * @param maxIndexChars The most characters the index may occupy, if it is limited.
 */
public record MemoryUsage(int count, OptionalInt maxCount, int totalChars,
        OptionalInt maxTotalChars, OptionalInt indexChars, OptionalInt maxIndexChars) {
}
