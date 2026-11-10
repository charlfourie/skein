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

        public readonly SkeinWorld World;
        public readonly SkeinFlow Flow;
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
            var id = nodeId;
            if (id == null)
                foreach (var s in Flow.Start)
                    if (Available(s)) { id = s; break; }
            return id != null ? Enter(id) : End(null);
        }

        /// <summary>Pick one of the current beat's choices (0 to continue after a single-choice line).</summary>
        public SkeinBeat Choose(int index = 0)
        {
            if (index < 0 || index >= pending.Count) return End(Current);
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
                if (!Available(id)) return End(Current);
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
                        id = null;
                        foreach (var n in node.Next)
                            if (Available(n)) { id = n; break; }
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
                        id = node.JumpTo;
                        break;
                }
                if (id == null) return End(node);
            }
            throw new InvalidOperationException("The flow ran 10,000 automatic steps without reaching a line: check for a loop of conditions, jumps or hubs.");
        }
    }
}
