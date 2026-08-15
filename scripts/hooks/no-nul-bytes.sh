#!/usr/bin/env bash
# Fast pre-commit gate: refuse a NUL byte in a file that is not a declared
# binary format.
#
# A raw NUL makes every tool that reads text decide the file is binary. `grep`
# and `rg` then report ZERO matches in it rather than an error, so such a file is
# not merely awkward to search — it is silently invisible to every search anyone
# runs. That is how this gate came to exist. `packages/gg-sandbox-purescript/`
# `tools/signatures.mjs` carried one NUL, written as a separator inside a string
# literal, and a live code path in it went unseen through a sweep looking
# directly for it.
#
# # Why this asks .gitattributes and not git's own opinion
#
# The obvious implementation — skip whatever `git diff --numstat` calls binary —
# does not work, and its first draft here passed a planted NUL cleanly. Git
# infers binary FROM a NUL byte, so under that rule "binary" and "contains a
# NUL" are the same question and every file this gate exists to catch excuses
# itself. The discriminator has to be a DECLARATION, which is why the binary
# formats this repository commits are named in .gitattributes. A format that is
# genuinely binary belongs there; a file that wants a NUL and is not one of those
# formats wants an escape instead.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand,
# where it takes paths as arguments, or checks everything staged when given none.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ "$#" -gt 0 ]; then
	files=("$@")
else
	mapfile -t files < <(git diff --cached --name-only --diff-filter=ACM)
fi

[ "${#files[@]}" -eq 0 ] && exit 0

found=0
for file in "${files[@]}"; do
	[ -f "$file" ] || continue

	# A declared binary format is a format, not a defect. `check-attr` reports
	# `binary: set` for a path matched by a `binary` line in .gitattributes.
	if git check-attr binary -- "$file" 2>/dev/null | grep -q ': binary: set$'; then
		continue
	fi

	# Byte counts with and without NULs. Comparing them is portable where matching
	# on a NUL is not.
	total=$(LC_ALL=C wc -c <"$file" | tr -d ' ')
	without=$(LC_ALL=C tr -d '\000' <"$file" | LC_ALL=C wc -c | tr -d ' ')
	if [ "$total" -ne "$without" ]; then
		printf '%s: %s NUL byte(s), and its format is not declared binary\n' \
			"$file" "$((total - without))" >&2
		found=1
	fi
done

if [ "$found" -ne 0 ]; then
	cat >&2 <<'MESSAGE'

A NUL byte in a text file makes grep and rg report zero matches in it rather
than an error, so its contents stop being findable by any search at all.

If the byte is meant — a separator, a sentinel, a fixture — write it as the
escape your language spells it with rather than as the byte itself. It is the
same character at run time and ordinary text on disk.

If the file is a binary format this repository commits on purpose, declare it
in .gitattributes with a `binary` line, which is also what stops git trying to
diff and merge it as text.
MESSAGE
	exit 1
fi
