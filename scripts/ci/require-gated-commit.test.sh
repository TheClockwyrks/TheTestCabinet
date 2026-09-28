#!/usr/bin/env bash
# Table test for scripts/ci/require-gated-commit.sh. `curl` is stubbed on PATH
# and answers from small fixtures shaped like the Azure DevOps REST API's (a
# build list, and timelines whose `Phase` records carry `identifier`, `state`
# and `result`); `date` and `sleep` are stubbed as one clock that only a sleep
# moves. Nothing reaches a network.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT="$here/require-gated-commit.sh"
readonly COMMIT="0123456789abcdef0123456789abcdef01234567"
readonly OTHER="fedcba9876543210fedcba9876543210fedcba98"
readonly TAG="refs/tags/v0.8.0"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

# The stubs. curl answers GETs from $STATE/builds.json and $STATE/timeline-<id>.json, fails a
# GET whose fixture is absent, and answers the POST that queues a run with run 900, recording its
# body. sleep moves the clock by its argument and runs $STATE/on-sleep once if there is one.
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
method=GET data="" url=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		-X) method="$2"; shift 2 ;;
		--data) data="$2"; shift 2 ;;
		-H | --retry) shift 2 ;;
		-*) shift ;;
		*) url="$1"; shift ;;
	esac
done
echo "$method $url" >>"$STATE/requests.log"
case "$method $url" in
	"POST "*/_apis/pipelines/7/runs\?api-version=7.1)
		echo "$data" >"$STATE/queued-body.json"
		echo '{"id": 900}'
		;;
	"GET "*/_apis/build/builds\?definitions=7\&*)
		[[ -f "$STATE/builds.json" ]] || exit 22
		cat "$STATE/builds.json"
		;;
	"GET "*/_apis/build/builds/*/timeline\?api-version=7.1)
		id="${url%/timeline*}"
		id="${id##*/}"
		[[ -f "$STATE/timeline-$id.json" ]] || exit 22
		cat "$STATE/timeline-$id.json"
		;;
	*) echo "unexpected request: $method $url" >&2; exit 22 ;;
esac
EOF
cat >"$work/bin/date" <<'EOF'
#!/usr/bin/env bash
cat "$STATE/clock"
EOF
cat >"$work/bin/sleep" <<'EOF'
#!/usr/bin/env bash
echo $(($(cat "$STATE/clock") + $1)) >"$STATE/clock"
if [[ -x "$STATE/on-sleep" ]]; then
	"$STATE/on-sleep"
	rm -f "$STATE/on-sleep"
fi
EOF
chmod +x "$work/bin/curl" "$work/bin/date" "$work/bin/sleep"

# A build list: each argument is `<id>:<sourceVersion>:<status>`.
builds() {
	local entries=() entry id version status
	for entry in "$@"; do
		IFS=: read -r id version status <<<"$entry"
		entries+=("{\"id\": $id, \"sourceVersion\": \"$version\", \"status\": \"$status\"}")
	done
	local IFS=,
	echo "{\"count\": $#, \"value\": [${entries[*]}]}"
}

