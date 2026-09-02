# Classifies every module reference in one validator-project source file.
#
# Driven by scripts/ci/validator-constants.sh, one invocation per candidate
# file. The shell decides WHICH files to look at and WHAT the verdict means;
# this program does the one thing a line-by-line `grep` cannot, which is read a
# statement that spans lines and say what FORM it is. `export * from` and
# `export { A, B } from` name the same module on the same specifier, and only
# one of them is allowed — so the gate has to parse rather than match.
#
# Variables the caller sets:
#   depth  how many directories below the project root the file sits in. A
#          specifier climbing more `../` than that leaves the project, and a
#          run stages `validation/<engine>/` alone, so anything outside it is
#          absent when the suites actually run.
#   role   `constants` (the project's own transcription of the case's figures),
#          `harness` (the one module that loads the build to drive it), or
#          `other` (everything else, which may not reach the build at all).
#
# Output, one record per finding, tab-separated: CODE, line, detail. The codes
# are read by the shell:
#   OUTSIDE  a reference that leaves the project without landing in the build —
#            it resolves to nothing once the project is staged.
#   ESCAPE   a build reference from a file with no allowance for one.
#   MODULE   a build reference from an exempt file, to a module that file may
#            not read.
#   FORM     a build reference that is not a plain named clause: `export *`, a
#            namespace or default binding, a bare side-effect import, a dynamic
#            `import()`, a `require()`, or anything else this program cannot
#            positively recognize. Unrecognized is a finding, not a pass.
#   NAMES    informational: the names an allowed clause carries across the
#            boundary, which is what makes "one import site" countable.

# Accumulate the whole file: a statement is not a line.
{ buf = buf $0 "\n" }

END {
	clean = strip_comments(buf)
	scan(clean)
}

# Blanks out comments while preserving every newline, so a line number computed
# over the result is the line number in the file. String and template literals
# are copied through untouched — a `//` inside a quoted path is not a comment.
function strip_comments(s,   n, i, c, d, out, state) {
	n = length(s)
	i = 1
	state = 0 # 0 code, 1 line comment, 2 block comment, 3 "…", 4 '…', 5 `…`
	while (i <= n) {
		c = substr(s, i, 1)
		d = substr(s, i + 1, 1)
		if (state == 0) {
			if (c == "/" && d == "/") { state = 1; out = out "  "; i += 2; continue }
			if (c == "/" && d == "*") { state = 2; out = out "  "; i += 2; continue }
			if (c == "\"") state = 3
			else if (c == "'") state = 4
			else if (c == "`") state = 5
			out = out c
			i += 1
			continue
		}
		if (state == 1) {
			if (c == "\n") { state = 0; out = out "\n" } else out = out " "
			i += 1
			continue
		}
		if (state == 2) {
			if (c == "*" && d == "/") { state = 0; out = out "  "; i += 2; continue }
			out = out (c == "\n" ? "\n" : " ")
			i += 1
			continue
		}
		# Inside a literal. A backslash escapes whatever follows it, including
		# the closing quote.
		if (c == "\\") { out = out c d; i += 2; continue }
		if ((state == 3 && c == "\"") || (state == 4 && c == "'") || (state == 5 && c == "`")) state = 0
		out = out c
		i += 1
	}
	return out
}

# Walks every quoted literal in the cleaned text. Only the ones that climb with
# `../` are of interest: a bare package name and a `./sibling` both stay where
# the staged project can still resolve them.
function scan(s,   pos, line, rest, at, len, lit, spec, head, before) {
	pos = 1
	line = 1
	rest = s
	while (match(rest, /"[^"]*"|'[^']*'|`[^`]*`/)) {
		# judge() runs its own match()es, which clobber RSTART/RLENGTH; take a
		# copy of both before anything downstream can move them.
		at = RSTART
		len = RLENGTH
		before = substr(rest, 1, at - 1)
		line += gsub(/\n/, "\n", before)
		lit = substr(rest, at, len)
		spec = substr(lit, 2, length(lit) - 2)
		head = substr(s, 1, pos + at - 2)
		if (spec ~ /^(\.\.\/)+/) judge(spec, line, head)
		line += gsub(/\n/, "\n", lit)
		pos += at + len - 1
		rest = substr(rest, at + len)
	}
}

