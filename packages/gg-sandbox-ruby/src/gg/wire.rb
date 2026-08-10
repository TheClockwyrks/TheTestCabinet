# frozen_string_literal: true

module GG
  # The bridge: the one place this SDK touches the membrane, and the only Ruby in the package that
  # is written in JavaScript.
  #
  # A gg Ruby program is compiled to JavaScript before it crosses, so the membrane's generated
  # bindings are JavaScript modules and reaching them from Ruby means Opal's inline-JavaScript
  # interop. The guest's entry module publishes those namespaces on `globalThis` once, at load, and
  # everything below reads them from there.
  #
  # **The model never sees any of this.** Every function above this layer is ordinary Ruby taking
  # ordinary Ruby values; what lives here is the lowering — `nil` to `undefined`, a Symbol to the
  # wire's kebab-cased enum arm, a `BigInt` back to an Integer, a thrown record to a raised
  # `GG::Core::ToolError`. That split is deliberate: a generic `call(name, hash)` would have been a
  # smaller diff and a different experiment.
  #
  # @api private
  module Wire
    # Make one membrane call and hand back whatever it returned, raising `GG::Core::ToolError` if
    # it failed.
    #
    # The `try` is written in JavaScript rather than as a Ruby `rescue` because what the generated
    # bindings throw is a bare JavaScript object rather than a Ruby exception, and no `rescue`
    # clause matches one.
    #
    # @param tool [String] gg's own name for the call, used when the failure carries none
    # @param family [String] the membrane interface (`files`, `board`, …)
    # @param name [String] the binding's own name on that interface (`readFile`)
    # @param args [Array] the positional arguments, already lowered to JavaScript values
    # @return [Object] the binding's return value, as JavaScript left it
    # @raise [GG::Core::ToolError] whatever the membrane refused the call with
    def self.call(tool, family, name, args)
      outcome = %x{
        (function () {
          try {
            return {
              ok: true,
              value: globalThis.__ggAdopt(
                globalThis.__ggWire[#{family}][#{name}].apply(null, #{args}),
              ),
            };
          } catch (thrown) {
            return { ok: false, failure: globalThis.__ggFailure(#{tool}, thrown) };
          }
        })()
      }
      return `#{outcome}.value` if `#{outcome}.ok`

      failure = `#{outcome}.failure`
      raise Core::ToolError.new(`#{failure}.tool`, symbol(`#{failure}.code`),
                                `#{failure}.message`)
    end

    # A Ruby value as the membrane's `option<T>`: `nil` becomes `undefined`.
    #
    # Opal's `nil` is a real object rather than JavaScript's `undefined`, so an absent optional
    # handed straight across would arrive as a present one holding something the lowering cannot
    # read.
    #
    # It is written in JavaScript rather than as `value.nil? ? …` because half the values that
    # reach it are already JavaScript — a lowered variant, a record this module built — and asking a
    # plain JavaScript object whether it is `nil` is a missing method rather than a `false`.
    #
    # @param value [Object, nil] what the program passed
    # @return [Object] the value, or JavaScript's `undefined`
    def self.js(value)
      `(#{value} === nil || #{value} === undefined || #{value} === null) ? undefined : #{value}`
    end

    # A JavaScript value as Ruby's, with `undefined` and `null` both becoming `nil`.
    #
    # @param value [Object] whatever the membrane returned
    # @return [Object, nil] the value, or `nil` when it was absent
    def self.some(value)
      `(#{value} === undefined || #{value} === null) ? nil : #{value}`
    end

    # A `u64` as a Ruby Integer.
    #
    # The component model lowers a `u64` to a JavaScript `BigInt`, which is neither a Ruby Integer
    # nor anything arithmetic in a program will accept.
    #
    # @param value [Object] the `BigInt` the membrane returned
    # @return [Integer] the same number, as a Ruby Integer
    def self.integer(value)
      `Number(#{value})`
    end

    # One field of a JavaScript record.
    #
    # @param record [Object] the record the membrane returned
    # @param field [String] the field's camelCased name on the wire
    # @return [Object, nil] the field, with `undefined` and `null` read as `nil`
    def self.field(record, field)
      some(`globalThis.__ggAdopt(#{record}[#{field}])`)
    end

    # A JavaScript record built out of named Ruby values, for a binding that takes one.
    #
    # @param fields [Hash{String => Object}] the wire's camelCased field names and their values
    # @return [Object] a plain JavaScript object
    def self.record(fields)
      out = `{}`
      fields.each { |name, value| `#{out}[#{name}] = #{js(value)}` }
      out
    end

    # A JavaScript variant, as the component model spells one.
    #
    # @param tag [String] the case's name
    # @param value [Object, nil] its payload, when the case carries one
    # @return [Object] a `{ tag }` or `{ tag, val }` object
    def self.variant(tag, value = nil)
      value.nil? ? `{ tag: #{tag} }` : `{ tag: #{tag}, val: #{value} }`
    end

    # The wire's spelling of a Ruby Symbol: `:in_progress` becomes `"in-progress"`.
    #
    # WIT identifiers cannot contain an underscore, so gg's own `in_progress` is `in-progress` on
    # the wire. A model should never see that seam.
    #
    # @param value [Symbol, nil] the choice a program wrote
    # @return [String, nil] the arm's name on the wire
    def self.arm(value)
      value.nil? ? nil : value.to_s.tr("_", "-")
    end

    # The Ruby spelling of a wire enum arm: `"in-progress"` becomes `:in_progress`.
    #
    # @param value [String, nil] the arm the membrane returned
    # @return [Symbol, nil] the same choice, as a Ruby Symbol
    def self.symbol(value)
      value.nil? ? nil : value.to_s.tr("-", "_").to_sym
    end

    # The three-way text edit a patch field lowers to: keep it, clear it, or set it.
    #
    # @param value [String, nil, Symbol] `GG::Core::UNCHANGED`, `nil`, or the replacement text
    # @return [Object] the membrane's `text-edit` variant
    def self.text_edit(value)
      return variant("keep") if value.equal?(Core::UNCHANGED)
      return variant("clear") if value.nil?

      variant("set", value)
    end

    # The membrane's tagged read, as the class a program actually gets.
    #
    # It lives here rather than on `GG::Files` because two modules perform the very same host read
    # and hand back the very same shape — `GG::Files.read_file` and `GG::Views.open_file` — and a
    # lowering owned by one of them would be a public method on that module with no gg operation
    # behind it.
    #
    # @param read [Object] the `{ tag, val }` variant the membrane returned
    # @return [GG::Files::TextFile, GG::Files::ImageFile] the read, as the model-facing class
    def self.file_read(read)
      value = `#{read}.val`
      if `#{read}.tag` == "text"
        Files::TextFile.new(
          contents: field(value, "contents"),
          first_line: field(value, "firstLine"),
          last_line: field(value, "lastLine"),
          total_lines: field(value, "totalLines"),
          byte_truncated: field(value, "byteTruncated")
        )
      else
        Files::ImageFile.new(
          media_type: field(value, "mediaType"),
          label: field(value, "label"),
          bytes: integer(`#{value}.bytes`),
          shown: field(value, "shown"),
          not_shown_reason: field(value, "notShownReason")
        )
      end
    end
  end
end
