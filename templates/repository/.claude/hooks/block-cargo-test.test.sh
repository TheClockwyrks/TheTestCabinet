#!/usr/bin/env bash
# Table test for block-cargo-test.sh. Run it directly: ./block-cargo-test.test.sh
#
# Each case feeds the hook a PreToolUse payload and asserts allow vs deny. The
# hook denies `cargo test` as a subcommand and nothing else: `cargo nextest` is
# the sanctioned runner, and `cargo test --doc` is the one `cargo test` nextest
# cannot replace.
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/block-cargo-test.sh"
pass=0; fail=0

check() { # expected(deny|allow) command
	local expected="$1" cmd="$2"
	local out verdict
	out="$(jq -n --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}' | "$HOOK")"
	if [[ -n "$out" ]] && printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
		verdict=deny
	else
		verdict=allow
	fi
	if [[ "$verdict" == "$expected" ]]; then
		pass=$((pass+1)); printf '  ok   [%s] %s\n' "$verdict" "$cmd"
	else
		fail=$((fail+1)); printf 'FAIL  expected=%s got=%s %s\n' "$expected" "$verdict" "$cmd"
	fi
}

echo "--- must DENY: cargo test as a subcommand ---"
check deny 'cargo test'
check deny 'cargo test --workspace'
check deny 'cargo test -p test-cabinet-core'
check deny 'cargo +nightly test'
check deny 'cargo +stable test --workspace'
check deny 'cd crates/core && cargo test'
check deny 'cargo build && cargo test'
check deny 'RUST_LOG=debug cargo test'
check deny '  cargo   test  '
check deny 'cargo test -- --nocapture'
check deny 'cargo test --workspace --lib'
check deny 'cargo test --doctest'

echo "--- must ALLOW: the doctest exception ---"
check allow 'cargo test --workspace --doc'
check allow 'cargo test --doc'
check allow 'cargo test -p test-cabinet-core --doc'
check allow 'cargo +nightly test --doc'
check allow 'cargo test --doc=true'

echo "--- must ALLOW: nextest and everything else ---"
check allow 'cargo nextest run --workspace'
check allow 'cargo nextest run -p test-cabinet-core'
check allow 'cargo build'
check allow 'cargo clippy --all-targets'
check allow 'cargo testament'
check allow 'mycargo test'
check allow 'echo "cargo test"'
check allow 'npm test'
check allow 'uv run --quiet --project ci gate run rust-test'
check allow ''

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