# A timeline in which every check job succeeded, then each argument `<identifier>=<state>/<result>`
# overrides one Phase record (a result of `-` is none, as for a job still running).
timeline() {
	local checks=(rust web gg_tests_1_of_4 gg_tests_2_of_4 gg_tests_3_of_4 gg_tests_4_of_4
		rust_build binary_linux binary_windows submodule_pins)
	local -A state=() result=()
	local job override records=()
	for job in "${checks[@]}"; do
		state["gates.$job"]=completed
		result["gates.$job"]=succeeded
	done
	for override in "$@"; do
		state["${override%%=*}"]="$(cut -d/ -f1 <<<"${override#*=}")"
		result["${override%%=*}"]="$(cut -d/ -f2 <<<"${override#*=}")"
	done
	for job in "${!state[@]}"; do
		if [[ "${state[$job]}" == absent ]]; then continue; fi
		if [[ "${result[$job]}" == - ]]; then
			records+=("{\"type\": \"Phase\", \"identifier\": \"$job\", \"state\": \"${state[$job]}\", \"result\": null}")
		else
			records+=("{\"type\": \"Phase\", \"identifier\": \"$job\", \"state\": \"${state[$job]}\", \"result\": \"${result[$job]}\"}")
		fi
		records+=("{\"type\": \"Job\", \"identifier\": \"$job.__default\", \"state\": \"${state[$job]}\", \"result\": null}")
	done
	records+=('{"type": "Stage", "identifier": "gates", "state": "completed", "result": "failed"}')
	local IFS=,
	echo "{\"records\": [${records[*]}]}"
}

case_dir() {
	STATE="$work/$1"
	mkdir -p "$STATE"
	echo 1000 >"$STATE/clock"
	: >"$STATE/requests.log"
	export STATE
}

run() { # sets out and status
	status=0
	out="$(env PATH="$work/bin:$PATH" \
		SYSTEM_ACCESSTOKEN=token \
		SYSTEM_COLLECTIONURI=https://dev.azure.com/example/ \
		SYSTEM_TEAMPROJECT=the-test-cabinet \
		TCAB_MAIN_PIPELINE_ID=7 \
		TCAB_GATE_POLL_SECONDS=60 \
		TCAB_GATE_DEADLINE_SECONDS=180 \
		"$SCRIPT" "$COMMIT" "$TAG" 2>&1)" || status=$?
	[[ -z "${VERBOSE:-}" ]] || printf -- '--- %s status=%s\n%s\n' "$STATE" "$status" "$out" >&2
}

# 1. A run at the commit passed every check: exit 0 naming it. A run at another commit is ignored.
case_dir pass
builds "12:$OTHER:inProgress" "11:$COMMIT:completed" >"$STATE/builds.json"
timeline >"$STATE/timeline-11.json"
run
[[ "$status" -eq 0 ]] || fail "pass: exited $status: $out"
[[ "$out" == *"Run 11 "* ]] || fail "pass: does not name run 11: $out"
! grep -q "builds/12/" "$STATE/requests.log" || fail "pass: read the timeline of a run at another commit"
! grep -q '^POST' "$STATE/requests.log" || fail "pass: queued a run"

# 2. A check job failed: exit 1 naming it, with nothing queued.
case_dir failing
builds "11:$COMMIT:completed" >"$STATE/builds.json"
timeline "gates.rust_build=completed/failed" >"$STATE/timeline-11.json"
run
[[ "$status" -eq 1 ]] || fail "failing: exited $status, wanted 1"
[[ "$out" == *"gates.rust_build (failed)"* ]] || fail "failing: does not name the failed check: $out"
! grep -q '^POST' "$STATE/requests.log" || fail "failing: queued a run"

# 3. Only jobs outside the check set failed (images, the stage, a deploy): the run passes.
case_dir images
builds "11:$COMMIT:completed" >"$STATE/builds.json"
timeline "gates.service_backend_arm64=completed/failed" "gates.runimages_amd64=completed/failed" \
	"prod.deploy_prod=completed/skipped" >"$STATE/timeline-11.json"
run
[[ "$status" -eq 0 ]] || fail "images: exited $status: $out"

# 4. A run still running its checks is waited on, and passes once they do.
case_dir pending
builds "11:$COMMIT:inProgress" >"$STATE/builds.json"
timeline "gates.rust=inProgress/-" "gates.gg_tests_3_of_4=pending/-" >"$STATE/timeline-11.json"
timeline >"$STATE/timeline-11.done.json"
printf '#!/usr/bin/env bash\ncp "%s" "%s"\n' "$STATE/timeline-11.done.json" "$STATE/timeline-11.json" >"$STATE/on-sleep"
chmod +x "$STATE/on-sleep"
run
[[ "$status" -eq 0 ]] || fail "pending: exited $status: $out"
[[ "$out" == *"Waiting on 1 run(s)"* ]] || fail "pending: did not wait: $out"
[[ "$(cat "$STATE/clock")" -eq 1060 ]] || fail "pending: slept $(($(cat "$STATE/clock") - 1000))s, wanted 60"

# 5. No run at the commit: one is queued on the tag ref and waited on.
case_dir norun
builds "12:$OTHER:completed" >"$STATE/builds.json"
timeline >"$STATE/timeline-900.json"
run
[[ "$status" -eq 0 ]] || fail "no run: exited $status: $out"
grep -q '^POST .*/the-test-cabinet/_apis/pipelines/7/runs?api-version=7.1$' "$STATE/requests.log" ||
	fail "no run: queued nothing"
[[ "$(jq -r '.resources.repositories.self.refName' "$STATE/queued-body.json" 2>/dev/null)" == "$TAG" ]] ||
	fail "no run: the queued run is not on the tag ref: $(cat "$STATE/queued-body.json" 2>/dev/null)"
[[ "$out" == *"Run 900 "* ]] || fail "no run: does not name the queued run: $out"

# 6. The deadline: a run that never finishes its checks fails once the clock passes it.
case_dir deadline
builds "11:$COMMIT:inProgress" >"$STATE/builds.json"
timeline "gates.web=inProgress/-" >"$STATE/timeline-11.json"
run
[[ "$status" -eq 1 ]] || fail "deadline: exited $status, wanted 1"
[[ "$out" == *"deadline of 180 seconds"* ]] || fail "deadline: does not name the deadline: $out"
[[ "$(cat "$STATE/clock")" -eq 1180 ]] || fail "deadline: stopped at $(cat "$STATE/clock"), wanted 1180"

# 7. A run that ended without a check job ever running fails, naming it.
case_dir absent
builds "11:$COMMIT:completed" >"$STATE/builds.json"
timeline "gates.submodule_pins=absent/-" >"$STATE/timeline-11.json"
run
[[ "$status" -eq 1 ]] || fail "absent: exited $status, wanted 1"
[[ "$out" == *"gates.submodule_pins (never ran)"* ]] || fail "absent: does not name the missing check: $out"

# 8. A listing the token may not read is fatal, and queues nothing.
case_dir forbidden
run
[[ "$status" -eq 1 ]] || fail "forbidden: exited $status, wanted 1"
! grep -q '^POST' "$STATE/requests.log" || fail "forbidden: queued a run"

# 9. Arguments and environment.
status=0
"$SCRIPT" "$COMMIT" >/dev/null 2>&1 || status=$?
[[ "$status" -eq 2 ]] || fail "usage: one argument exited $status, wanted 2"
status=0
env -u SYSTEM_ACCESSTOKEN "$SCRIPT" "$COMMIT" "$TAG" >/dev/null 2>&1 || status=$?
[[ "$status" -eq 2 ]] || fail "usage: no token exited $status, wanted 2"

if [[ "$failures" -ne 0 ]]; then
	echo "require-gated-commit.test.sh: $failures failure(s)" >&2
	exit 1
fi
echo "require-gated-commit.test.sh: all cases passed"
