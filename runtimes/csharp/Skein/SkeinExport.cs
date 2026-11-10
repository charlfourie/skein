// Skein C# runtime — the "skein.export" v1 file as typed C# objects.
// Format: docs/EXPORT.md. Reference implementation: src/shared/export/runtime.ts.
//
// Conditions and effects stay as their pre-compiled JSON trees (JsonObject);
// SkeinWorld evaluates them directly, so there is no expression parser here.

using System;
using System.Collections.Generic;

namespace Skein
{
    /// <summary>A value definition: template property, world variable or relationship.</summary>
    public class SkeinDef
    {
        /// <summary>"text", "number", "boolean", "enum", "entity" or "color".</summary>
        public string Type;
        /// <summary>double, bool, string or null.</summary>
        public object Default;
        public IReadOnlyList<string> Options = Array.Empty<string>();
        public IReadOnlyList<string> Labels = Array.Empty<string>();
        public string Template;
        public double? Min;
        public double? Max;
        public bool Integer;

        internal static void Fill(SkeinDef d, JsonObject o)
        {
            d.Type = o.Str("type") ?? "text";
            d.Default = o["default"];
            d.Options = Strings(o.Arr("options"));
            d.Labels = Strings(o.Arr("labels"));
            d.Template = o.Str("template");
            d.Min = o.Num("min");
            d.Max = o.Num("max");
            d.Integer = o.Bool("integer");
        }

        internal static SkeinDef Create(JsonObject o)
        {
            var d = new SkeinDef();
            Fill(d, o);
            return d;
        }

        internal static IReadOnlyList<string> Strings(List<object> list)
        {
            if (list == null) return Array.Empty<string>();
            var result = new List<string>(list.Count);
            foreach (var item in list) if (item is string s) result.Add(s);
            return result;
        }

        /// <summary>Display label for an enum option's technical name (falls back to the name).</summary>
        public string LabelOf(string option)
        {
            for (int i = 0; i < Options.Count; i++)
                if (Options[i] == option) return i < Labels.Count ? Labels[i] : option;
            return option;
        }
    }

    public sealed class SkeinProperty : SkeinDef
    {
        /// <summary>True when the property changes during play. Others are fixed design data.</summary>
        public bool State;
    }

    public sealed class SkeinTemplate
    {
        public string Name;     // technical name (the key)
        public string Id;
        public string DisplayName;
        public IReadOnlyDictionary<string, SkeinProperty> Properties;
    }

    public sealed class SkeinEntity
    {
        public string Name;     // technical name (the key)
        public string Id;
        public string DisplayName;
        public string Template;
        /// <summary>Starting values for every property, defaults applied.</summary>
        public IReadOnlyDictionary<string, object> Values;
    }

    public sealed class SkeinRelationship : SkeinDef
    {
        public string Key;      // "Character->Character.Trust"
        public string Name;
        public string From;
        public string To;
        /// <summary>Starting values that differ from Default: from → to → value.</summary>
        public IReadOnlyDictionary<string, IReadOnlyDictionary<string, object>> Values;
    }

    public sealed class SkeinTime
    {
        public IReadOnlyList<string> Phases = Array.Empty<string>();
        public IReadOnlyList<string> Labels = Array.Empty<string>();
        public int StartDay = 1;
        public string StartPhase;
        /// <summary>v3: minutes into the starting phase.</summary>
        public double StartMinute;
        /// <summary>Minutes in each phase (null in older files: 24 hours split evenly).</summary>
        public IReadOnlyList<double> Minutes;
        /// <summary>Minutes after midnight when the first phase begins.</summary>
        public double DayStart;

        public string LabelOf(string phase)
        {
            for (int i = 0; i < Phases.Count; i++)
                if (Phases[i] == phase) return i < Labels.Count ? Labels[i] : phase;
            return phase;
        }

        public int IndexOf(string phase)
        {
            for (int i = 0; i < Phases.Count; i++) if (Phases[i] == phase) return i;
            return -1;
        }
    }

    public sealed class SkeinRule
    {
        public string Id;
        public string Name;
        /// <summary>"phase" or "day".</summary>
        public string Trigger;
        /// <summary>For "phase" rules: the phase that triggers it, or null for every phase.</summary>
        public string Phase;
        /// <summary>Template to run once per entity of, with $self bound; or null to run once.</summary>
        public string ForEach;
        /// <summary>v2: only run while this flow (id) is being played; null = always.</summary>
        public string Flow;
        public JsonObject When;
        public JsonObject Effects;
    }

    public enum SkeinNodeType { Dialogue, Condition, Instruction, Hub, Jump, Call }

    public sealed class SkeinNode
    {
        public string Id;
        public SkeinNodeType Type;
        public bool IsStart;
        public bool IsEnd;
        /// <summary>The node is only available while this holds (null = always).</summary>
        public JsonObject Requires;
        /// <summary>Applied when the story enters the node.</summary>
        public JsonObject Effects;
        /// <summary>v2: count how many times the story enters this node.</summary>
        public bool Count;
        /// <summary>v2: the node's tag in Skein (Seen.Tag / Visits.Tag), or null.</summary>
        public string Tag;

