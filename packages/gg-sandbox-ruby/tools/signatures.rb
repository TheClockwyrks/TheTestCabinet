# Emit the COMMITTED signature catalogue for the Ruby guest:
#
# packages/gg-sandbox-ruby/src/gg/**  --this script-->
# crates/gg/src/sandbox/guests/ruby.signatures.json
#   packages/gg-sandbox-ruby/src/library.rb           -->  its `libraries` section
#
# gg renders the responses-as-code system prompt and every documentation view from that file, so it
# is the whole of what a model is *told* about this arm's surface — and every word of it is
# reflected out of the declaration it describes rather than written anywhere else. A description
# kept in a table, a template or a `const` in gg's Rust is a description that drifts from its
# subject with nothing to catch it.
#
# # It reads YARD, which is what a Ruby author already writes
#
# Nothing here is a bespoke comment format. `@param`, `@return`, `@raise` and `@overload` are Ruby's
# own documentation tags, `attr_reader` docs are read off the `@return` on the reader, and a
# constant's description is the comment above it. What YARD understands is what this emits.
#
# # The identity is read from the SDK itself, not from a table beside it
#
# Which gg operation a method binds is written under that method's own `end`, as the `operation`
# line `GG::Surface` records. So this script **requires** the SDK and reads `GG::Surface.registry`,
# rather than parsing a catalogue file that names every function a second time — a second name is a
# second place to be wrong. Loading is safe under CRuby because every reach through Opal's
# inline-JavaScript interop is inside a method body: the SDK's top level defines classes, records
# declarations and lifts implementations off their modules, and touches the membrane nowhere.
#
# # Brief and detail, and the refusal that keeps them honest
#
# The first paragraph of a doc comment is the **brief** and the rest is the **detail**, which is
# Doxygen's implicit structure and the shape gg's register gate holds every arm to. There is no
# "first sentence of" anywhere in this file: a brief is authored, and a comment whose opening
# paragraph is really three sentences of narrative is refused here, naming the declaration, rather
# than three steps later in a gate.
#
# # Usage
#
#   packages/gg-sandbox-ruby/signatures.sh
#
# which installs the pinned YARD first. `scripts/ci/contract-drift.sh` runs that script and fails on
# any diff, so an edit to a doc comment without a regeneration is an error rather than a surprise.

require "json"
require "set"

# The pinned release `signatures.sh` installed, when it is the one that started this. A machine with
# two YARDs on it must reflect with the same one every other machine does.
gem "yard", ENV["GG_YARD_VERSION"] if ENV["GG_YARD_VERSION"]
require "yard"

# Every source this reads is UTF-8 and the prose in it is full of em-dashes, so a machine whose
# locale says otherwise must not decide how to read them.
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8

PACKAGE = File.expand_path("..", __dir__)
ROOT = File.expand_path("../..", PACKAGE)
OUT = File.join(ROOT, "crates", "gg", "src", "sandbox", "guests", "ruby.signatures.json")

# The schema this catalogue is written in — the normalized doc model, which `crates/gg/src/sandbox/
# signatures.rs` dispatches on.
SCHEMA = 2

# What a reader of the committed artifact regenerates it from.
GENERATED_FROM = "packages/gg-sandbox-ruby/src/gg/ + src/library.rb (YARD)"

# The types every call can name whether or not its own signature does, because every call can fail.
ALWAYS_REFERENCED = ["GG::Core::ToolError", "GG::Core::ToolErrorCode"].freeze

# The brief is one line and short. A cap no honest one-liner reaches, enforced where the author is.
BRIEF_CAP = 120

$LOAD_PATH.unshift(File.join(PACKAGE, "src"))
require "gg/value"
require "gg/core"
require "gg/check"
require "gg/surface"
require "gg/wire"
require "gg/directory"
require "gg/lib"
GG::Surface::MODULES.each { |name| require "gg/#{name.downcase}" }
require "gg/scope"

SOURCES = Dir[File.join(PACKAGE, "src", "gg", "**", "*.rb")].sort

YARD::Registry.clear
YARD.parse(SOURCES, [], YARD::Logger::ERROR)

# --------------------------------------------------------------------------------------------------
# Reading documentation
# --------------------------------------------------------------------------------------------------

# Fail the build rather than emit a blank the register gate would fail a model over.
def demand(text, what)
  raise "#{what} has no documentation; write it on the declaration" if text.to_s.strip.empty?

  text
end

