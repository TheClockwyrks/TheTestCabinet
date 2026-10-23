#!/usr/bin/env bash
# Table test for the catalog ingest sidecar, the `ingest` container the staging and
# prod overlays add to the backend's pod (overlays/<env>/patch-backend-ingest.yaml).
# Run it directly: ./catalog-ingest-sidecar.test.sh
#
# The sidecar is a shell script held in the patch's `args`. Each case takes that
# script out of the overlay's file as kubectl would hand it to `sh -c`, moves its
# absolute paths (the state volume, /tmp, /run, /srv, /usr/local/bin, the token
# mount) under a throwaway pod directory, and runs it with stubs first on PATH:
# apk succeeds, git answers each step as the case declares, curl records each
# request and answers as the case declares, flock runs its command, sleep returns
# at once, and httpd records its arguments and returns, which ends the run.
#
# The subject is the contract scripts/ci/catalog-ingest.sh verify reads: the
# startup run records its outcome in /tmp/ingest-result, a refresh that fails
# ingests nothing and records the step, a failed test suites update alone still
# ingests, and an ingest that never lands is recorded as failed with the command
# that retries it. The refresh endpoint's CGI is checked beside it: POST only, and
# its answer follows the refresh's exit code.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly OVERLAYS="${CI_DIR}/../../deployments/k8s/overlays"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected output without: $2" "got: $3"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The `ingest` container's script: the block scalar after `args:` `- |`, with the
# block's indentation removed, up to the first line indented less than the block.
sidecar_script() { # patch file
	awk '
		/^ *- name: ingest$/ { in_container = 1 }
		in_container && /^ *args:$/ { want_block = 1; next }
		want_block && /^ *- \|$/ { want_block = 0; in_block = 1; indent = -1; next }
		in_block {
			if ($0 ~ /^ *$/) { print ""; next }
			match($0, /^ */)
			if (indent < 0) indent = RLENGTH
			if (RLENGTH < indent) exit
			print substr($0, indent + 1)
		}
	' "$1"
}

# A pod: its directories, the sidecar's script with its paths moved into them, and
# the stubs. Prints the pod's directory.
fresh_pod() { # env
	local pod
	pod="$(mktemp -d "$tmp/podXXXXXX")"
	mkdir -p "$pod/stubs" "$pod/usr/local/bin" "$pod/srv" "$pod/tmp" "$pod/run" \
		"$pod/state" "$pod/secrets" "$pod/proc"
	printf 'token\n' >"$pod/secrets/token"
	# /tmp first: the pod's own directory lies under /tmp, and no later expression
	# matches what an earlier one wrote.
	sidecar_script "$OVERLAYS/$1/patch-backend-ingest.yaml" | sed \
		-e "s#/tmp/#$pod/tmp/#g" \
		-e "s#/usr/local/bin/#$pod/usr/local/bin/#g" \
		-e "s#/srv/refresh#$pod/srv/refresh#g" \
		-e "s#/run/tcab-refresh.lock#$pod/run/tcab-refresh.lock#g" \
		-e "s#/var/run/secrets/test-suites#$pod/secrets#g" \
		-e "s#/state/checkout#$pod/state/checkout#g" \
		-e "s#/proc/1/fd/1#$pod/proc/pid1#g" \
		>"$pod/sidecar.sh"

	cat >"$pod/stubs/apk" <<'EOF'
#!/bin/sh
exit 0
EOF
	# git: `config --global` writes the pod's own file; a clone or fetch makes the
	# checkout a repository; `rev-parse HEAD` names one commit. A step the case lists
	# in STUB_GIT_FAIL (clone, fetch, sync, cold-storage, test-suites) fails.
	cat >"$pod/stubs/git" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$STUB_LOG/git.log"
fails() { case " $STUB_GIT_FAIL " in *" $1 "*) return 0 ;; esac; return 1; }
dir=
if [ "$1" = -C ]; then dir=$2; shift 2; fi
case "$1" in
	config) exit 0 ;;
	clone)
		fails clone && { echo "fatal: clone refused" >&2; exit 128; }
		for last; do :; done
		mkdir -p "$last/.git"; exit 0 ;;
	fetch) fails fetch && { echo "fatal: fetch refused" >&2; exit 128; }; exit 0 ;;
	reset) exit 0 ;;
	rev-parse) [ -d "$dir/.git" ] && echo 1111111111111111111111111111111111111111; exit 0 ;;
	submodule)
		case "$2" in
			sync) fails sync && exit 1; exit 0 ;;
			status) exit 0 ;;
			update)
				for last; do :; done
				fails "$last" && { echo "fatal: $last refused" >&2; exit 1; }
				exit 0 ;;
		esac ;;
