#!/bin/sh
# One-shot orchestrator runner.
#
# Runs a single harness session against the test case's goal. The runner
# environment carries the goal as $TCAB_PROMPT (see the runner environment
# contract in orchestrators/README.md); `tcab-session` runs the selected
# harness's CLI with that prompt, whatever the harness is.
exec tcab-session "$TCAB_PROMPT"