# One docstring as markdown: wrapped prose re-joined into paragraphs, fenced blocks left alone.
#
# A `#` comment is wrapped to the source's line width, and those breaks are an artefact of reading
# Ruby rather than anything a model should be shown: they turn one sentence into three lines in a
# documentation view and make a diff of the catalogue a diff of where the author's editor wrapped.
# Blank lines, list items and fenced blocks all survive — the first two because they are structure,
# the third because whitespace inside it is the code.
#
# It is also what makes a **brief** a single line without the author having to keep one inside the
# source's line width: the brief is the first paragraph, and a paragraph is one line by the time it
# leaves here.
def markdown(text)
  out = []
  paragraph = []
  fenced = false
  flush = lambda do
    out << paragraph.join(" ") unless paragraph.empty?
    paragraph = []
  end
  text.to_s.split("\n").each do |line|
    stripped = line.strip
    if stripped.start_with?("```")
      flush.call
      fenced = !fenced
      out << stripped
    elsif fenced
      out << line
    elsif stripped.empty?
      flush.call
      out << ""
    elsif stripped.start_with?("* ", "- ", "# ")
      flush.call
      paragraph << stripped
    else
      paragraph << stripped
    end
  end
  flush.call
  out.join("\n").gsub(/\n{3,}/, "\n\n").strip
end

# One piece of settled prose as `[brief, detail]`: the first paragraph, and the rest.
#
# The split is on the blank line the author put there, so a doc comment whose opening paragraph is
# really three sentences of narrative fails here as the paragraph it is rather than being silently
# cut at a full stop.
def split(text, what, cap: BRIEF_CAP)
  raise "#{what} has no documentation; write it on the declaration" if text.to_s.strip.empty?

  brief, _, detail = text.partition("\n\n")
  brief = brief.strip
  if brief.include?("\n")
    raise "#{what} has a brief of more than one line — the first paragraph is the brief and the " \
          "rest is the detail: #{brief.inspect}"
  end
  if cap && brief.length > cap
    raise "#{what} has a #{brief.length}-character brief, and a brief is capped at #{cap}: " \
          "#{brief.inspect}"
  end

  [brief, (detail.strip.empty? ? nil : detail.strip)]
end

# A declaration's `[brief, detail]`, with what it hands back and what it raises folded into the
# detail.
#
# `@raise` is folded in rather than dropped because what a call fails with is part of what it does,
# and a program that does not know which failures to expect writes no `rescue` at all. It reads as
# part of the description under its own heading, which is where every other arm puts it.
#
# `@return`'s prose is folded in for the same reason and was not, which is a defect this arm
# shipped: the tag was read for its TYPES and its text had no destination, so fifty authored
# sentences about what a call hands back reached no model. Most of them restate the brief and some
# do not — `create_epic`'s says the call hands back the board budget as well as the id, which its
# brief and its detail both leave out. The line is written `Returns: …`, which is the shape the
# five arms that carry one already write.
def documented(object, what)
  brief, detail = split(markdown(object.docstring.to_s), what)
  returned = object.tags(:return).map { |tag| markdown(tag.text.to_s) }
                   .reject { |text| text.strip.empty? }
  raised = object.tags(:raise).reject { |tag| tag.text.to_s.strip.empty? }
                 .map { |tag| markdown(tag.text.to_s) }
  return [brief, detail] if returned.empty? && raised.empty?

  parts = [detail]
  parts << "Returns: #{returned.join(' ')}" unless returned.empty?
  parts << "# Errors\n\n#{raised.join("\n\n")}" unless raised.empty?
  [brief, parts.compact.join("\n\n")]
end

# YARD's type list as one readable type: `[Integer, nil]` reads `Integer or nil`, which is how
# Ruby's own documentation writes a union.
def type_of(types)
  list = Array(types)
  list.empty? ? "Object" : list.join(" or ")
end

# Every catalogued type name a piece of written type text mentions.
#
# Every spelling this SDK writes is fully qualified — `GG::Files::TextFile` rather than a bare
# `TextFile` — because that is the string a program writes, and a documentation view is opened by
# the same string a signature shows.
def named_types(text)
  text.to_s.scan(/GG(?:::[A-Z][A-Za-z0-9_]*)+/)
end

# --------------------------------------------------------------------------------------------------
# The modules, and the types they declare
# --------------------------------------------------------------------------------------------------

# Whether a declaration is marked `@api private` and so is bridge rather than surface.
def private?(object)
  object.nil? || object.tags(:api).any? { |tag| tag.text.to_s.strip == "private" }
