#!/usr/bin/env bash
# Waits until a run of the main pipeline at <commit> has passed its check jobs,
# and fails when one of them failed: the first job of the release pipeline
# (azure-pipelines-release.yml), so a tag releases only a commit the gates
# passed.
#
#   scripts/ci/require-gated-commit.sh <commit> <source-ref>
#
# <commit> is the tagged commit (`Build.SourceVersion`) and <source-ref> the tag
# (`Build.SourceBranch`, `refs/tags/v<version>`). The environment names the rest:
#
#   SYSTEM_ACCESSTOKEN      the release run's job token, which may view and queue
#                           runs of the main pipeline
#   SYSTEM_COLLECTIONURI    the organisation's URL, and
#   SYSTEM_TEAMPROJECT      the project's name, both set by Azure on every step
#   TCAB_MAIN_PIPELINE_ID   the main pipeline's definition id, which the release
#                           pipeline reads from its `main` pipeline resource
#
# WHICH RUNS COUNT. Any run of the main pipeline whose `sourceVersion` is
# <commit>, on any branch: a tag is cut from a commit that master, staging or
# nightly already ran. The newest 200 runs are searched.
#
# WHAT A PASS IS. Every check job, read from the run's timeline as the `Phase`
# record whose identifier is `<stage>.<job>`, is completed and succeeded or
# succeededWithIssues. The check jobs are the template's `rust` and `web` and the
# project's gg test partitions, `rust_build`, both binary jobs and
# `submodule_pins`. The run as a whole is not waited on: its image jobs, the
# publish and deploy stages, `prod`, `gg_release` and `docs` never gate a
# release, exactly as the gates stage alone gated a tag before.
#
# NO RUN AT ALL. The main pipeline's trigger batches pushes, so a tagged commit
# may have been superseded before a run reached it. Then this queues one on the
# tag ref and waits on it. On a tag ref every branch-conditional job and every
# later stage skips, so that run is the gates stage alone.
#
# A FAILED RUN is final: it is not queued again, and this exits 1 naming the
# check that failed. Re-run the failed jobs of that run, then re-run this job.
#
# It polls every TCAB_GATE_POLL_SECONDS (60) for up to TCAB_GATE_DEADLINE_SECONDS
# (12000, the check jobs' longest timeout of 150 minutes plus queueing), and
# exits 1 naming the deadline when it passes.
set -euo pipefail