        // dialogue
        public string Speaker;
        public string Text;
        public string MenuText;
        // condition
        public JsonObject Condition;
        public string OnTrue;
        public string OnFalse;
        // instruction
        public JsonObject Instruction;
        // hub
        public string Label;
        // dialogue / instruction / hub
        public IReadOnlyList<string> Next = Array.Empty<string>();
        // jump
        public string JumpTo;
        /// <summary>v2 jump: continue at the start of this flow (a hand-off) instead of JumpTo.</summary>
        public string JumpFlow;
        /// <summary>v2 call: the flow to play before continuing with Next.</summary>
        public string CallFlow;
        /// <summary>v3: minutes that pass when the story enters this node (0 = none).</summary>
        public double Takes;
        /// <summary>v3: the node's activity name, if any.</summary>
        public string Activity;
    }

    public sealed class SkeinFlow
    {
        public string Id;
        public string Name;
        public IReadOnlyList<string> Start = Array.Empty<string>();
        public IReadOnlyDictionary<string, SkeinNode> Nodes;
    }

    /// <summary>A parsed "skein.export" file.</summary>
    public sealed class SkeinExport
    {
        public const string Format = "skein.export";
        /// <summary>The newest format version this runtime reads (1 and 2).</summary>
        public const int Version = 3;

        public string ProjectId;
        public string ProjectName;
        public IReadOnlyDictionary<string, SkeinTemplate> Templates;
        public IReadOnlyDictionary<string, SkeinEntity> Entities;
        public IReadOnlyDictionary<string, SkeinDef> Variables;
        public IReadOnlyDictionary<string, SkeinRelationship> Relationships;
        public SkeinTime Time;
        public IReadOnlyList<SkeinRule> Rules;
        /// <summary>Flows by id, in file order.</summary>
        public IReadOnlyDictionary<string, SkeinFlow> Flows;
        /// <summary>Flow ids in file order (used when looking a flow up by name).</summary>
        public IReadOnlyList<string> FlowOrder;

        public static SkeinExport Parse(string json)
        {
            if (!(SkeinJson.Parse(json) is JsonObject root)) throw new SkeinFormatException("A Skein export must be a JSON object.");
            if (root.Str("format") != Format)
                throw new SkeinFormatException($"Not a Skein game export (expected format \"{Format}\"). Use File › Export for Game Engine in Skein.");
            var version = root.Num("version") ?? 0;
            if (version > Version)
                throw new SkeinFormatException($"This export is version {version}, but this runtime reads version {Version}. Update the Skein runtime.");

            var x = new SkeinExport();
            var project = root.Obj("project") ?? new JsonObject();
            x.ProjectId = project.Str("id");
            x.ProjectName = project.Str("name");

            var templates = new Dictionary<string, SkeinTemplate>(StringComparer.Ordinal);
            foreach (var kv in root.Obj("templates") ?? new JsonObject())
            {
                var o = (JsonObject)kv.Value;
                var props = new Dictionary<string, SkeinProperty>(StringComparer.Ordinal);
                foreach (var p in o.Obj("properties") ?? new JsonObject())
                {
                    var po = (JsonObject)p.Value;
                    var prop = new SkeinProperty();
                    SkeinDef.Fill(prop, po);
                    prop.State = po.Bool("state");
                    props[p.Key] = prop;
                }
                templates[kv.Key] = new SkeinTemplate { Name = kv.Key, Id = o.Str("id"), DisplayName = o.Str("name"), Properties = props };
            }
            x.Templates = templates;

            var entities = new Dictionary<string, SkeinEntity>(StringComparer.Ordinal);
            foreach (var kv in root.Obj("entities") ?? new JsonObject())
            {
                var o = (JsonObject)kv.Value;
                var values = new Dictionary<string, object>(StringComparer.Ordinal);
                foreach (var v in o.Obj("values") ?? new JsonObject()) values[v.Key] = v.Value;
                entities[kv.Key] = new SkeinEntity { Name = kv.Key, Id = o.Str("id"), DisplayName = o.Str("name"), Template = o.Str("template"), Values = values };
            }
            x.Entities = entities;

            var state = root.Obj("state") ?? new JsonObject();

            var variables = new Dictionary<string, SkeinDef>(StringComparer.Ordinal);
            foreach (var kv in state.Obj("variables") ?? new JsonObject()) variables[kv.Key] = SkeinDef.Create((JsonObject)kv.Value);
            x.Variables = variables;

            var rels = new Dictionary<string, SkeinRelationship>(StringComparer.Ordinal);
            foreach (var kv in state.Obj("relationships") ?? new JsonObject())
            {
                var o = (JsonObject)kv.Value;
                var r = new SkeinRelationship { Key = kv.Key, Name = o.Str("name"), From = o.Str("from"), To = o.Str("to") };
                SkeinDef.Fill(r, o);
                var values = new Dictionary<string, IReadOnlyDictionary<string, object>>(StringComparer.Ordinal);
                foreach (var from in o.Obj("values") ?? new JsonObject())
                {
                    var inner = new Dictionary<string, object>(StringComparer.Ordinal);
                    foreach (var to in (JsonObject)from.Value) inner[to.Key] = to.Value;
                    values[from.Key] = inner;
                }
                r.Values = values;
                rels[kv.Key] = r;
            }
            x.Relationships = rels;

            var time = state.Obj("time") ?? new JsonObject();
            var start = time.Obj("start") ?? new JsonObject();
            x.Time = new SkeinTime
            {
                Phases = SkeinDef.Strings(time.Arr("phases")),
                Labels = SkeinDef.Strings(time.Arr("labels")),
                StartDay = (int)(start.Num("day") ?? 1),
                StartPhase = start.Str("phase"),
                StartMinute = start.Num("minute") ?? 0,
                Minutes = time.Arr("minutes")?.ConvertAll(v => v is double d ? d : 0),
                DayStart = time.Num("dayStart") ?? 0
            };

            var rules = new List<SkeinRule>();
            foreach (var item in state.Arr("rules") ?? new List<object>())
            {
                var o = (JsonObject)item;
                rules.Add(new SkeinRule
                {
                    Id = o.Str("id"),
                    Name = o.Str("name"),
                    Trigger = o.Str("trigger"),
                    Phase = o.Str("phase"),
                    ForEach = o.Str("forEach"),
                    Flow = o.Str("flow"),
                    When = o.Obj("when"),
                    Effects = o.Obj("effects")
                });
            }
            x.Rules = rules;

            var flows = new Dictionary<string, SkeinFlow>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var kv in root.Obj("flows") ?? new JsonObject())
            {
                var o = (JsonObject)kv.Value;
                var nodes = new Dictionary<string, SkeinNode>(StringComparer.Ordinal);
                foreach (var n in o.Obj("nodes") ?? new JsonObject()) nodes[n.Key] = ParseNode((JsonObject)n.Value);
                flows[kv.Key] = new SkeinFlow { Id = o.Str("id") ?? kv.Key, Name = o.Str("name"), Start = SkeinDef.Strings(o.Arr("start")), Nodes = nodes };
                order.Add(kv.Key);
            }
            x.Flows = flows;
            x.FlowOrder = order;
            return x;
        }