end

# The YARD object at `path`, or a build failure naming what asked for it.
def at(path, what)
  found = YARD::Registry.at(path)
  raise "#{what} names `#{path}`, which YARD found no declaration of" if found.nil?

  found
end

# One module's identity: gg's cross-arm id for it, and how Ruby spells it.
#
# The id is the constant's own name in lower case on every one of them, so there is no table mapping
# the two and no way for one to drift from the other.
Module_ = Struct.new(:id, :constant, :path)

MODULES = GG::Surface::MODULES.map do |name|
  Module_.new(name.downcase, GG.const_get(name), "GG::#{name}")
end

# Every type a capability module declares, in the order the module declares them.
#
# A constant whose value is a Module or a Class is a declaration; anything else is a value, and
# `GG::Core::UNCHANGED` is the one of those a program writes. A declaration marked `@api private` is
# bridge rather than surface and is left out — as is the whole of `GG::Wire`, `GG::Check` and the
# rest, which live outside every capability module and are therefore never looked at here.
def declared_types(mod)
  mod.constant.constants(false).filter_map do |name|
    value = mod.constant.const_get(name)
    next unless value.is_a?(Module)

    path = "#{mod.path}::#{name}"
    object = YARD::Registry.at(path)
    next if private?(object)

    [path, object]
  end
end

TYPES = MODULES.flat_map { |mod| declared_types(mod).map { |(path, object)| [path, mod, object] } }
TYPE_MODULE = TYPES.to_h { |(path, mod, _object)| [path, mod] }
TYPE_OBJECT = TYPES.to_h { |(path, _mod, object)| [path, object] }

# --------------------------------------------------------------------------------------------------
# Declaring a type
# --------------------------------------------------------------------------------------------------

# The declarations recorded so far, keyed by fully-qualified name, and the member functions
# collected onto each of them by the function walk.
DECLARED = {}
MEMBER_FUNCTIONS = Hash.new { |hash, key| hash[key] = [] }

# Every instance method of `object` that carries a gg operation, by name.
def member_operations(path)
  GG::Surface.registry.select { |entry| !entry.module_function? && entry.owner.name == path }
             .to_h { |entry| [entry.name.to_s, entry] }
end

# One field or predicate of a value class, with the documentation written on it.
#
# `# @return [String] The file's text.` above an `attr_reader` is how a Ruby author documents one,
# and YARD files the prose on the tag rather than on the docstring — so a member with more to say
# writes an ordinary comment above a bare `@return`, and the split falls out the same way.
def member_of(method, what)
  own = markdown(method.docstring.to_s)
  text = own.empty? ? markdown(method.tags(:return).map { |tag| tag.text.to_s }.join(" ")) : own
  brief, detail = split(text, what)
  { brief: brief, detail: detail }
end

# One type's declaration and its members, in the notation Ruby writes a declaration in.
#
# Ruby has no type annotations in a method signature, but it does have a signature language of its
# own — RBS — and that is what a declaration is rendered in: `attr_reader contents: String`,
# `PENDING: :pending`, `type TurnRange = Range`. A model reading one learns the shape of the value
# without being shown a call it cannot write.
def declare(path)
  return DECLARED[path][:referenced] if DECLARED.key?(path)

  mod = TYPE_MODULE.fetch(path) { raise "`#{path}` is referred to and is not a catalogued type" }
  object = TYPE_OBJECT.fetch(path)
  name = path.split("::").last
  declaration, members = case object
                         when YARD::CodeObjects::ClassObject then declare_class(object, path, name)
                         when YARD::CodeObjects::ModuleObject then declare_module(object, path, name)
                         when YARD::CodeObjects::ConstantObject then [alias_of(object, name), []]
                         else raise "`#{path}` is a #{object.class}, which cannot be declared"
                         end
  brief, detail = documented(object, "the type `#{path}`")
  referenced = ([declaration] + members.map { |member| member[:type].to_s })
               .flat_map { |text| named_types(text) }
  DECLARED[path] = {
    "fqn" => path,
    "module" => mod.id,
    "name" => name,
    "declaration" => declaration,
    "brief" => brief,
    "detail" => detail,
    "members" => members.map { |member| member.transform_keys(&:to_s) },
    :referenced => referenced
  }
  referenced
end

