#!/bin/sh
# Ralph orchestrator runner — the simplest multi-session strategy.
#
# Each session is told to resume from a progress file, make some progress toward
# the goal, update the progress file, and create a marker file once the entire
# implementation is done. The runner re-runs sessions until that marker file
# appears or the run's deadline is reached. See `orchestrators/README.md` and the
# design doc at
# `apps/docs/src/content/docs/components/core/orchestrators.md`.
#
# Deliberately minimal: the only control logic is "check the marker file, run a
# session if it does not exist." The run's maximum runtime is the hard backstop;
# `TCAB_DEADLINE` lets the loop stop gracefully before it, leaving whatever
# progress exists on disk to be collected and validated.
set -u

status_file="$TCAB_WORKSPACE/$TCAB_PARAM_STATUS_FILE"
marker_file="$TCAB_WORKSPACE/$TCAB_PARAM_MARKER_FILE"

# Keep the orchestrator's scratch files together under a dot-directory so they
# are easy to keep out of the collected implementation.
mkdir -p "$(dirname "$status_file")" "$(dirname "$marker_file")"

# The protocol layered on top of the test case's goal ($TCAB_PROMPT). The model
# records and resumes progress through $status_file across sessions, and signals
# completion by creating $marker_file.
protocol="You are implementing a large task across multiple work sessions; you are not expected to finish it all in one session.

A progress file at $status_file tracks what has been done and what remains. At the start of this session, read it if it exists and resume from where it leaves off; if it does not exist yet, create it.

Make meaningful, correct progress toward the goal this session. Before you stop, update $status_file so the next session can resume: record what is now done, what is left, and any context it will need. Revise it rather than deleting prior progress.

Only once the ENTIRE goal below is fully implemented and verified, create the file $marker_file to signal completion. Do not create it early.

The goal:

$TCAB_PROMPT"

# Run sessions until the implementation marks itself done, or the budget is spent.
while [ ! -f "$marker_file" ]; do
    if [ "$(date +%s)" -ge "$TCAB_DEADLINE" ]; then
        echo "ralph: deadline reached; stopping with partial progress" >&2
        break
    fi
    tcab-session "$protocol"
done

# Always exit successfully: a finished run and a budget-exhausted run alike leave
# their work on disk to be collected and validated.
exit 0