        static SkeinNode ParseNode(JsonObject o)
        {
            var n = new SkeinNode
            {
                Id = o.Str("id"),
                IsStart = o.Bool("start"),
                IsEnd = o.Bool("end"),
                Requires = o.Obj("requires"),
                Effects = o.Obj("effects"),
                Count = o.Bool("count"),
                Tag = o.Str("tag"),
                Takes = o.Num("takes") ?? 0,
                Activity = o.Str("activity"),
                Next = SkeinDef.Strings(o.Arr("next"))
            };
            switch (o.Str("type"))
            {
                case "dialogue":
                    n.Type = SkeinNodeType.Dialogue;
                    n.Speaker = o.Str("speaker");
                    n.Text = o.Str("text") ?? "";
                    n.MenuText = o.Str("menuText");
                    break;
                case "condition":
                    n.Type = SkeinNodeType.Condition;
                    n.Condition = o.Obj("condition");
                    n.OnTrue = o.Str("onTrue");
                    n.OnFalse = o.Str("onFalse");
                    break;
                case "instruction":
                    n.Type = SkeinNodeType.Instruction;
                    n.Instruction = o.Obj("instruction");
                    break;
                case "hub":
                    n.Type = SkeinNodeType.Hub;
                    n.Label = o.Str("label") ?? "";
                    break;
                case "jump":
                    n.Type = SkeinNodeType.Jump;
                    n.JumpTo = o.Str("jumpTo");
                    n.JumpFlow = o.Str("jumpFlow");
                    break;
                case "call":
                    n.Type = SkeinNodeType.Call;
                    n.CallFlow = o.Str("flow");
                    break;
                default:
                    throw new SkeinFormatException($"Unknown node type \"{o.Str("type")}\" on node {o.Str("id")}.");
            }
            return n;
        }

        /// <summary>A node by its tag (any flow), or null.</summary>
        public SkeinNode FindTagged(string tag, out SkeinFlow flow)
        {
            foreach (var id in FlowOrder)
                foreach (var n in Flows[id].Nodes.Values)
                    if (n.Tag == tag) { flow = Flows[id]; return n; }
            flow = null;
            return null;
        }

        /// <summary>A flow by id, or else by name (first match in file order). Null if none.</summary>
        public SkeinFlow FindFlow(string idOrName)
        {
            if (idOrName == null) return null;
            if (Flows.TryGetValue(idOrName, out var f)) return f;
            foreach (var id in FlowOrder) if (Flows[id].Name == idOrName) return Flows[id];
            return null;
        }
    }
}
