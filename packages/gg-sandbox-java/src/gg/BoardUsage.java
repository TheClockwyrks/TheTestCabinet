package gg;

/**
 * How much of the run's board budget is used, after the call that returned it.
 *
 * @param epics Epics currently on the board.
 * @param maxEpics The most epics this run allows.
 * @param issues Issues currently on the board.
 * @param maxIssues The most issues this run allows.
 */
public record BoardUsage(int epics, int maxEpics, int issues, int maxIssues) {
}
