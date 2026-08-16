package gg.internal;

/**
 * <b>One value on the wire</b> — the small alphabet gg's records, variants, enums, options and lists
 * are all written down in on the way across {@link Abi}.
 *
 * <p>Nothing here is model-facing, and nothing describes it to a model — see {@link Abi}'s class
 * note for what that does and does not mean. What a model reads is the typed, namespaced surface the
 * {@code gg} classes build on top of it, and this is what those classes lower their arguments into
 * and lift their answers out of.
 *
 * <p>One class with a tag rather than a sealed hierarchy of eight, because every value on this wire
 * is built and read within a dozen lines of itself by code nobody browses, and eight files of
 * ceremony would buy exactly nothing. The tag is checked on every read, so asking a number for its
 * text is an exception naming both rather than a silent zero.
 */
public final class Value {
    /** An absent {@code option}, or the value of a call that returns nothing. */
    static final int NONE = 0;
    /** {@code false}. */
    static final int FALSE = 1;
    /** {@code true}. */
    static final int TRUE = 2;
    /** Any WIT integer, widened to 64 bits. */
    static final int INT = 3;
    /** An {@code f64}. */
    static final int FLOAT = 4;
    /** A {@code string}, or the case name of an {@code enum}. */
    static final int TEXT = 5;
    /** A {@code list<T>}. */
    static final int LIST = 6;
    /** A {@code record}, and also how a {@code variant} is written. */
    static final int RECORD = 7;

    /** The one absent value, which needs no second instance. */
    private static final Value ABSENT = new Value(NONE);

    /** The one {@code true}. */
    private static final Value YES = new Value(TRUE);

    /** The one {@code false}. */
    private static final Value NO = new Value(FALSE);

    /** Which of the eight this is. */
    private final int tag;

    /** The whole number, when this is one. */
    private long number;

    /** The double, when this is one. */
    private double decimal;

    /** The text, when this is one. */
    private String text;

    /** The items, when this is a list; the field values, when this is a record. */
    private Value[] items = EMPTY_VALUES;

    /** The field names, when this is a record. */
    private String[] keys = EMPTY_KEYS;

    /** How many of {@link #items} and {@link #keys} are in use. */
    private int count;

    /** The empty item array every value starts with. */
    private static final Value[] EMPTY_VALUES = new Value[0];

    /** The empty key array every value starts with. */
    private static final String[] EMPTY_KEYS = new String[0];

    private Value(int tag) {
        this.tag = tag;
    }

    // -------------------------------------------------------------------------------------------
    // Building
    // -------------------------------------------------------------------------------------------

    /** An absent {@code option}, or the answer of a call that returns nothing. */
    public static Value none() {
        return ABSENT;
    }

    /** A flag. */
    public static Value of(boolean flag) {
        return flag ? YES : NO;
    }

    /** A whole number, whatever width it started at. */
    public static Value of(long whole) {
        Value value = new Value(INT);
        value.number = whole;
        return value;
    }

    /** A double. */
    public static Value of(double real) {
        Value value = new Value(FLOAT);
        value.decimal = real;
        return value;
    }

    /** Text, or {@link #none()} for {@code null} — which is how an absent {@code option} is written. */
    public static Value of(String characters) {
        if (characters == null) {
            return ABSENT;
        }
        Value value = new Value(TEXT);
        value.text = characters;
        return value;
    }

    /** A list. */
    public static Value list(Value... members) {
        Value value = new Value(LIST);
        value.items = members;
        value.count = members.length;
        return value;
    }

    /** A list of text. */
    public static Value texts(java.util.List<String> members) {
        Value[] lowered = new Value[members.size()];
        for (int index = 0; index < lowered.length; index++) {
            lowered[index] = of(members.get(index));
        }
        return list(lowered);
    }

    /** An empty record, to hang fields off with {@link #put}. */
    public static Value record() {
        Value value = new Value(RECORD);
        value.items = new Value[4];
        value.keys = new String[4];
        return value;
    }

    /**
     * A variant case: the case name, and the payload it carries — or {@code null} for a case that
     * carries none.
     */
    public static Value variant(String name, Value payload) {
        Value value = record().put("case", of(name));
        return payload == null ? value : value.put("value", payload);
    }

    /**
     * Add one field to this record.
     *
     * @param name the WIT field name, verbatim — hyphens and all
     * @param field what it holds
     * @return this record, so fields chain
     */
    public Value put(String name, Value field) {
        if (count == keys.length) {
            String[] grownKeys = new String[count * 2];
            Value[] grownItems = new Value[count * 2];
            System.arraycopy(keys, 0, grownKeys, 0, count);
            System.arraycopy(items, 0, grownItems, 0, count);
            keys = grownKeys;
            items = grownItems;
        }
        keys[count] = name;
        items[count] = field;
        count++;
        return this;
    }

    // -------------------------------------------------------------------------------------------
    // Reading
    // -------------------------------------------------------------------------------------------

    /** Which of the eight this is. */
    int tag() {
        return tag;
    }

    /** How many items a list holds, or how many fields a record has. */
    public int size() {
        return count;
    }

    /** Whether this is an {@code option} the host left out. */
    public boolean absent() {
        return tag == NONE;
    }

    /** One item of a list. */
    public Value at(int index) {
        expect(LIST, "a list");
        return items[index];
    }

    /** One field of a record, by the WIT field name. */
    public Value get(String name) {
        expect(RECORD, "a record");
        for (int index = 0; index < count; index++) {
            if (keys[index].equals(name)) {
                return items[index];
            }
        }
        throw new IllegalStateException("gg's answer carried no `" + name + "` field");
    }

    /** The field name at `index`, for the encoder. */
    String key(int index) {
        return keys[index];
    }

    /** The field value at `index`, for the encoder — by position, so two fields may share a name. */
    Value fieldAt(int index) {
        return items[index];
    }

    /** This value as text. */
    public String text() {
        expect(TEXT, "text");
        return text;
    }

    /** This value as text, or {@code null} when the host left it out. */
    public String optionalText() {
        return tag == NONE ? null : text();
    }

    /** This value as a whole number. */
    public long number() {
        expect(INT, "a whole number");
        return number;
    }

    /** This value as an {@code int}. */
    public int integer() {
        return (int) number();
    }

    /** This value as a double. */
    public double decimal() {
        expect(FLOAT, "a number");
        return decimal;
    }

    /** This value as a flag. */
    public boolean flag() {
        if (tag != TRUE && tag != FALSE) {
            throw new IllegalStateException("gg's answer is not a flag");
        }
        return tag == TRUE;
    }

    /** Fail with a sentence naming what arrived, rather than answering a zero. */
    private void expect(int wanted, String what) {
        if (tag != wanted) {
            throw new IllegalStateException("gg's answer is not " + what);
        }
    }
}
