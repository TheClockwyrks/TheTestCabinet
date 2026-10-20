#!/usr/bin/env bash
# Table test for configure-node-pools.sh. Run it directly:
# ./configure-node-pools.test.sh
#
# Each case runs the script from a throwaway copy of the scripts with a stub `az`
# on PATH, which records each invocation's arguments (one line per call, one
# argument per tab-separated field) and answers `aks nodepool list` with the pool
# table the case chose, so the subject is which pools the script selects and the
# exact `az` calls it makes for each environment.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label want got
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "want: $2" "got:  $3"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A copy of the scripts the way they sit in the repository, plus the stub az.
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/lib" "$repo/bin"
	cp "$SCRIPTS_DIR/configure-node-pools.sh" "$repo/scripts/"
	cp "$SCRIPTS_DIR/lib/env.sh" "$repo/scripts/lib/"
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
# Stub az: log the arguments tab-separated, answer `aks nodepool list` with the
# chosen pool table and `aks nodepool show` with an empty object.
(IFS=$'\t'; printf '%s\n' "$*") >>"$STUB_LOG"
case "$1 $2 $3" in
"aks nodepool list") [ -n "${STUB_POOLS:-}" ] && cat "$STUB_POOLS" ;;
"aks nodepool show") echo '{}' ;;
esac
exit 0
STUB
	chmod +x "$repo/bin/az"
	echo "$repo"
}

run() { # repo pools-file -- args...
	local repo="$1" pools="$2"
	shift 3
	(cd / && PATH="$repo/bin:$PATH" STUB_LOG="$repo/az.log" STUB_POOLS="$pools" \
		"$repo/scripts/configure-node-pools.sh" "$@" 2>&1)
}

# The calls the script makes for one pool, tab-separated as the stub logs them.
T=$'\t'
update_call() { # rg cluster pool
	printf 'aks%snodepool%supdate%s-g%s%s%s--cluster-name%s%s%s-n%s%s%s--drain-timeout%s1440%s--undrainable-node-behavior%sSchedule%s--max-surge%s10%%%s--max-unavailable%s0%s-o%snone' \
		"$T" "$T" "$T" "$T" "$1" "$T" "$T" "$2" "$T" "$T" "$3" "$T" "$T" "$T" "$T" "$T" "$T" "$T" "$T" "$T" "$T"
}
show_call() { # rg cluster pool
	printf 'aks%snodepool%sshow%s-g%s%s%s--cluster-name%s%s%s-n%s%s%s--query%supgradeSettings%s-o%sjsonc' \
		"$T" "$T" "$T" "$T" "$1" "$T" "$T" "$2" "$T" "$T" "$3" "$T" "$T" "$T" "$T"
}
list_call() { # rg cluster
	printf 'aks%snodepool%slist%s-g%s%s%s--cluster-name%s%s%s--query%s%s%s-o%stsv' \
		"$T" "$T" "$T" "$T" "$1" "$T" "$T" "$2" "$T" "$T" "[].[name, mode, join(',', nodeTaints || \`[]\`)]" "$T" "$T"
}

# Pool tables in `-o tsv` form: name, mode, taints joined by commas.
printf 'agentpool\tSystem\t\nuserpool2\tUser\t\n' >"$tmp/staging.tsv"
printf 'agentpool\tSystem\t\nuserpool3\tUser\t\n' >"$tmp/prod.tsv"
printf 'system\tSystem\tCriticalAddonsOnly=true:NoSchedule\nquiet\tSystem\tdedicated=infra:NoExecute,x=y:PreferNoSchedule\nsoft\tSystem\tx=y:PreferNoSchedule\nuser\tUser\tgpu=true:NoSchedule\n' >"$tmp/mixed.tsv"
printf 'system\tSystem\tCriticalAddonsOnly=true:NoSchedule\n' >"$tmp/none.tsv"
: >"$tmp/empty.tsv"

echo "--- staging: both pools of the staging cluster ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/staging.tsv" -- --env staging)"
status=$?
check_equal "passes" 0 "$status"
RG=testcabinet-staging-westus2-rg
CL=testcabinet-staging-westus2-aks
want="$(list_call $RG $CL)
$(update_call $RG $CL agentpool)
$(show_call $RG $CL agentpool)
$(update_call $RG $CL userpool2)
$(show_call $RG $CL userpool2)"
check_equal "lists the pools, then updates and shows each" "$want" "$(cat "$repo/az.log")"
check_contains "reports the count" "2 node pool(s) of $CL" "$out"

echo "--- staging: a re-run makes the same calls ---"

first="$(cat "$repo/az.log")"
: >"$repo/az.log"
run "$repo" "$tmp/staging.tsv" -- --env=staging >/dev/null
status=$?
check_equal "passes" 0 "$status"
check_equal "same calls (--env=staging form)" "$first" "$(cat "$repo/az.log")"

echo "--- prod: both pools of the prod cluster ---"

repo="$(fresh_repo)"
run "$repo" "$tmp/prod.tsv" -- --env prod >/dev/null
status=$?
check_equal "passes" 0 "$status"
RG=testcabinet-prod-westus2-rg
CL=testcabinet-prod-westus2-aks
want="$(list_call $RG $CL)
$(update_call $RG $CL agentpool)
$(show_call $RG $CL agentpool)
$(update_call $RG $CL userpool3)
$(show_call $RG $CL userpool3)"
check_equal "lists the pools, then updates and shows each" "$want" "$(cat "$repo/az.log")"

echo "--- pool selection: tainted System pools are skipped ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/mixed.tsv" -- --env staging)"
status=$?
check_equal "passes" 0 "$status"
updated="$(grep -F "update${T}" "$repo/az.log" | awk -F'\t' '{print $9}' | paste -sd ' ')"
check_equal "updates the PreferNoSchedule System pool and every User pool" "soft user" "$updated"
check_contains "says it skips the NoSchedule System pool" "skipping system" "$out"
check_contains "says it skips the NoExecute System pool" "skipping quiet" "$out"

echo "--- no pool can seat a run pod ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/none.tsv" -- --env staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "says there is no pool" "has no node pool that can seat a run pod" "$out"
check_equal "updates nothing" "" "$(grep -F "update${T}" "$repo/az.log")"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/empty.tsv" -- --env staging)"
status=$?
check_equal "fails on an empty pool list" 1 "$status"

echo "--- no environment ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/staging.tsv" --)"
status=$?
check_equal "refuses to start" 2 "$status"
check_contains "asks for --env" "--env is required" "$out"
check_equal "calls no az" "" "$(cat "$repo/az.log" 2>/dev/null)"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/staging.tsv" -- --env)"
status=$?
check_equal "refuses a bare --env" 2 "$status"
check_equal "calls no az" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- an unknown environment or argument ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/staging.tsv" -- --env dev)"
status=$?
check_equal "refuses an unknown env" 2 "$status"
check_contains "names it" "unknown --env 'dev'" "$out"
check_equal "calls no az" "" "$(cat "$repo/az.log" 2>/dev/null)"

repo="$(fresh_repo)"
out="$(run "$repo" "$tmp/staging.tsv" -- --env staging --force)"
status=$?
check_equal "refuses an unknown argument" 2 "$status"
check_contains "names it" "unknown argument: --force" "$out"
check_equal "calls no az" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "configure-node-pools.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
