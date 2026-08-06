# frozen_string_literal: true

module GG
  # A gg call that failed.
  #
  # Raised by every function on every API object. Rescue it where a failure is expected and branch
  # on `code`; let it propagate where it is not, and gg reports which call failed and on which line
  # of your program. A handler reads `rescue ToolError => failure` and then
  # `if failure.code == ToolErrorCode::CONFLICT`.
  #
  # It is a `StandardError`, so a bare `rescue => failure` catches it too — which is what a Ruby
  # programmer expects of anything a library raises.
  class ToolError < StandardError
    # @return [String] The gg call that failed (`read_file`, `spawn_subagent`, …). It is gg's own
    #   name for the capability, which is stable across every language a program may be written in.
    attr_reader :tool

    # @return [Symbol] The failure class, so a handler branches on a value rather than on prose.
    attr_reader :code

    # @param tool [String] gg's own name for the call that failed
    # @param code [Symbol] the failure class
    # @param message [String] the model-facing guidance
    # @api private
    def initialize(tool, code, message)
      super(message)
      @tool = tool
      @code = code
    end

    # @return [String] the failure, with the call and the class in front of the message
    # @api private
    def inspect
      "#<ToolError #{@tool} (#{@code}): #{message}>"
    end
  end

  # The argument checks every wrapper runs before it lowers anything onto the wire.
  #
  # Nothing type-checks a model's program: Opal compiles it and the guest runs it, and Ruby binds
  # arguments by name and arity alone. An `ArgumentError` already covers the mistakes that matter
  # most, and names the call while doing it — a wrong positional count from the `arity_check` gg
  # compiles both this SDK and the model's program with, and an unknown keyword from
  # `GG::ApiObject`, which is the one place that knows both what was passed and what the target
  # declares. Neither of those is free on this substrate and neither belongs here; see
  # `tools/compiler.mjs` and `scope.rb` for what each costs.
  #
  # What an `ArgumentError` cannot see is a value of the right *class* and the wrong *range*:
  # `fs.read_file("a.rb", offset: -1)` lowers to a `u32` by two's-complement wrap and fails for a
  # reason that has nothing to do with what was written. These cover exactly that gap.
  #
  # @api private
  module Check
    # The `u32` range, so no wrapper inlines the magic number.
    U32_MAX = 4_294_967_295

    # A whole number in `0..U32_MAX`, or a `ToolError` naming the argument.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Integer, nil] what the program passed
    # @return [Integer, nil] the value, or nil when it was left out
    # @raise [ToolError] `invalid-argument` when it is not a whole number in range
    def self.uint(fn, name, value)
      return nil if value.nil?

      unless value.is_a?(Integer) && value >= 0 && value <= U32_MAX
        raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                            "`#{name}` must be a whole number 0..#{U32_MAX}, got #{value.inspect}")
      end

      value
    end

    # A finite positive number of seconds, or a `ToolError` naming the argument.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Numeric, nil] what the program passed
    # @return [Float, nil] the value as a float, or nil when it was left out
    # @raise [ToolError] `invalid-argument` when it is not a positive number
    def self.positive(fn, name, value)
      return nil if value.nil?

      unless value.is_a?(Numeric) && value.to_f > 0
        raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                            "`#{name}` must be a positive number of seconds, got #{value.inspect}")
      end

      value.to_f
    end

    # A list of strings, flattened, defaulted to empty, or a `ToolError` naming the argument.
    #
    # Every `list<string>` argument goes through this, and every one of them is a splat — so
    # `agents.wait_for_subagents(*ids)` and `agents.wait_for_subagents(ids)` are the same call,
    # which is the forgiveness a Ruby caller expects of a variadic method.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param values [Array] what the program passed, splatted
    # @return [Array<String>] the flattened strings
    # @raise [ToolError] `invalid-argument` when an entry is not a string
    def self.strings(fn, name, values)
      flat = Array(values).flatten
      flat.each do |item|
        next if item.is_a?(String)

        raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                            "every entry of `#{name}` must be a string, got #{item.inspect}")
      end
      flat
    end

    # One of a fixed set of symbols, or a `ToolError` listing the set.
    #
    # This is what makes a symbol a *typed* choice rather than a free string. `:in_progres` is a
    # value Ruby will happily construct, so the check has to be here — and the failure names every
    # symbol that would have worked, which is the whole difference from a branch that silently
    # never runs.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Symbol, nil] what the program passed
    # @param allowed [Array<Symbol>] every symbol this argument accepts
    # @return [Symbol, nil] the value, or nil when it was left out
    # @raise [ToolError] `invalid-argument` when it is not one of `allowed`
    def self.choice(fn, name, value, allowed)
      return nil if value.nil?
      return value if allowed.include?(value)

      # Written with a leading colon by hand rather than with `inspect`, because Opal's Symbol is a
      # String: `:done.inspect` is `"done"` here, and a message that quoted the accepted set that
      # way would be telling a model to write the one thing this argument does not take.
      raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                          "`#{name}` must be one of #{allowed.map { |arm| ":#{arm}" }.join(", ")}, " \
                          "got :#{value}")
    end

    # An inclusive `Range` of whole turn numbers, lowered to the membrane's `{ start, end }` record.
    #
    # A `Range` is what a Ruby program writes a span as, and nothing stops one being built out of
    # strings or backwards; the membrane would lower either into a pair of `u32`s without complaint
    # and archive turns nobody named.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param span [Range] the span to check
    # @return [Array(Integer, Integer)] the first and last turn, both inclusive
    # @raise [ToolError] `invalid-argument` for anything that is not a whole, forward, closed range
    def self.span(fn, span)
      unless span.is_a?(Range) && span.first.is_a?(Integer) && span.last.is_a?(Integer)
        raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                            "every entry of `ranges` must be a Range of turn numbers " \
                            "(`4..19`), got #{span.inspect}")
      end

      last = span.exclude_end? ? span.last - 1 : span.last
      [uint(fn, "ranges", span.first), uint(fn, "ranges", last)]
    end
  end
end
