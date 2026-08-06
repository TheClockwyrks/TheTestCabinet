# frozen_string_literal: true

# Emit the COMMITTED signature catalogue for the Ruby guest:
#
#   packages/gg-sandbox-ruby/src/gg/**  --this script-->  crates/gg/src/sandbox/guests/ruby.signatures.json
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
# The SDK is read **statically**, without loading it, because every module under `src/gg/` reaches
# `globalThis.__ggWire` through Opal's inline-JavaScript interop and that exists only inside the
# baked component. `src/gg/catalogue.rb` is the one exception and is loaded rather than parsed: it is
# pure data with no dependencies, and it is the identity half of the catalogue — which function, on
# which object, gated by what.
#
# # It refuses to emit a blank
#
# The [agreement gate](apps/docs/src/content/docs/gg/program-languages.md) fails a catalogue with an
# undocumented argument, type member or API object in it, and the failure would land on a model
# reading a signature it cannot act on. So it lands on the author here instead.
#
# # Usage
#
#   packages/gg-sandbox-ruby/signatures.sh
#
# which installs the pinned YARD first. `scripts/ci/contract-drift.sh` runs that script and fails on
# any diff, so an edit to a doc comment without a regeneration is an error rather than a surprise.

require "json"

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

require File.join(PACKAGE, "src", "gg", "catalogue")

# Every SDK source YARD reads. `catalogue.rb` is in the list because the API objects' model-facing
# descriptions are the doc comments on the constants that name them.
SOURCES = Dir[File.join(PACKAGE, "src", "gg", "**", "*.rb")].sort

YARD::Registry.clear
YARD.parse(SOURCES, [], YARD::Logger::ERROR)

# --------------------------------------------------------------------------------------------------
# Reading documentation
# --------------------------------------------------------------------------------------------------

# Fail the build rather than emit a blank the agreement gate would fail a model over.
def demand(text, what)
  raise "#{what} has no documentation; write it on the declaration" if text.to_s.strip.empty?

  text
end

# One docstring as markdown: wrapped prose re-joined into paragraphs, indented blocks left alone.
#
# The catalogue is rendered into a markdown system prompt, so a docstring's paragraphs are worth
# keeping and its hard line breaks are not — a sentence wrapped at 100 columns in the source should
# not arrive at a model wrapped at 100 columns. An indented line is a code example and is kept
# exactly as written.
def markdown(text)
  paragraphs = []
  current = []
  flush = lambda do
    paragraphs << current.join(" ") unless current.empty?
    current = []
  end
  text.to_s.split("\n").each do |line|
    if line.strip.empty?
      flush.call
    elsif line.start_with?("  ")
      flush.call
      paragraphs << line
    else
      current << line.strip
    end
  end
  flush.call
  # Consecutive code lines are one block rather than one paragraph each.
  joined = []
  paragraphs.each do |paragraph|
    if paragraph.start_with?("  ") && joined.last.to_s.start_with?("  ")
      joined[-1] = "#{joined.last}\n#{paragraph}"
    else
      joined << paragraph
    end
  end
  joined.join("\n\n")
end

# A function's whole documentation: its prose, and what it raises.
#
# `@raise` is folded in rather than dropped because what a call fails with is part of what it does,
# and a program that does not know which failures to expect writes no `rescue` at all.
def documentation(object, what)
  parts = [markdown(object.docstring.to_s)]
  object.tags(:raise).each do |tag|
    # A `@raise` YARD INFERRED from a bare `raise` in the body carries no prose, and a sentence
    # naming a class with nothing after it tells a model less than nothing.
    next if tag.text.to_s.strip.empty?

    parts << "Raises `#{tag.types.to_a.join(" or ")}`: #{markdown(tag.text.to_s)}"
  end
  demand(parts.reject { |part| part.strip.empty? }.join("\n\n"), what)
end

