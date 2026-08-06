# frozen_string_literal: true

module GG
  # The behaviour every result object in this SDK gets: value equality, a hash, a `to_h`, pattern
  # matching and a readable `inspect`.
  #
  # Not model-facing and not catalogued. It is here because a Ruby programmer expects a returned
  # record to behave like a value rather than like an object with an address: `read == other_read`
  # compares contents, `case entry in { kind: :file }` destructures, and `p entry` prints something
  # a person can read. Writing those five methods out on twenty classes would be twenty chances to
  # get one of them subtly wrong.
  #
  # Every member is derived from the instance variables the class set, so a reader added to a
  # result and left out of `to_h` is not a shape this module can produce.
  #
  # @api private
  module Value
    # Two results of the same class holding the same fields.
    #
    # @param other [Object] whatever it is being compared against
    # @return [Boolean] true when `other` is the same class and holds equal fields
    def ==(other)
      other.class == self.class && other.to_h == to_h
    end

    alias eql? ==

    # @return [Integer] a hash over the class and the fields, so results work as Hash keys
    def hash
      [self.class, to_h].hash
    end

    # Every field, keyed by the name its reader is called.
    #
    # A predicate reader (`truncated?`) keys on the bare name (`:truncated`), because a Symbol
    # ending in `?` is not something a Hash literal or a pattern is written with.
    #
    # @return [Hash{Symbol => Object}] the fields, in declaration order
    def to_h
      instance_variables.each_with_object({}) do |ivar, out|
        out[ivar.to_s[1..].to_sym] = instance_variable_get(ivar)
      end
    end

    # What `case result in { … }` destructures.
    #
    # @param _keys [Array<Symbol>, nil] the keys the pattern asked for, ignored: every field is cheap
    # @return [Hash{Symbol => Object}] the same fields `to_h` returns
    def deconstruct_keys(_keys)
      to_h
    end

    # @return [String] the class's short name and its fields
    def inspect
      fields = to_h.map { |name, value| "#{name}=#{value.inspect}" }.join(", ")
      "#<#{self.class.name.to_s.split("::").last} #{fields}>"
    end

    alias to_s inspect
  end
end
