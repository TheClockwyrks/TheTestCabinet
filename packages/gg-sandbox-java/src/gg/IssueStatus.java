package gg;

/** Where an issue stands. */
public enum IssueStatus {
    /** Not started, and dispatchable once its blockers are done. */
    OPEN("open"),
    /** Dispatched, with its assigned agent working on it. */
    IN_PROGRESS("in_progress"),
    /** Finished and, where this run requires reviewers, approved. */
    DONE("done");

    private final String wire;

    IssueStatus(String wire) {
        this.wire = wire;
    }

    /**
     * gg's own word for this status, which is what both execution modes report.
     *
     * @return the name gg uses on the wire
     */
    public String wireName() {
        return wire;
    }
}
