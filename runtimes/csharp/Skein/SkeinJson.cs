// Skein C# runtime — minimal JSON reader/writer.
// Part of the dependency-free port of src/shared/export/runtime.ts (see docs/EXPORT.md).
// C# 9 / .NET Standard 2.1, so it runs in Unity, Godot .NET and plain .NET alike.
//
// Objects parse to JsonObject (insertion-ordered), arrays to List<object>,
// numbers to double, plus string, bool and null.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Skein
{
    /// <summary>A JSON object that keeps keys in file order.</summary>
    public sealed class JsonObject : IEnumerable<KeyValuePair<string, object>>
    {
        readonly Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
        readonly List<string> keys = new List<string>();

        public int Count => keys.Count;
        public IReadOnlyList<string> Keys => keys;

        public object this[string key]
        {
            get => map.TryGetValue(key, out var v) ? v : null;
            set
            {
                if (!map.ContainsKey(key)) keys.Add(key);
                map[key] = value;
            }
        }

        public bool Has(string key) => map.ContainsKey(key);
        public bool TryGet(string key, out object value) => map.TryGetValue(key, out value);

        public JsonObject Obj(string key) => this[key] as JsonObject;
        public List<object> Arr(string key) => this[key] as List<object>;
        public string Str(string key) => this[key] as string;
        public double? Num(string key) => this[key] is double d ? d : (double?)null;
        public bool Bool(string key) => this[key] is bool b && b;

        public IEnumerator<KeyValuePair<string, object>> GetEnumerator()
        {
            foreach (var k in keys) yield return new KeyValuePair<string, object>(k, map[k]);
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public sealed class SkeinFormatException : Exception
    {
        public SkeinFormatException(string message) : base(message) { }
    }

    public static class SkeinJson
    {
        public static object Parse(string text)
        {
            if (text == null) throw new ArgumentNullException(nameof(text));
            var p = new Parser(text);
            p.SkipWs();
            var value = p.Value();
            p.SkipWs();
            if (!p.AtEnd) throw p.Error("Unexpected text after the JSON value");
            return value;
        }

        sealed class Parser
        {
            readonly string s;
            int i;

            public Parser(string text)
            {
                s = text;
                // Skip a UTF-8 byte order mark if the file has one.
                if (s.Length > 0 && s[0] == '﻿') i = 1;
            }

            public bool AtEnd => i >= s.Length;

            public SkeinFormatException Error(string message)
            {
                int line = 1, col = 1;
                for (int k = 0; k < i && k < s.Length; k++)
                {
                    if (s[k] == '\n') { line++; col = 1; }
                    else col++;
                }
                return new SkeinFormatException($"{message} (line {line}, column {col}).");
            }

            public void SkipWs()
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
            }

            public object Value()
            {
                if (AtEnd) throw Error("Unexpected end of JSON");
                char c = s[i];
                switch (c)
                {
                    case '{': return Object();
                    case '[': return Array();
                    case '"': return String();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return Number();
                        throw Error($"Unexpected character '{c}'");
                }
            }

            void Expect(string word)
            {
                if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw Error($"Expected '{word}'");
                i += word.Length;
            }

            JsonObject Object()
            {
                var obj = new JsonObject();
                i++; // {
                SkipWs();
                if (i < s.Length && s[i] == '}') { i++; return obj; }
                while (true)
                {
                    SkipWs();
                    if (AtEnd || s[i] != '"') throw Error("Expected a property name");
                    var key = String();
                    SkipWs();
                    if (AtEnd || s[i] != ':') throw Error("Expected ':'");
                    i++;
                    SkipWs();
                    obj[key] = Value();
                    SkipWs();
                    if (AtEnd) throw Error("Unexpected end of JSON in an object");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return obj; }
                    throw Error("Expected ',' or '}'");
                }
            }

            List<object> Array()
            {
                var list = new List<object>();
                i++; // [
                SkipWs();
                if (i < s.Length && s[i] == ']') { i++; return list; }
                while (true)
                {
                    SkipWs();
                    list.Add(Value());
                    SkipWs();
                    if (AtEnd) throw Error("Unexpected end of JSON in an array");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return list; }
                    throw Error("Expected ',' or ']'");
                }
            }

            string String()
            {
                i++; // opening quote
                var sb = new StringBuilder();
                while (true)
                {
                    if (AtEnd) throw Error("Unterminated string");
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (AtEnd) throw Error("Unterminated string");
                    char e = s[i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw Error("Bad \\u escape");
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            i += 4;
                            break;
                        default: throw Error($"Bad escape '\\{e}'");
                    }
                }
            }

            double Number()
            {
                int start = i;
                if (s[i] == '-') i++;
                while (i < s.Length && "0123456789+-.eE".IndexOf(s[i]) >= 0) i++;
                var token = s.Substring(start, i - start);
                if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                {
                    i = start;
                    throw Error($"Bad number '{token}'");
                }
                return d;
            }
        }

        // --- Writing (used for save games) -----------------------------------------

        public static string Stringify(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case string str: WriteString(sb, str); break;
                case double d: sb.Append(FormatNumber(d)); break;
                case float f: sb.Append(FormatNumber(f)); break;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); break;
                case JsonObject o:
                    sb.Append('{');
                    bool firstO = true;
                    foreach (var kv in o)
                    {
                        if (!firstO) sb.Append(',');
                        firstO = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                case IDictionary<string, object> dict:
                    sb.Append('{');
                    bool firstD = true;
                    foreach (var kv in dict)
                    {
                        if (!firstD) sb.Append(',');
                        firstD = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                case IEnumerable list:
                    sb.Append('[');
                    bool firstL = true;
                    foreach (var item in list)
                    {
                        if (!firstL) sb.Append(',');
                        firstL = false;
                        Write(sb, item);
                    }
                    sb.Append(']');
                    break;
                default:
                    WriteString(sb, v.ToString());
                    break;
            }
        }

        /// <summary>Formats a number the way JavaScript's JSON.stringify does for typical values.</summary>
        public static string FormatNumber(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
            if (d == 0) return "0"; // also turns -0 into 0
            if (Math.Abs(d) < 1e21 && d == Math.Floor(d)) return d.ToString("0", CultureInfo.InvariantCulture);
            return d.ToString("R", CultureInfo.InvariantCulture);
        }

        static void WriteString(StringBuilder sb, string str)
        {
            sb.Append('"');
            foreach (char c in str)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