# The number of directories a specifier climbs.
function climbs(spec,   c, t) {
	t = spec
	c = gsub(/\.\.\//, "", t)
	return c
}

function judge(spec, line, head,   escapes, into_build, form, names) {
	escapes = (climbs(spec) > depth)
	into_build = (spec ~ /^(\.\.\/)+src(\/|$)/)

	# A reference that stays inside the project is the ordinary case.
	if (!escapes && !into_build) return

	# Leaving the project for somewhere that is not the build is broken however
	# it is written: the run copies `validation/<engine>/` and nothing beside it.
	if (!into_build) {
		print "OUTSIDE\t" line "\t" spec
		return
	}

	form = classify(head, names)
	if (form == "bad") {
		print "FORM\t" line "\t" spec "\t" evidence(head)
		return
	}

	# A type-only clause carries no value across the boundary — it is erased
	# before anything runs — so any file may take one.
	if (form == "type") {
		print "NAMES\t" line "\t" spec "\ttype-only: " names[1]
		return
	}

	if (role == "constants") {
		print "NAMES\t" line "\t" spec "\t" names[1]
		return
	}

	if (role == "harness") {
		# The loader reads the build's ENTRY, and only that: it has to construct
		# the game it drives. Any other module of the build is a figure source.
		if (spec ~ /^(\.\.\/)+src\/game(\.[A-Za-z]+)?$/) {
			print "NAMES\t" line "\t" spec "\t" names[1]
			return
		}
		print "MODULE\t" line "\t" spec "\t" names[1]
		return
	}

	print "ESCAPE\t" line "\t" spec "\t" names[1]
}

# Recognizes exactly one shape immediately before the specifier:
#
#   import { A, B as C } from "…"      export { A } from "…"
#   import type { T } from "…"         export type { T } from "…"
#
# and nothing else. `export *`, `import * as ns`, a default binding, a bare
# `import "…"`, `import("…")` and `require("…")` all fail to match, which is the
# point — every one of them brings the build's whole figure table, or brings it
# by a route the next reader will not think to look down.
function classify(head, names,   re, tre, body) {
	re = "(import|export)[ \t\n]*(type[ \t\n]+)?\\{[^{}]*\\}[ \t\n]*from[ \t\n]*$"
	if (match(head, re) == 0) return "bad"
	body = substr(head, RSTART, RLENGTH)
	names[1] = bindings(body)
	tre = "(import|export)[ \t\n]*type[ \t\n]+\\{"
	if (body ~ tre) return "type"
	return "value"
}

# The names inside the braces, normalized to a comma-separated list. `A as B`
# reports A, the name the build owns.
function bindings(body,   inner, i, n, parts, out, one) {
	match(body, /\{[^{}]*\}/)
	inner = substr(body, RSTART + 1, RLENGTH - 2)
	gsub(/[ \t\n]+/, " ", inner)
	n = split(inner, parts, ",")
	for (i = 1; i <= n; i++) {
		one = parts[i]
		sub(/^ +/, "", one)
		sub(/ +$/, "", one)
		sub(/^type +/, "", one)
		sub(/ +as +.*$/, "", one)
		if (one == "") continue
		out = (out == "" ? one : out ", " one)
	}
	return out
}

# The tail of the text before the specifier, for a message that shows the author
# what the gate actually saw.
function evidence(head,   t) {
	t = substr(head, length(head) - 59)
	gsub(/[ \t\n]+/, " ", t)
	sub(/^ +/, "", t)
	return t
}
