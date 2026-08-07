package gg;

/** Where a task stands. */
public enum TaskStatus {
    /** Not started. Every task begins here. */
    PENDING("pending"),
    /** Being worked on now. */
    IN_PROGRESS("in_progress"),
    /** Finished. Tasks blocked on it become actionable once all their blockers are done. */
    DONE("done");

    private final String wire;

    TaskStatus(String wire) {
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