# A class: its readers, each with the type its `@return` gives, and its predicates.
def declare_class(object, path, name)
  operations = member_operations(path)
  members = object.meths(inherited: false, included: false).reject do |method|
    method.name == :initialize || private?(method) || method.visibility != :public ||
      method.scope != :instance || operations.key?(method.name.to_s)
  end
  lines = members.map do |method|
    type = type_of(method.tags(:return).flat_map { |tag| tag.types.to_a })
    if method.name.to_s.end_with?("?")
      "  def #{method.name}: () -> #{type}"
    else
      "  attr_reader #{method.name}: #{type}"
    end
  end
  superclass = object.superclass.to_s
  head = superclass.empty? || superclass == "Object" ? "class #{name}" : "class #{name} < #{superclass}"
  [
    [head, *lines, "end"].join("\n"),
    members.map do |method|
      {
        name: method.name.to_s,
        type: type_of(method.tags(:return).flat_map { |tag| tag.types.to_a }),
        kind: "field",
        **member_of(method, "`#{path}##{method.name}`")
      }
    end
  ]
end

# A module of fixed choices: its constants, each with the value a program writes.
def declare_module(object, path, name)
  constants = object.constants(inherited: false).reject { |const| private?(const) }
  [
    ["module #{name}", *constants.map { |c| "  #{c.name}: #{c.value.strip}" }, "end"].join("\n"),
    constants.map do |const|
      brief, detail = split(markdown(const.docstring.to_s), "`#{path}::#{const.name}`")
      {
        name: const.name.to_s,
        type: const.value.strip,
        kind: "variant",
        brief: brief,
        detail: detail
      }
    end
  ]
end

# A constant standing for another type: an alias, which RBS writes with `type`.
def alias_of(object, name)
  "type #{name} = #{object.value.to_s.strip.delete_prefix("::")}"
end

# --------------------------------------------------------------------------------------------------
# Signatures
# --------------------------------------------------------------------------------------------------

# The `@param` tag for `name`, out of a method or an overload.
def param_tag(object, name)
  object.tags(:param).find { |tag| tag.name.to_s == name }
end

# One parameter, as the catalogue records it.
#
# The three shapes Ruby writes an argument in are all here: positional (with or without a default),
# keyword (`offset:`), splat (`*ranges`) and block (`&body`). Which of them a function uses is the
# half of a call the seam leaves each language free to spell for itself.
def parameter(raw_name, default, holder, where)
  keyword = raw_name.end_with?(":")
  splat = raw_name.start_with?("*")
  block = raw_name.start_with?("&")
  name = raw_name.delete_prefix("*").delete_prefix("&").delete_suffix(":")
  tag = param_tag(holder, name)
  raise "#{where} takes `#{name}` and documents no `@param` for it" if tag.nil?

  # A splat is still `positional` — it IS passed by position, and the `*` in the rendered signature
  # plus `optional` say the rest. A block is not: it is a second channel into the call, written as a
  # body rather than as a value, so a reader of the structured parameters that saw `positional` here
  # would describe `GG::Files.write_file(path) { … }` as an ordinary argument and be wrong about how
  # the call is written. Its type is the block's RETURN, because the `@param` on a `&name` documents
  # what the block hands back.
  # No length cap: what a parameter has to say about a path, a selector or a limit is short by
  # nature, and a bound there would be a second opinion about the same thing. Its SHAPE is held to
  # the brief's, which is what a one-line description of an argument is.
  brief, detail = split(markdown(tag.text.to_s), "`#{where}`'s `#{name}`", cap: nil)
  raise "`#{where}`'s `#{name}` has a detailed description, and a parameter has only a brief" if detail

  {
    name: name,
    type: block ? "-> #{type_of(tag.types)}" : type_of(tag.types),
    optional: keyword ? !default.nil? : (splat || !default.nil?),
    kind: if block then "block"
          elsif keyword then "keyword"
          else "positional"
          end,
    default: default,
    doc: brief,
    fields: []
  }
end

# How a parameter is written back into a rendered signature.
def rendered(raw_name, default)
  if raw_name.end_with?(":")
    default.nil? ? raw_name : "#{raw_name} #{default}"
  elsif raw_name.start_with?("*") || raw_name.start_with?("&")
    raw_name
  else
    default.nil? ? raw_name : "#{raw_name} = #{default}"
  end
end

