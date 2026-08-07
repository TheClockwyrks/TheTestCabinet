package gg;

/**
 * How much of the run's task budget is used, after the call that returned it.
 *
 * @param count Tasks currently on the list.
 * @param maxTasks The most tasks this run allows.
 */
public record TaskUsage(int count, int maxTasks) {
}
