package gg.internal;

import gg.ToolError;
import gg.ToolErrorCode;

/**
 * <b>The frames</b> — how a {@link Value} becomes the bytes {@link Abi} carries, and how the host's
 * answer becomes a {@link Value} again or a raised {@link ToolError}.
 *
 * <p>Nothing here is model-facing. The encoding is gg's own and gg owns both ends of it; the Rust
 * half is {@code crates/gg/src/sandbox/membrane/wire.coding.rs}, whose header carries the table this
 * file implements and the argument for why it is a tagged binary form rather than JSON. In short: a
 * JSON reader is a string scanner, an escape decoder and a number parser compiled into every program
 * of every turn to move four fields, and JSON's one number type cannot tell a byte count from a
 * timeout.
 *
 * <p>Every integer in a frame is little-endian, and a string is a byte length followed by UTF-8.
 */
public final class Coding {
    private Coding() {
    }

    /** The leading byte of a response the call returned from. */
    private static final int RESPONSE_OK = 0;

    /** The leading byte of a response the call failed with. */
    private static final int RESPONSE_ERROR = 1;

    /**
     * Make one gg call and hand back what it answered.
     *
     * <p>This is the whole of the bridge the typed SDK sits on: a call's arguments go out
     * positionally in the order the WIT declares them, and what comes back is either the value or a
     * raised {@link ToolError} carrying the three fields gg failed with — the same class, the same
     * code and the same sentence every other arm's program catches.
     *
     * @param op the rendered operation id — {@code files.read_file}
     * @param arguments the call's arguments, already lowered
     * @return what the call returned, which is {@link Value#none()} for a call that returns nothing
     * @throws ToolError when gg refused the call or the tool behind it failed
     */
    public static Value call(String op, Value... arguments) {
        return response(Abi.call(op, request(arguments)));
    }

    /** One call's arguments, encoded. */
    static byte[] request(Value... arguments) {
        Writer out = new Writer();
        out.value(Value.list(arguments));
        return out.bytes();
    }

    /** What one call answered, or the failure it raised. */
    static Value response(byte[] bytes) {
        Reader in = new Reader(bytes);
        int outcome = in.byteAt();
        if (outcome == RESPONSE_OK) {
            return in.value();
        }
        if (outcome == RESPONSE_ERROR) {
            String tool = in.value().text();
            String code = in.value().text();
            String message = in.value().text();
            throw new ToolError(tool, ToolErrorCode.of(code), message);
        }
        throw new IllegalStateException("gg's answer began with " + outcome
                + ", which is neither an answer nor a failure");
    }

    // -------------------------------------------------------------------------------------------
    // Writing
    // -------------------------------------------------------------------------------------------

    /** A growing buffer, which is all the encoder needs. */
    private static final class Writer {
        /** What has been written. */
        private byte[] bytes = new byte[256];

        /** How much of it. */
        private int at;

        /** Everything written so far, exactly. */
        byte[] bytes() {
            byte[] whole = new byte[at];
            System.arraycopy(bytes, 0, whole, 0, at);
            return whole;
        }

        /** Make room for `more` bytes. */
        private void room(int more) {
            if (at + more <= bytes.length) {
                return;
            }
            int wanted = bytes.length;
            while (wanted < at + more) {
                wanted *= 2;
            }
            byte[] grown = new byte[wanted];
            System.arraycopy(bytes, 0, grown, 0, at);
            bytes = grown;
        }

        /** One byte. */
        private void put(int value) {
            room(1);
            bytes[at++] = (byte) value;
        }

        /** A little-endian count or length. */
        private void length(int value) {
            room(4);
            bytes[at++] = (byte) value;
            bytes[at++] = (byte) (value >>> 8);
            bytes[at++] = (byte) (value >>> 16);
            bytes[at++] = (byte) (value >>> 24);
        }

        /** A little-endian 64-bit number. */
        private void wide(long value) {
            room(8);
            for (int shift = 0; shift < 64; shift += 8) {
                bytes[at++] = (byte) (value >>> shift);
            }
        }

        /** A length-prefixed UTF-8 string, without a tag. */
        private void text(String value) {
            byte[] encoded = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            length(encoded.length);
            room(encoded.length);
            System.arraycopy(encoded, 0, bytes, at, encoded.length);
            at += encoded.length;
        }

        /** One whole value. */
        void value(Value value) {
            int tag = value.tag();
            put(tag);
            switch (tag) {
                case Value.NONE, Value.FALSE, Value.TRUE -> {
                    // The tag is the whole of it.
                }
                case Value.INT -> wide(value.number());
                case Value.FLOAT -> wide(Double.doubleToLongBits(value.decimal()));
                case Value.TEXT -> text(value.text());
                case Value.LIST -> {
                    length(value.size());
                    for (int index = 0; index < value.size(); index++) {
                        value(value.at(index));
                    }
                }
                case Value.RECORD -> {
                    length(value.size());
                    for (int index = 0; index < value.size(); index++) {
                        text(value.key(index));
                        value(value.fieldAt(index));
                    }
                }
                default -> throw new IllegalStateException("tag " + tag + " is not a value");
            }
        }
    }

    // -------------------------------------------------------------------------------------------
    // Reading
    // -------------------------------------------------------------------------------------------

    /** A cursor over the bytes of one frame. */
    private static final class Reader {
        /** The frame. */
        private final byte[] bytes;

        /** How far in the cursor is. */
        private int at;

        Reader(byte[] bytes) {
            this.bytes = bytes;
        }

        /** One byte, unsigned. */
        int byteAt() {
            if (at >= bytes.length) {
                throw new IllegalStateException("gg's answer ended early");
            }
            return bytes[at++] & 0xff;
        }

        /** A little-endian count or length. */
        private int length() {
            return byteAt() | byteAt() << 8 | byteAt() << 16 | byteAt() << 24;
        }

        /** A little-endian 64-bit number. */
        private long wide() {
            long value = 0;
            for (int shift = 0; shift < 64; shift += 8) {
                value |= (long) byteAt() << shift;
            }
            return value;
        }

        /** A length-prefixed UTF-8 string. */
        private String text() {
            int size = length();
            if (size < 0 || at + size > bytes.length) {
                throw new IllegalStateException("gg's answer claimed a " + size + "-byte string");
            }
            String value = new String(bytes, at, size, java.nio.charset.StandardCharsets.UTF_8);
            at += size;
            return value;
        }

        /** One whole value. */
        Value value() {
            int tag = byteAt();
            switch (tag) {
                case Value.NONE:
                    return Value.none();
                case Value.FALSE:
                    return Value.of(false);
                case Value.TRUE:
                    return Value.of(true);
                case Value.INT:
                    return Value.of(wide());
                case Value.FLOAT:
                    return Value.of(Double.longBitsToDouble(wide()));
                case Value.TEXT:
                    return Value.of(text());
                case Value.LIST: {
                    int count = length();
                    Value[] items = new Value[count];
                    for (int index = 0; index < count; index++) {
                        items[index] = value();
                    }
                    return Value.list(items);
                }
                case Value.RECORD: {
                    int count = length();
                    Value record = Value.record();
                    for (int index = 0; index < count; index++) {
                        record.put(text(), value());
                    }
                    return record;
                }
                default:
                    throw new IllegalStateException("tag " + tag + " is not a value");
            }
        }
    }
}