# One shape a function may be called in: the signature a model reads, and its arguments in order.
#
# The signature is written the way Ruby's own documentation writes one — the call, then `->`, then
# what comes back — because Ruby has no type annotations to put in the call itself.
def shape(name, parameters, holder, where, returns)
  arguments = parameters.map { |raw, default| rendered(raw, default) }
  {
    signature: "#{name}(#{arguments.join(", ")}) -> #{returns}",
    parameters: parameters.map { |raw, default| parameter(raw, default, holder, where) }
  }
end

# Every shape a function offers: its `@overload` tags where it has them, and its own signature where
# it does not.
#
# An overload group is one entry with many signatures, which is exactly what the catalogue's
# `signatures` array is for. On this arm it is how a block is offered beside a positional argument:
# `GG::Views.open_text(label, body)` and `GG::Views.open_text(label) { body }` are one capability
# written two ways, and nothing downstream compares the count.
def signatures(method, where)
  returns = type_of(method.tags(:return).flat_map { |tag| tag.types.to_a })
  overloads = method.tags(:overload)
  return [shape(method.name, method.parameters, method, where, returns)] if overloads.empty?

  overloads.map { |overload| shape(method.name, overload.parameters, overload, where, returns) }
end

# The types one declaration's own shapes name, in first-mention order.
def mentioned(method)
  seed = method.tags(:param).flat_map { |tag| tag.types.to_a } +
         method.tags(:return).flat_map { |tag| tag.types.to_a } +
         method.tags(:overload).flat_map { |o| o.tags(:param).flat_map { |t| t.types.to_a } } +
         method.tags(:raise).flat_map { |tag| tag.types.to_a }
  seed.flat_map { |text| named_types(text) }
end

# The types a declaration's return position hands back, in first-mention order.
def returned(method)
  method.tags(:return).flat_map { |tag| tag.types.to_a }.flat_map { |text| named_types(text) }
end

# The catalogued types a signature mentions, transitively closed, in first-mention order.
#
# Transitive because the list answers *which declarations does this run's surface reach*, which is
# what decides whether a type may be opened at all. A record whose one interesting field is of a
# type a signature never named is still a record a model is shown, so the closure is walked rather
# than the surface read.
def close_over(names)
  pending = names.dup
  seen = []
  until pending.empty?
    name = pending.shift
    next if seen.include?(name)

    seen << name
    pending.concat(declare(name))
  end
  seen
end

# A list of names with every repeat dropped, in first-mention order.
def deduped(names)
  names.each_with_object([]) { |name, out| out << name unless out.include?(name) }
end

# --------------------------------------------------------------------------------------------------
# The catalogue
# --------------------------------------------------------------------------------------------------