esac
exit 0
EOF
	# curl: /healthz answers at once; POST /ingest fails the first STUB_INGEST_FAILS
	# times (all, when it is `always`).
	cat >"$pod/stubs/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$STUB_LOG/curl.log"
case "$*" in
	*/ingest*)
		n=$(($(cat "$STUB_LOG/ingest.count" 2>/dev/null || echo 0) + 1))
		echo "$n" >"$STUB_LOG/ingest.count"
		[ "$STUB_INGEST_FAILS" = always ] && exit 22
		[ "$n" -le "$STUB_INGEST_FAILS" ] && exit 22
		exit 0 ;;
esac
exit 0
EOF
	cat >"$pod/stubs/flock" <<'EOF'
#!/bin/sh
shift
exec "$@"
EOF
	cat >"$pod/stubs/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
	cat >"$pod/stubs/httpd" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$STUB_LOG/httpd.log"
exit 0
EOF
	chmod +x "$pod/stubs/"*
	printf '%s\n' "$pod"
}

# Run the pod's sidecar: STUB_GIT_FAIL and STUB_INGEST_FAILS from the caller.
run_sidecar() { # pod
	env PATH="$1/stubs:$PATH" STUB_LOG="$1" STUB_GIT_FAIL="${STUB_GIT_FAIL:-}" \
		STUB_INGEST_FAILS="${STUB_INGEST_FAILS:-0}" TCAB_BACKEND_SERVICE_TOKEN=svc-token \
		GIT_CONFIG_GLOBAL="$1/gitconfig" HOME="$1" \
		sh -c "$(cat "$1/sidecar.sh")" 2>&1
}

result() { cat "$1/tmp/ingest-result" 2>/dev/null; }
posts() { # pod: how many POST /ingest requests reached the backend
	if [ -f "$1/curl.log" ]; then grep -c -- '/ingest' "$1/curl.log"; else echo 0; fi
}

