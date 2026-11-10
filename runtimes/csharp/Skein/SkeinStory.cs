// Skein C# runtime — plays one flow as a sequence of beats.
// Port of SkeinStory in src/shared/export/runtime.ts.
//
//   var data  = SkeinExport.Parse(json);
//   var world = new SkeinWorld(data);
//   var story = new SkeinStory(world, "Arrival");      // flow id or name
//   var beat  = story.Start();
//   while (beat.Kind != SkeinBeatKind.End) {
//       Show(beat);
//       beat = story.Choose(PickIndex(beat.Choices));
//   }

using System;
using System.Collections.Generic;

namespace Skein
{
    public sealed class SkeinChoice
    {
        public int Index;
        public string Node;
        /// <summary>What to show the player: the target's choice text, its line, or a hub's label.</summary>
        public string Text;
    }

    public enum SkeinBeatKind
    {
        /// <summary>A dialogue line. One choice means "continue"; several mean the player picks; none means the story ends after it.</summary>
        Line,
        /// <summary>A hub with several available paths: the player picks.</summary>
        Choice,
        End
    }

    public sealed class SkeinBeat
    {
        public SkeinBeatKind Kind;
        /// <summary>The node this beat came from (for End, the last node reached, or null).</summary>
        public SkeinNode Node;
        /// <summary>Line beats: the speaking entity's technical name, or null for narration.</summary>
        public string Speaker;
        /// <summary>Line beats: the line.</summary>
        public string Text;
        public IReadOnlyList<SkeinChoice> Choices = Array.Empty<SkeinChoice>();

        /// <summary>True for a line with exactly one way on (show a "continue" prompt).</summary>
        public bool IsContinue => Kind == SkeinBeatKind.Line && Choices.Count == 1;
        /// <summary>True when the player has to pick between several options.</summary>
        public bool IsChoice => Choices.Count > 1;
    }

    public sealed class SkeinStory
    {
        const int MaxAutoSteps = 10000;
        /// <summary>How deeply Call nodes may nest before the story gives up.</summary>
        public const int MaxCallDepth = 100;

        public readonly SkeinWorld World;
        /// <summary>The flow being played right now: changes on a hand-off jump or while a Call node runs another flow.</summary>
        public SkeinFlow Flow { get; private set; }
        readonly List<(SkeinFlow flow, SkeinNode node)> calls = new List<(SkeinFlow, SkeinNode)>();
        /// <summary>v2: how many Call nodes are waiting for their flow to end.</summary>
        public int CallDepth => calls.Count;
        public SkeinNode Current { get; private set; }
        List<SkeinChoice> pending = new List<SkeinChoice>();

        /// <summary>Raised for every node the story enters, including ones it passes through automatically.</summary>
        public event Action<SkeinNode> Entered;

        public SkeinStory(SkeinWorld world, string flowIdOrName)
        {
            World = world ?? throw new ArgumentNullException(nameof(world));
            Flow = world.Data.FindFlow(flowIdOrName) ?? throw new ArgumentException($"No flow “{flowIdOrName}” in this export.", nameof(flowIdOrName));
        }

        /// <summary>Begin at the first available start node (or a given node).</summary>
        public SkeinBeat Start(string nodeId = null)
        {
            World.Playing = Flow.Id;
            var id = nodeId ?? FirstStart();
            return id != null ? Enter(id) : End(null);
        }

        string FirstStart()
        {
            foreach (var s in Flow.Start)
                if (Available(s)) return s;
            return null;
        }

        string SwitchTo(string flowId)
        {
            if (flowId == null || !World.Data.Flows.TryGetValue(flowId, out var flow)) return null;
            Flow = flow;
            World.Playing = flow.Id;
            return FirstStart();
        }

        string FirstAvailable(IReadOnlyList<string> ids)
        {
            foreach (var n in ids)
                if (Available(n)) return n;
            return null;
        }

        /// <summary>The current flow ran out at <paramref name="node"/>: return from a Call, or end the story (beat is then set).</summary>
        string Finish(SkeinNode node, out SkeinBeat beat)
        {
            var last = node;
            while (calls.Count > 0)
            {
                var frame = calls[calls.Count - 1];
                calls.RemoveAt(calls.Count - 1);
                Flow = frame.flow;
                World.Playing = frame.flow.Id;
                var next = FirstAvailable(frame.node.Next);
                if (next != null) { beat = null; return next; }
                last = frame.node;
            }
            beat = End(last);
            return null;
        }