# The YARD object for one declaration, by the module or class it is declared on and its name.
def method_at(entry)
  at("#{entry.owner.name}#{entry.module_function? ? "." : "#"}#{entry.name}", "`#{entry.operation}`")
end

# One catalogued call, whatever kind of declaration the SDK made of it.
def function_entry(entry)
  mod = MODULES.find { |candidate| entry.fqn.start_with?("#{candidate.path}.", "#{candidate.path}::") }
  raise "`#{entry.fqn}` belongs to no capability module" if mod.nil?

  method = method_at(entry)
  receiver = entry.module_function? ? nil : entry.owner.name.to_s.split("::").last
  what = "`#{entry.fqn}`"
  brief, detail = documented(method, what)
  {
    "operation" => entry.operation,
    "aliasOf" => entry.aliased ? entry.operation : nil,
    "module" => mod.id,
    "kind" => entry.module_function? ? "function" : "method",
    "receiver" => receiver,
    "name" => entry.name.to_s,
    "fqn" => entry.fqn,
    # `null`, because on this arm the fully-qualified name IS what a program writes: `GG` is a
    # top-level constant the component already carries, so `GG::Files.read_file` is the call site.
    "call" => nil,
    "brief" => brief,
    "detail" => detail,
    "signatures" => signatures(method, what).map { |s| s.transform_keys(&:to_s) },
    # The closure runs over everything the shapes name plus the failure every call can raise;
    # `returns` is the DIRECT return position and nothing beyond it, since what it feeds is a
    # one-level rule.
    "types" => close_over(deduped(mentioned(method) + ALWAYS_REFERENCED)),
    "returns" => deduped(returned(method))
  }
end

functions = GG::Surface.registry.map do |entry|
  built = function_entry(entry)
  unless entry.module_function?
    MEMBER_FUNCTIONS[entry.owner.name.to_s] << {
      "operation" => built["operation"],
      "name" => built["name"],
      "fqn" => built["fqn"],
      "brief" => built["brief"]
    }
  end
  built
end

# The one function that belongs to no module, read from the one declaration that carries it.
directory = at("GG::Directory.list", "the directory every module carries")
directory_brief, directory_detail = documented(directory, "`list`")
meta = [{
  "key" => "list",
  "name" => "list",
  "signatures" => signatures(directory, "list").map { |s| s.transform_keys(&:to_s) },
  "doc" => [directory_brief, directory_detail].compact.join("\n\n"),
  "types" => close_over(deduped(returned(directory)))
}]

modules = MODULES.map do |mod|
  brief, detail = documented(at(mod.path, "the module table"), "the `#{mod.path}` module")
  {
    "id" => mod.id,
    "path" => mod.path,
    "brief" => brief,
    "detail" => detail,
    # `null`, and truthfully: the component carries this SDK in its pre-initialised heap, so `GG` is
    # already a top-level constant and there is no `require` line a program would be right to write.
    "import" => nil
  }
end

# Every type the surface reaches, in the order its module declares it — walked last, because the
# function walk is what records them and what hangs member functions off them.
types = TYPES.filter_map do |(path, _mod, _object)|
  declaration = DECLARED[path]
  next if declaration.nil?

  declaration.reject { |key, _| key == :referenced }
             .merge("memberFunctions" => MEMBER_FUNCTIONS[path])
end

# --------------------------------------------------------------------------------------------------
# What the SDK is held to
# --------------------------------------------------------------------------------------------------

# Every public singleton method of a capability module carries a gg operation, and every operation
# names a method that exists.
#
# The first direction is the one that matters: a model-facing function nobody declared an operation
# for is a function no documentation view opens, no directory lists and no search returns — present
# in the SDK, absent from the surface, and invisible in a diff. The second is checked by `method_at`
# every time it looks one up.
MODULES.each do |mod|
  declared = GG::Surface.registry.select { |entry| entry.owner.equal?(mod.constant) }
                        .map { |entry| entry.name.to_s }
  object = at(mod.path, "the module table")
  object.meths(inherited: false, included: false).each do |method|
    next unless method.scope == :class
    next if private?(method) || method.visibility != :public
    next if declared.include?(method.name.to_s)

    raise "`#{mod.path}.#{method.name}` is public and names no gg operation, so a model would " \
          "never be told it exists — write an `operation` line under its `end`, or make it " \
          "`private_class_method`"
  end
end

# Every type a signature reaches is declared, and every type this SDK declares is reached.
#
# A declaration nothing refers to is a documentation view nothing can open: reachability from a
# bound call is what gates a type view, so an unreferenced declaration is dead weight in the
# catalogue and an unanswerable name to the one reader it exists for.
reached = Set.new(functions.flat_map { |entry| entry["types"] } + meta.flat_map { |e| e["types"] })
unreached = TYPES.map { |(path, _mod, _object)| path }.reject { |path| reached.include?(path) }
unless unreached.empty?
  raise "nothing in this surface refers to #{unreached.join(", ")} — a declaration only exists to " \
        "be read, and one no signature names can never be opened"
end

# --------------------------------------------------------------------------------------------------
# The libraries
# --------------------------------------------------------------------------------------------------

# The libraries, read out of the manifest that decides them — the same file `tools/guest.mjs`
# compiles the set from, so what a model is told it may require is what the artifact carries.
libraries = []
File.read(File.join(PACKAGE, "src", "library.rb"), encoding: "UTF-8").each_line do |line|
  if (heading = line[/\A#\s*---\s*(.+?)\s*---\s*\z/, 1])
    libraries << { "group" => heading, "modules" => [] }
  elsif (required = line[/\Arequire\s+"([^"]+)"\s*\z/, 1])
    raise "src/library.rb: a require sits under no --- heading ---: #{required}" if libraries.empty?

    libraries.last["modules"] << required
  end
end
raise "src/library.rb declares no libraries at all" if libraries.empty?

catalogue = {
  "schema" => SCHEMA,
  "language" => "ruby",
  "generatedFrom" => GENERATED_FROM,
  "libraries" => libraries,
  "modules" => modules,
  "meta" => meta,
  "functions" => functions,
  "types" => types
}

File.write(OUT, "#{JSON.pretty_generate(catalogue)}\n")
counted = libraries.sum { |group| group["modules"].size }
warn "Wrote #{OUT} (#{functions.size} functions, #{types.size} types, #{counted} libraries)."