for env in staging prod; do
	case "$env" in
		staging) branch=staging ;;
		prod) branch=master ;;
	esac

	echo "--- $env: the script is found ---"
	script="$(sidecar_script "$OVERLAYS/$env/patch-backend-ingest.yaml")"
	check_contains "names its branch" "BRANCH=$branch" "$script"
	check_contains "records its result" "RESULT=/tmp/ingest-result" "$script"

	echo "--- $env: a refresh and an ingest that both land ---"
	pod="$(fresh_pod "$env")"
	out="$(run_sidecar "$pod")"
	check_equal "records ok after the ingest" \
		"$(printf 'status=ok\nstep=ingest\nbranch=%s\ncommit=1111111111111111111111111111111111111111' "$branch")" \
		"$(result "$pod")"
	check_equal "posts one forced ingest" "1" "$(posts "$pod")"
	check_contains "presents the service token" "authorization: Bearer svc-token" "$(cat "$pod/curl.log")"
	check_contains "asks for a forced ingest" '{"force": true}' "$(cat "$pod/curl.log")"
	check_contains "waits on liveness, not readiness" "/healthz" "$(cat "$pod/curl.log")"
	check_lacks "never waits on readiness" "/readyz" "$(cat "$pod/curl.log")"
	check_contains "clones the branch" "--branch $branch" "$(cat "$pod/git.log")"
	check_contains "serves the refresh endpoint on localhost" "-p 127.0.0.1:8788" "$(cat "$pod/httpd.log")"
	check_contains "says it triggered" "ingest: triggered ok" "$out"

	echo "--- $env: a clone that fails ---"
	pod="$(fresh_pod "$env")"
	out="$(STUB_GIT_FAIL=clone run_sidecar "$pod")"
	check_contains "records the refresh as failed" \
		"$(printf 'status=failed\nstep=refresh\nbranch=%s' "$branch")" "$(result "$pod")"
	check_contains "keeps the cause in the result" "ingest: clone failed" "$(result "$pod")"
	check_equal "posts no ingest" "0" "$(posts "$pod")"
	check_contains "says nothing was ingested" "nothing was ingested" "$out"
	check_contains "still serves the refresh endpoint" "-p 127.0.0.1:8788" "$(cat "$pod/httpd.log")"

	echo "--- $env: a cold-storage update that fails ---"
	pod="$(fresh_pod "$env")"
	STUB_GIT_FAIL=cold-storage run_sidecar "$pod" >/dev/null
	check_contains "records the refresh as failed" "status=failed" "$(result "$pod")"
	check_contains "names the step" "ingest: cold-storage update failed" "$(result "$pod")"
	check_equal "posts no ingest" "0" "$(posts "$pod")"

	echo "--- $env: a submodule sync that fails ---"
	pod="$(fresh_pod "$env")"
	STUB_GIT_FAIL=sync run_sidecar "$pod" >/dev/null
	check_contains "records the refresh as failed" "status=failed" "$(result "$pod")"
	check_equal "posts no ingest" "0" "$(posts "$pod")"

	echo "--- $env: only the test suites update fails ---"
	pod="$(fresh_pod "$env")"
	out="$(STUB_GIT_FAIL=test-suites run_sidecar "$pod")"
	check_contains "still ingests and records ok" "status=ok" "$(result "$pod")"
	check_equal "posts one ingest" "1" "$(posts "$pod")"
	check_contains "says it ingests without them" "ingesting without them" "$out"

	echo "--- $env: a checkout that survived on the volume ---"
	pod="$(fresh_pod "$env")"
	mkdir -p "$pod/state/checkout/.git"
	STUB_GIT_FAIL=fetch run_sidecar "$pod" >/dev/null
	check_lacks "refreshes it rather than cloning" "clone" "$(cat "$pod/git.log")"
	check_contains "records the failed refresh" "ingest: refresh failed" "$(result "$pod")"
	check_equal "posts no ingest" "0" "$(posts "$pod")"

	echo "--- $env: an ingest that never lands ---"
	pod="$(fresh_pod "$env")"
	STUB_INGEST_FAILS=always run_sidecar "$pod" >/dev/null
	check_equal "gives up after ten posts" "10" "$(posts "$pod")"
	check_equal "records the ingest as failed with its retry" \
		"$(printf 'status=failed\nstep=ingest\nbranch=%s\ncommit=1111111111111111111111111111111111111111\n\nPOST /ingest failed 10 times; run tcab ingest --env %s' "$branch" "$env")" \
		"$(result "$pod")"

	echo "--- $env: an ingest that lands on its third post ---"
	pod="$(fresh_pod "$env")"
	STUB_INGEST_FAILS=2 run_sidecar "$pod" >/dev/null
	check_equal "posts until it lands" "3" "$(posts "$pod")"
	check_contains "records ok" "status=ok" "$(result "$pod")"

	echo "--- $env: the refresh endpoint ---"
	cgi="$pod/srv/refresh/cgi-bin/refresh"
	for answer in "0:200 OK:{\"suitesUpdated\":true}" "3:200 OK:{\"suitesUpdated\":false}" \
		"1:500 Internal Server Error:refresh output"; do
		code="${answer%%:*}"
		rest="${answer#*:}"
		printf '#!/bin/sh\necho refresh output\nexit %s\n' "$code" >"$pod/usr/local/bin/tcab-refresh"
		out="$(env PATH="$pod/stubs:$PATH" REQUEST_METHOD=POST "$cgi")"
		check_contains "a refresh exiting $code answers ${rest%%:*}" "Status: ${rest%%:*}" "$out"
		check_contains "a refresh exiting $code says ${rest#*:}" "${rest#*:}" "$out"
	done
	out="$(env PATH="$pod/stubs:$PATH" REQUEST_METHOD=GET "$cgi")"
	check_contains "refuses a GET" "Status: 405" "$out"
done

echo
echo "catalog-ingest-sidecar.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