        /// <summary>Pick one of the current beat's choices (0 to continue after a single-choice line).</summary>
        public SkeinBeat Choose(int index = 0)
        {
            if (index < 0 || index >= pending.Count)
            {
                var next = Finish(Current, out var beat);
                return beat ?? Enter(next);
            }
            World.Playing = Flow.Id;
            return Enter(pending[index].Node);
        }

        /// <summary>A node is available when it exists and its requirement holds.</summary>
        public bool Available(string id)
        {
            if (id == null || !Flow.Nodes.TryGetValue(id, out var node)) return false;
            return World.Check(node.Requires);
        }

        List<SkeinChoice> Choices(IReadOnlyList<string> ids)
        {
            var list = new List<SkeinChoice>();
            foreach (var id in ids)
                if (Available(id)) list.Add(new SkeinChoice { Index = list.Count, Node = id, Text = Label(id) });
            return list;
        }

        string Label(string id)
        {
            var n = Flow.Nodes[id];
            if (n.Type == SkeinNodeType.Dialogue) return string.IsNullOrEmpty(n.MenuText) ? n.Text : n.MenuText;
            if (n.Type == SkeinNodeType.Hub) return n.Label;
            return "";
        }

        SkeinBeat End(SkeinNode node)
        {
            pending = new List<SkeinChoice>();
            if (World.Playing == Flow.Id) World.Playing = null;
            return new SkeinBeat { Kind = SkeinBeatKind.End, Node = node };
        }

        /// <summary>
        /// Enter a node: apply its effects, then either stop to show something
        /// (a line, or a choice at a hub) or follow it automatically
        /// (conditions, instructions, single-path hubs, jumps).
        /// </summary>
        SkeinBeat Enter(string start)
        {
            string id = start;
            for (int steps = 0; steps < MaxAutoSteps; steps++)
            {
                if (!Available(id))
                {
                    id = Finish(Current, out var ended);
                    if (ended != null) return ended;
                    continue;
                }
                var node = Flow.Nodes[id];
                Current = node;
                if (node.Count) World.CountVisit(node.Id);
                Entered?.Invoke(node);
                World.Run(node.Effects);
                switch (node.Type)
                {
                    case SkeinNodeType.Dialogue:
                        pending = Choices(node.Next);
                        return new SkeinBeat { Kind = SkeinBeatKind.Line, Node = node, Speaker = node.Speaker, Text = node.Text, Choices = pending };
                    case SkeinNodeType.Condition:
                        id = World.Check(node.Condition) ? node.OnTrue : node.OnFalse;
                        break;
                    case SkeinNodeType.Instruction:
                        World.Run(node.Instruction);
                        id = FirstAvailable(node.Next);
                        break;
                    case SkeinNodeType.Hub:
                        var options = Choices(node.Next);
                        if (options.Count > 1)
                        {
                            pending = options;
                            return new SkeinBeat { Kind = SkeinBeatKind.Choice, Node = node, Choices = options };
                        }
                        id = options.Count > 0 ? options[0].Node : null;
                        break;
                    case SkeinNodeType.Jump:
                        id = node.JumpFlow != null ? SwitchTo(node.JumpFlow) : node.JumpTo;
                        break;
                    case SkeinNodeType.Call:
                        if (node.CallFlow != null && World.Data.Flows.ContainsKey(node.CallFlow))
                        {
                            if (calls.Count >= MaxCallDepth) throw new InvalidOperationException($"Call nodes nested {MaxCallDepth} deep: check for flows that call each other in a loop.");
                            calls.Add((Flow, node));
                            id = SwitchTo(node.CallFlow);
                        }
                        else id = FirstAvailable(node.Next);
                        break;
                }
                if (id == null)
                {
                    id = Finish(node, out var ended);
                    if (ended != null) return ended;
                }
            }
            throw new InvalidOperationException("The flow ran 10,000 automatic steps without reaching a line: check for a loop of conditions, jumps or hubs.");
        }
    }
}
