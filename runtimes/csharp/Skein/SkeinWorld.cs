// Skein C# runtime — world state, expressions, time and rules.
// A line-for-line port of SkeinWorld in src/shared/export/runtime.ts; docs/EXPORT.md
// describes the same rules in prose. Values are double, bool, string or null, and
// they follow the reference runtime's JavaScript semantics (truthiness,
// Number() coercion, strict equality, Math.round) so both runtimes agree exactly.

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Skein
{
    /// <summary>Everything needed to restore a world: the current time plus every value that changed.</summary>
    public sealed class SkeinSave
    {
        /// <summary>State key → value, sorted by key.</summary>
        public SortedDictionary<string, object> Changes = new SortedDictionary<string, object>(StringComparer.Ordinal);
        public int Day = 1;
        public string Phase;

        public string ToJson()
        {
            var o = new JsonObject();
            var changes = new JsonObject();
            foreach (var kv in Changes) changes[kv.Key] = kv.Value;
            o["changes"] = changes;
            o["day"] = (double)Day;
            o["phase"] = Phase;
            return SkeinJson.Stringify(o);
        }

        public static SkeinSave FromJson(string json)
        {
            if (!(SkeinJson.Parse(json) is JsonObject o)) throw new SkeinFormatException("A Skein save must be a JSON object.");
            var save = new SkeinSave { Day = (int)(o.Num("day") ?? 1), Phase = o.Str("phase") };
            foreach (var kv in o.Obj("changes") ?? new JsonObject()) save.Changes[kv.Key] = kv.Value;
            return save;
        }
    }

    /// <summary>JavaScript-compatible value semantics used by the reference runtime.</summary>
    public static class SkeinValue
    {
        /// <summary>JavaScript Boolean(v).</summary>
        public static bool Truthy(object v)
        {
            switch (v)
            {
                case null: return false;
                case bool b: return b;
                case double d: return d != 0 && !double.IsNaN(d);
                case string s: return s.Length > 0;
                default: return true;
            }
        }

        /// <summary>JavaScript <c>Number(v) || 0</c>.</summary>
        public static double ToNumber(object v)
        {
            double d;
            switch (v)
            {
                case null: return 0;
                case bool b: return b ? 1 : 0;
                case double x: d = x; break;
                case string s: d = ParseJsNumber(s); break;
                default: return 0;
            }
            return double.IsNaN(d) ? 0 : d;
        }

        /// <summary>The reference runtime's <c>n()</c>: numbers as-is, anything else via Number(v) || 0.</summary>
        internal static double Numeric(object v) => v is double d ? d : ToNumber(v);

        static double ParseJsNumber(string s)
        {
            var t = s.Trim();
            if (t.Length == 0) return 0;
            if (t == "Infinity" || t == "+Infinity") return double.PositiveInfinity;
            if (t == "-Infinity") return double.NegativeInfinity;
            if (t.Length > 2 && t[0] == '0' && (t[1] == 'x' || t[1] == 'X'))
                return long.TryParse(t.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hex) ? hex : double.NaN;
            foreach (char c in t)
                if (!(char.IsDigit(c) || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-')) return double.NaN;
            return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
        }

        /// <summary>JavaScript strict equality (===) for export values.</summary>
        public static bool StrictEquals(object a, object b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (a is double da && b is double db) return da == db;
            if (a is string sa && b is string sb) return string.Equals(sa, sb, StringComparison.Ordinal);
            if (a is bool ba && b is bool bb) return ba == bb;
            return false;
        }

        /// <summary>JavaScript String(v).</summary>
        public static string ToJsString(object v)
        {
            switch (v)
            {
                case null: return "null";
                case bool b: return b ? "true" : "false";
                case double d: return SkeinJson.FormatNumber(d);
                case string s: return s;
                default: return v.ToString();
            }
        }

        /// <summary>JavaScript Math.round (halves round towards +∞).</summary>
        public static double JsRound(double v) => Math.Floor(v + 0.5);
    }

    public sealed class SkeinWorld
    {
        public readonly SkeinExport Data;
        /// <summary>Only values that changed since the start; everything else reads through to the export.</summary>
        public readonly Dictionary<string, object> Changes = new Dictionary<string, object>(StringComparer.Ordinal);
        public int Day;
        public int PhaseIndex;
        /// <summary>Trace of time and rule activity. Clear it whenever you like.</summary>
        public readonly List<string> Log = new List<string>();
        /// <summary>v2: the flow being played right now (set by SkeinStory), for rules limited to one flow.</summary>
        public string Playing;

        /// <summary>Raised after any state value is written: (key, new value).</summary>
        public event Action<string, object> Changed;
        /// <summary>Raised after each phase step, once the step's rules have run.</summary>
        public event Action<SkeinWorld> TimeAdvanced;

        public SkeinWorld(SkeinExport data, SkeinSave saved = null)
        {
            Data = data ?? throw new ArgumentNullException(nameof(data));
            var phases = data.Time.Phases;
            Day = data.Time.StartDay;
            PhaseIndex = Math.Max(0, data.Time.IndexOf(data.Time.StartPhase ?? (phases.Count > 0 ? phases[0] : null)));
            if (saved != null)
            {
                foreach (var kv in saved.Changes) Changes[kv.Key] = kv.Value;
                Day = saved.Day;
                PhaseIndex = Math.Max(0, data.Time.IndexOf(saved.Phase ?? (phases.Count > 0 ? phases[0] : null)));
            }
        }

        /// <summary>The current phase's technical name, or null when the project has no phases.</summary>
        public string Phase => PhaseIndex >= 0 && PhaseIndex < Data.Time.Phases.Count ? Data.Time.Phases[PhaseIndex] : null;

        /// <summary>The current phase's display label.</summary>
        public string PhaseLabel => Phase == null ? null : Data.Time.LabelOf(Phase);

        public SkeinSave Save()
        {
            var save = new SkeinSave { Day = Day, Phase = Phase };
            foreach (var kv in Changes) save.Changes[kv.Key] = kv.Value;
            return save;
        }

        // --- Convenience accessors ---------------------------------------------------

        /// <summary>A world variable, e.g. GetVar("World.StormRaging").</summary>
        public object GetVar(string name) => ReadKey("var", name, null, null, null);
        public void SetVar(string name, object value) => WriteKey("var", name, null, null, null, Normalize(value));

        /// <summary>An entity property, e.g. GetProp("Keeper", "Mood").</summary>
        public object GetProp(string entity, string prop) => ReadKey("prop", null, entity, prop, null);
        public void SetProp(string entity, string prop, object value) => WriteKey("prop", null, entity, prop, null, Normalize(value));

        /// <summary>A relationship value. <paramref name="relationship"/> is its key ("Character->Character.Trust") or its name ("Trust").</summary>
        public object GetRel(string relationship, string from, string to) => ReadKey("rel", RelKey(relationship), from, null, to);
        public void SetRel(string relationship, string from, string to, object value) => WriteKey("rel", RelKey(relationship), from, null, to, Normalize(value));

        public bool GetBool(string variable) => SkeinValue.Truthy(GetVar(variable));
        public double GetNumber(string variable) => SkeinValue.ToNumber(GetVar(variable));

        string RelKey(string relationship)
        {
            if (relationship == null || Data.Relationships.ContainsKey(relationship)) return relationship;
            foreach (var r in Data.Relationships.Values) if (r.Name == relationship) return r.Key;
            return relationship;
        }

        /// <summary>Accepts int/float/long etc. from game code and stores them as double, like the export.</summary>
        static object Normalize(object v)
        {
            switch (v)
            {
                case null: return null;
                case double _: return v;
                case bool _: return v;
                case string _: return v;
                case int i: return (double)i;
                case long l: return (double)l;
                case float f: return (double)f;
                case decimal m: return (double)m;
                default: return v.ToString();
            }
        }

        // --- Reading and writing state -------------------------------------------------

        /// <summary>The key a piece of state is stored under: "var:World.Storm", "prop:Keeper.Mood", "rel:Character->Character.Trust:Keeper:Stranger".</summary>
        public static string Key(string kind, string name, string entity, string prop, string to)
        {
            switch (kind)
            {
                case "var": return "var:" + name;
                case "prop": return "prop:" + entity + "." + prop;
                case "rel": return "rel:" + name + ":" + entity + ":" + to;
                case "visit": return "visit:" + name;
                default: return "time:" + name;
            }
        }

        object ReadKey(string kind, string name, string entity, string prop, string to)
        {
            var k = Key(kind, name, entity, prop, to);
            if (Changes.TryGetValue(k, out var changed)) return changed;
            switch (kind)
            {
                case "var":
                    return name != null && Data.Variables.TryGetValue(name, out var def) ? def.Default : null;
                case "prop":
                    if (entity != null && Data.Entities.TryGetValue(entity, out var e) && prop != null && e.Values.TryGetValue(prop, out var pv)) return pv;
                    return null;
                case "rel":
                    if (name == null || !Data.Relationships.TryGetValue(name, out var r)) return null;
                    if (entity != null && r.Values.TryGetValue(entity, out var row) && to != null && row.TryGetValue(to, out var rv) && rv != null) return rv;
                    return r.Default;
            }
            return null;
        }

        SkeinDef Definition(string kind, string name, string entity, string prop)
        {
            switch (kind)
            {
                case "var": return name != null && Data.Variables.TryGetValue(name, out var v) ? v : null;
                case "rel": return name != null && Data.Relationships.TryGetValue(name, out var r) ? r : null;
                case "prop":
                    if (entity == null || !Data.Entities.TryGetValue(entity, out var e)) return null;
                    if (e.Template == null || !Data.Templates.TryGetValue(e.Template, out var t)) return null;
                    return prop != null && t.Properties.TryGetValue(prop, out var p) ? p : null;
            }
            return null;
        }

        void WriteKey(string kind, string name, string entity, string prop, string to, object value)
        {
            var def = Definition(kind, name, entity, prop);
            var v = value;
            if (def != null && def.Type == "number" && v is double d)
            {
                if (def.Integer) d = SkeinValue.JsRound(d);
                if (def.Min.HasValue) d = Math.Max(def.Min.Value, d);
                if (def.Max.HasValue) d = Math.Min(def.Max.Value, d);
                v = d;
            }
            var k = Key(kind, name, entity, prop, to);
            Changes[k] = v;
            Changed?.Invoke(k, v);
        }

        /// <summary>Read a state path ({ "get": … }), with $self bound to <paramref name="self"/>.</summary>
        public object Read(JsonObject path, string self = null)
        {
            switch (path.Str("get"))
            {
                case "time": return path.Str("field") == "day" ? (object)(double)Day : Phase;
                case "visit": return Visits(path.Str("node"));
                case "var": return ReadKey("var", path.Str("var"), null, null, null);
                case "prop": return ReadKey("prop", null, Self(path.Str("entity"), self), path.Str("prop"), null);
                case "rel": return ReadKey("rel", path.Str("rel"), Self(path.Str("from"), self), null, Self(path.Str("to"), self));
            }
            return null;
        }

        /// <summary>Write a state path. Numbers are clamped to min/max and rounded when the definition is whole-number.</summary>
        public void Write(JsonObject path, object value, string self = null)
        {
            switch (path.Str("get"))
            {
                case "time": return; // time moves by advancing
                case "visit": return; // visits count themselves
                case "var": WriteKey("var", path.Str("var"), null, null, null, value); return;
                case "prop": WriteKey("prop", null, Self(path.Str("entity"), self), path.Str("prop"), null, value); return;
                case "rel": WriteKey("rel", path.Str("rel"), Self(path.Str("from"), self), null, Self(path.Str("to"), self), value); return;
            }
        }

        /// <summary>v2: how many times the story has entered a counted node.</summary>
        public double Visits(string nodeId) =>
            nodeId != null && Changes.TryGetValue(Key("visit", nodeId, null, null, null), out var v) && v is double d ? d : 0;

        /// <summary>v2: visits of the node with this tag (Visits.Tag in Skein), or 0.</summary>
        public double VisitsOf(string tag) => Data.FindTagged(tag, out _) is SkeinNode n ? Visits(n.Id) : 0;

        /// <summary>v2: Seen.Tag in Skein.</summary>
        public bool Seen(string tag) => VisitsOf(tag) > 0;

        internal void CountVisit(string nodeId)
        {
            var k = Key("visit", nodeId, null, null, null);
            Changes[k] = Visits(nodeId) + 1;
            Changed?.Invoke(k, Changes[k]);
        }

        static string Self(string name, string self) => name == "$self" ? (self ?? "$self") : name;

        // --- Expressions -------------------------------------------------------------

        public object Evaluate(JsonObject e, string self = null)
        {
            if (e == null) return null;
            if (e.Has("lit")) return e["lit"];
            if (e.Has("get")) return Read(e, self);
            if (e.Has("not")) return !SkeinValue.Truthy(Evaluate(e.Obj("not"), self));
            if (e.Has("neg")) return -SkeinValue.ToNumber(Evaluate(e.Obj("neg"), self));

            var op = e.Str("op");
            if (op == "and") return SkeinValue.Truthy(Evaluate(e.Obj("a"), self)) && SkeinValue.Truthy(Evaluate(e.Obj("b"), self));
            if (op == "or") return SkeinValue.Truthy(Evaluate(e.Obj("a"), self)) || SkeinValue.Truthy(Evaluate(e.Obj("b"), self));

            var a = Evaluate(e.Obj("a"), self);
            var b = Evaluate(e.Obj("b"), self);
            switch (op)
            {
                case "==": return SkeinValue.StrictEquals(a, b);
                case "!=": return !SkeinValue.StrictEquals(a, b);
                case "<": return SkeinValue.Numeric(a) < SkeinValue.Numeric(b);
                case "<=": return SkeinValue.Numeric(a) <= SkeinValue.Numeric(b);
                case ">": return SkeinValue.Numeric(a) > SkeinValue.Numeric(b);
                case ">=": return SkeinValue.Numeric(a) >= SkeinValue.Numeric(b);
                case "phase<": return PhasePos(a) < PhasePos(b);
                case "phase<=": return PhasePos(a) <= PhasePos(b);
                case "phase>": return PhasePos(a) > PhasePos(b);
                case "phase>=": return PhasePos(a) >= PhasePos(b);
                case "+": return SkeinValue.Numeric(a) + SkeinValue.Numeric(b);
                case "-": return SkeinValue.Numeric(a) - SkeinValue.Numeric(b);
                case "*": return SkeinValue.Numeric(a) * SkeinValue.Numeric(b);
                case "/":
                    var nb = SkeinValue.Numeric(b);
                    return nb == 0 ? 0.0 : SkeinValue.Numeric(a) / nb;
            }
            return null;
        }

        int PhasePos(object v) => Data.Time.IndexOf(SkeinValue.ToJsString(v));

        /// <summary>A condition ({ "expr": … }). A missing condition always holds.</summary>
        public bool Check(JsonObject condition, string self = null) =>
            condition == null || SkeinValue.Truthy(Evaluate(condition.Obj("expr"), self));

        /// <summary>Run effects ({ "do": [ … ] }) in order.</summary>
        public void Run(JsonObject effects, string self = null)
        {
            var list = effects?.Arr("do");
            if (list == null) return;
            foreach (var s in list) Execute((JsonObject)s, self);
        }

        public void Execute(JsonObject s, string self = null)
        {
            if (s.Has("advance")) { Advance((int)(s.Num("advance") ?? 0)); return; }
            if (s.Has("advanceTo")) { AdvanceTo(s.Str("advanceTo"), s.Bool("stay")); return; }
            var target = s.Obj("set");
            if (target == null) return;
            var value = Evaluate(s.Obj("value"), self);
            var op = s.Str("op");
            if (op == "=") { Write(target, value, self); return; }
            var cur = SkeinValue.ToNumber(Read(target, self));
            var delta = SkeinValue.ToNumber(value);
            Write(target, op == "+=" ? cur + delta : cur - delta, self);
        }

        // --- Time and rules ------------------------------------------------------------

        /// <summary>Move forward <paramref name="count"/> phases. Each phase that begins runs its rules; wrapping past the last phase starts a new day.</summary>
        public void Advance(int count = 1)
        {
            var phases = Data.Time.Phases;
            if (phases.Count == 0) return;
            for (int i = 0; i < count; i++)
            {
                PhaseIndex = (PhaseIndex + 1) % phases.Count;
                bool newDay = PhaseIndex == 0;
                if (newDay) Day += 1;
                Log.Add($"Time → Day {Day}, {Phase}");
                if (newDay) RunRules("day");
                RunRules("phase");
                TimeAdvanced?.Invoke(this);
            }
        }

        /// <summary>
        /// Advance to the next time <paramref name="phase"/> begins: always at least one phase forward,
        /// so a whole day when it's already that phase. With <paramref name="stay"/> (v2, "advance until"),
        /// do nothing when it's already that phase.
        /// </summary>
        public void AdvanceTo(string phase, bool stay = false)
        {
            var phases = Data.Time.Phases;
            int target = Data.Time.IndexOf(phase);
            if (target < 0) return;
            if (stay && target == PhaseIndex) return;
            Advance(((target - PhaseIndex + phases.Count - 1) % phases.Count) + 1);
        }

        void RunRules(string trigger)
        {
            foreach (var rule in Data.Rules)
            {
                if (rule.Trigger != trigger) continue;
                if (!string.IsNullOrEmpty(rule.Flow) && rule.Flow != Playing) continue;
                if (trigger == "phase" && !string.IsNullOrEmpty(rule.Phase) && rule.Phase != Phase) continue;
                var selves = new List<string>();
                if (!string.IsNullOrEmpty(rule.ForEach))
                {
                    foreach (var e in Data.Entities.Values) if (e.Template == rule.ForEach) selves.Add(e.Name);
                    selves.Sort((x, y) => string.CompareOrdinal(Data.Entities[x].Id, Data.Entities[y].Id));
                }
                else selves.Add(null);

                foreach (var self in selves)
                {
                    if (!Check(rule.When, self)) continue;
                    Run(rule.Effects, self);
                    Log.Add(self != null ? $"Rule “{rule.Name}” for {self}" : $"Rule “{rule.Name}”");
                }
            }
        }
    }
}