usage() {
	echo "usage: scripts/ci/require-gated-commit.sh <commit> <source-ref>" >&2
	exit 2
}
[[ $# -eq 2 ]] || usage
readonly COMMIT="$1" SOURCE_REF="$2"

for name in SYSTEM_ACCESSTOKEN SYSTEM_COLLECTIONURI SYSTEM_TEAMPROJECT TCAB_MAIN_PIPELINE_ID; do
	if [[ -z "${!name:-}" ]]; then
		echo "$name is not set; the release pipeline's gated job passes it." >&2
		exit 2
	fi
done

readonly POLL="${TCAB_GATE_POLL_SECONDS:-60}"
readonly DEADLINE_SECONDS="${TCAB_GATE_DEADLINE_SECONDS:-12000}"
readonly API="${SYSTEM_COLLECTIONURI%/}/${SYSTEM_TEAMPROJECT}/_apis"
readonly PIPELINE="$TCAB_MAIN_PIPELINE_ID"

# The main pipeline's check jobs, as the timeline identifies them.
readonly CHECKS=(
	gates.rust
	gates.web
	gates.gg_tests_1_of_4
	gates.gg_tests_2_of_4
	gates.gg_tests_3_of_4
	gates.gg_tests_4_of_4
	gates.rust_build
	gates.binary_linux
	gates.binary_windows
	gates.submodule_pins
)

api() { # method url [body]
	local method="$1" url="$2"
	local args=(-fsS --retry 3 -X "$method" -H "Authorization: Bearer ${SYSTEM_ACCESSTOKEN}")
	if [[ $# -ge 3 ]]; then
		args+=(-H "Content-Type: application/json" --data "$3")
	fi
	curl "${args[@]}" "$url"
}

# The ids of the main pipeline's runs at the commit, newest first, each with its status.
runs_at_commit() {
	api GET "${API}/build/builds?definitions=${PIPELINE}&queryOrder=queueTimeDescending&\$top=200&api-version=7.1" |
		jq -r --arg commit "$COMMIT" '.value[] | select(.sourceVersion == $commit) | "\(.id) \(.status)"'
}

# Reads one run's timeline and prints its verdict on the check jobs:
#   pass              every check completed and passed
#   fail <check> ...  a check completed and did not pass, or the run ended without one
#   wait              otherwise
verdict() { # id status
	local id="$1" status="$2" timeline
	if ! timeline="$(api GET "${API}/build/builds/${id}/timeline?api-version=7.1")"; then
		echo wait
		return
	fi
	jq -r --arg status "$status" --args '
		($ARGS.positional) as $checks
		| [.records[]? | select(.type == "Phase")] as $phases
		| [$checks[] as $c
			| ($phases | map(select(.identifier == $c)) | first) as $p
			| if $p == null then {check: $c, state: "missing", result: ""}
			  else {check: $c, state: ($p.state // ""), result: ($p.result // "")} end] as $rows
		| ($rows | map(select(.state == "completed" and (.result == "succeeded" or .result == "succeededWithIssues") | not))) as $open
		| ($open | map(select(.state == "completed"))) as $failed
		| if ($open | length) == 0 then "pass"
		  elif ($failed | length) > 0 then "fail " + ($failed | map("\(.check) (\(.result))") | join(" "))
		  elif $status == "completed" then "fail " + ($open | map("\(.check) (never ran)") | join(" "))
		  else "wait" end
	' "${CHECKS[@]}" <<<"$timeline"
}

start="$(date +%s)"
queued=""
while :; do
	if ! listing="$(runs_at_commit)"; then
		echo "Listing the runs of pipeline ${PIPELINE} failed; the job token may not view them." >&2
		exit 1
	fi
	runs=()
	[[ -z "$listing" ]] || mapfile -t runs <<<"$listing"

	# A run this job queued may not be listed yet.
	if [[ -n "$queued" ]] && ! printf '%s\n' "${runs[@]}" | grep -q "^${queued} "; then
		runs+=("$queued notStarted")
	fi

	if [[ ${#runs[@]} -eq 0 ]]; then
		echo "No run of pipeline ${PIPELINE} is at ${COMMIT}; queueing one on ${SOURCE_REF}."
		body="$(jq -cn --arg ref "$SOURCE_REF" '{resources: {repositories: {self: {refName: $ref}}}}')"
		queued="$(api POST "${API}/pipelines/${PIPELINE}/runs?api-version=7.1" "$body" | jq -r '.id')"
		if [[ -z "$queued" || "$queued" == null ]]; then
			echo "Queueing a run of pipeline ${PIPELINE} on ${SOURCE_REF} answered no run id." >&2
			exit 1
		fi
		echo "Queued run ${queued}."
		runs=("$queued notStarted")
	fi

	failures=()
	waiting=0
	for entry in "${runs[@]}"; do
		read -r id status <<<"$entry"
		result="$(verdict "$id" "$status")"
		case "$result" in
			pass)
				echo "Run ${id} of pipeline ${PIPELINE} passed every check job at ${COMMIT}."
				exit 0
				;;
			fail*) failures+=("run ${id}: ${result#fail }") ;;
			*) waiting=$((waiting + 1)) ;;
		esac
	done

	if [[ "$waiting" -eq 0 ]]; then
		echo "No run at ${COMMIT} passed its check jobs:" >&2
		printf '  %s\n' "${failures[@]}" >&2
		echo "Re-run the failed jobs of that run, then re-run this job." >&2
		exit 1
	fi

	if (($(date +%s) - start >= DEADLINE_SECONDS)); then
		echo "The deadline of ${DEADLINE_SECONDS} seconds passed with ${waiting} run(s) at ${COMMIT} still running their check jobs." >&2
		exit 1
	fi
	echo "Waiting on ${waiting} run(s) at ${COMMIT}."
	sleep "$POLL"
done