# YARD's type list as one readable type: `[Integer, nil]` reads `Integer or nil`, which is how
# Ruby's own documentation writes a union.
def type_of(types)
  list = Array(types)
  list.empty? ? "Object" : list.join(" or ")
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
  # would describe `fs.write_file(path) { … }` as an ordinary argument and be wrong about how the
  # call is written. Its type is the block's RETURN, because the `@param` on a `&name` documents
  # what the block hands back.
  {
    name: name,
    type: block ? "-> #{type_of(tag.types)}" : type_of(tag.types),
    optional: keyword ? !default.nil? : (splat || !default.nil?),
    kind: if block then "block"
          elsif keyword then "keyword"
          else "positional"
          end,
    default: default,
    doc: demand(markdown(tag.text.to_s), "`#{where}`'s `#{name}`"),
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
# `view.open_text(label, body)` and `view.open_text(label) { body }` are one capability written two
# ways, and nothing downstream compares the count.
def signatures(method, where)
  returns = type_of(method.tags(:return).flat_map { |tag| tag.types.to_a })
  overloads = method.tags(:overload)
  return [shape(method.name, method.parameters, method, where, returns)] if overloads.empty?

  overloads.map do |overload|
    shape(method.name, overload.parameters, overload, where, returns)
  end
end

# The catalogued type names a function's signature mentions, transitively closed.
#
# A signature that names `EpicCreated` and does not name `BoardUsage` still shows a model a record
# whose one interesting field is of a type it was never given, so the closure is walked rather than
# the surface read.
def referenced(method)
  names = Set.new
  seed = method.tags(:param).flat_map { |tag| tag.types.to_a } +
         method.tags(:return).flat_map { |tag| tag.types.to_a } +
         method.tags(:overload).flat_map { |o| o.tags(:param).flat_map { |t| t.types.to_a } }
  method.tags(:raise).each { |tag| seed.concat(tag.types.to_a) }
  pending = seed.flat_map { |text| text.scan(/[A-Z][A-Za-z0-9_]*/) }
  until pending.empty?
    name = pending.shift
    next unless GG::Catalogue::TYPES.include?(name)
    next unless names.add?(name)

    pending.concat(type_references(name))
  end
  GG::Catalogue::TYPES.select { |name| names.include?(name) }
end

# The catalogued names one type's own declaration and members mention.
def type_references(name)
  declaration, members = declare(name)
  ([declaration] + members.map { |member| member[:type].to_s }).flat_map do |text|
    text.scan(/[A-Z][A-Za-z0-9_]*/)
  end
end

# --------------------------------------------------------------------------------------------------
# Types
# --------------------------------------------------------------------------------------------------

# Whether a declaration is marked `@api private` and so is bridge rather than surface.
def private?(object)
  object.tags(:api).any? { |tag| tag.text.to_s.strip == "private" }
end

# One type's declaration and its members, in the notation Ruby writes a declaration in.
#
# Ruby has no type annotations in a method signature, but it does have a signature language of its
# own — RBS — and that is what a declaration is rendered in: `attr_reader contents: String`,
# `PENDING: :pending`, `type TurnRange = Range`. A model reading one learns the shape of the value
# without being shown a call it cannot write.
def declare(name)
  object = YARD::Registry.at("GG::#{name}")
  raise "`#{name}` is listed in Catalogue::TYPES and this SDK declares no such thing" if object.nil?

  case object
  when YARD::CodeObjects::ClassObject then declare_class(object)
  when YARD::CodeObjects::ModuleObject then declare_module(object)
  when YARD::CodeObjects::ConstantObject then [alias_of(object), []]
  else raise "`#{name}` is a #{object.class}, which this reflector does not know how to declare"
  end
end

# A class: its readers, each with the type its `@return` gives.
def declare_class(object)
  members = object.meths(inherited: false, included: false).reject do |method|
    method.name == :initialize || private?(method) || method.visibility != :public ||
      method.scope != :instance
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
  head = if superclass.empty? || superclass == "Object"
           "class #{object.name}"
         else
           "class #{object.name} < #{superclass}"
         end
  [
    [head, *lines, "end"].join("\n"),
    members.map do |method|
      {
        name: method.name.to_s,
        type: type_of(method.tags(:return).flat_map { |tag| tag.types.to_a }),
        doc: demand(member_doc(method), "`#{object.name}.#{method.name}`")
      }
    end
  ]
end

# A module of fixed choices: its constants, each with the value a program writes.
def declare_module(object)
  constants = object.constants(inherited: false).reject { |const| private?(const) }
  [
    ["module #{object.name}", *constants.map { |c| "  #{c.name}: #{c.value.strip}" }, "end"].join("\n"),
    constants.map do |const|
      {
        name: const.name.to_s,
        type: const.value.strip,
        doc: demand(markdown(const.docstring.to_s), "`#{object.name}::#{const.name}`")
      }
    end
  ]
end

# A constant standing for another type: an alias, which RBS writes with `type`.
def alias_of(object)
  "type #{object.name} = #{object.value.to_s.strip.delete_prefix("::")}"
end

# A reader's documentation: its own docstring, or the `@return` that carries it.
#
# `# @return [String] The file's text.` above an `attr_reader` is how a Ruby author documents one,
# and YARD files the prose on the tag rather than on the docstring.
def member_doc(method)
  own = markdown(method.docstring.to_s)
  return own unless own.strip.empty?

  markdown(method.tags(:return).map { |tag| tag.text.to_s }.join(" "))
end

# --------------------------------------------------------------------------------------------------
# The catalogue
# --------------------------------------------------------------------------------------------------

# The YARD object for one SDK method, by the module and name `Catalogue` files it under.
def method_at(mod, name)
  found = YARD::Registry.at("GG::#{mod}.#{name}")
  raise "GG::#{mod}.#{name} is catalogued and this SDK does not define it" if found.nil?

  found
end

# One catalogued function's shared fields.
def entry(mod, name, object)
  method = method_at(mod, name)
  where = "#{object}.#{name}"
  {
    name: name,
    object: object,
    signatures: signatures(method, where),
    doc: documentation(method, "`#{where}`"),
    types: referenced(method)
  }
end

objects = GG::Catalogue::OBJECT_ORDER.map do |name|
  constant = YARD::Registry.at("GG::Catalogue").constants.find { |c| c.value.strip == name.inspect }
  raise "the API object `#{name}` is named by no constant in Catalogue" if constant.nil?

  { object: name, doc: demand(markdown(constant.docstring.to_s), "the API object `#{name}`") }
end

tools = GG::Catalogue::TOOLS.map do |(tool, name, mod)|
  { tool: tool }.merge(entry(mod, name, GG::Catalogue::OBJECT_FOR_MODULE.fetch(mod)))
end

helpers = GG::Catalogue::HELPERS.map do |(key, name, requires)|
  { key: key, requires: requires }
    .merge(entry("Helpers", name, GG::Catalogue::OBJECT_FOR_MODULE.fetch("Helpers")))
end

session = GG::Catalogue::SESSION.map do |(key, name, object, ending)|
  { key: key, ending: ending }.merge(entry("Session", name, object))
end

views = GG::Catalogue::VIEWS.map do |(key, name, requires)|
  { key: key, requires: requires }
    .merge(entry("Views", name, GG::Catalogue::OBJECT_FOR_MODULE.fetch("Views")))
end

program_library = GG::Catalogue::PROGRAMS.map do |(key, name)|
  { key: key }.merge(entry("Programs", name, GG::Catalogue::OBJECT_FOR_MODULE.fetch("Programs")))
end

meta = GG::Catalogue::META.map do |(key, name)|
  method = method_at("Docs", name)
  {
    key: key,
    name: name,
    signatures: signatures(method, name),
    doc: documentation(method, "`#{name}`"),
    types: referenced(method)
  }
end

types = GG::Catalogue::TYPES.map do |name|
  declaration, members = declare(name)
  object = YARD::Registry.at("GG::#{name}")
  {
    name: name,
    declaration: declaration,
    doc: demand(markdown(object.docstring.to_s), "the type `#{name}`"),
    members: members
  }
end

# The libraries, read out of the manifest that decides them — the same file `tools/guest.mjs`
# compiles the set from, so what a model is told it may require is what the artifact carries.
libraries = []
File.read(File.join(PACKAGE, "src", "library.rb"), encoding: "UTF-8").each_line do |line|
  if (heading = line[/\A#\s*---\s*(.+?)\s*---\s*\z/, 1])
    libraries << { group: heading, modules: [] }
  elsif (required = line[/\Arequire\s+"([^"]+)"\s*\z/, 1])
    raise "src/library.rb: a require sits under no --- heading ---: #{required}" if libraries.empty?

    libraries.last[:modules] << required
  end
end
raise "src/library.rb declares no libraries at all" if libraries.empty?

catalogue = {
  language: "ruby",
  generatedFrom: "packages/gg-sandbox-ruby/src/gg/ + src/library.rb (YARD)",
  libraries: libraries,
  objects: objects,
  meta: meta,
  session: session,
  views: views,
  programs: program_library,
  tools: tools,
  helpers: helpers,
  types: types
}

# Every declaration in the SDK's model-facing modules is listed in `Catalogue::TYPES`, so a type
# added and not listed is a build error rather than a type nothing ever shows a model.
declared = YARD::Registry.all(:class, :module, :constant).filter_map do |object|
  next unless object.path.start_with?("GG::")
  next if object.path.count(":") > 2
  next if private?(object)

  object.path.delete_prefix("GG::")
end
missing = declared.select { |name| name =~ /\A[A-Z]/ } - GG::Catalogue::TYPES -
          %w[Catalogue Value Check Shell Files Skills Memories Tasks Board Context Delegation Views
             Programs Docs Session Helpers Wire Lib Scope ApiObject UNCHANGED]
unless missing.empty?
  raise "these declarations are model-facing and unlisted in Catalogue::TYPES: #{missing.join(", ")}"
end

File.write(OUT, "#{JSON.pretty_generate(catalogue)}\n")
counted = libraries.sum { |group| group[:modules].size }
warn "Wrote #{OUT} (#{tools.size} tools, #{types.size} types, #{counted} libraries)."
