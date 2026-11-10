// Conformance harness: replays exactly the steps of trace() in conformance.ts
// against the C# runtime, and prints the trace for comparison.
//
//   dotnet run --project runtimes/csharp/tests -- <fixtures-dir>

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Skein;

static class Program
{
    static string J(object v) => SkeinJson.Stringify(v);

    static void Collect(object v, List<JsonObject> conds, List<JsonObject> stmts)
    {
        if (v is List<object> list) { foreach (var x in list) Collect(x, conds, stmts); return; }
        if (!(v is JsonObject o)) return;
        if (o.Obj("expr") != null) conds.Add(o.Obj("expr"));
        if (o.Arr("do") != null) foreach (var s in o.Arr("do")) stmts.Add((JsonObject)s);
        foreach (var k in o.Keys.OrderBy(k => k, StringComparer.Ordinal)) Collect(o[k], conds, stmts);
    }

    static string BeatLine(SkeinBeat b)
    {
        if (b.Kind == SkeinBeatKind.End) return "END " + (b.Node?.Id ?? "-");
        var choices = string.Join(" | ", b.Choices.Select(c => $"{c.Index}:{c.Node}:{c.Text}"));
        if (b.Kind == SkeinBeatKind.Line) return $"LINE {b.Node.Id} {b.Speaker ?? "-"} {J(b.Text)} [{choices}]";
        return $"CHOICE {b.Node.Id} [{choices}]";
    }

    static string Trace(string json)
    {
        var data = SkeinExport.Parse(json);
        var conds = new List<JsonObject>();
        var stmts = new List<JsonObject>();
        Collect(SkeinJson.Parse(json), conds, stmts);
        var selves = new List<string> { null };
        selves.AddRange(data.Entities.Keys.OrderBy(k => k, StringComparer.Ordinal));
        var lines = new List<string>();

        {
            var world = new SkeinWorld(data);
            for (int i = 0; i < stmts.Count; i++)
            {
                world.Execute(stmts[i], selves[i % selves.Count]);
                var vals = conds.Select((c, j) => J(world.Evaluate(c, selves[j % selves.Count])));
                lines.Add($"S{i} day={world.Day} phase={world.Phase ?? "-"} {string.Join(",", vals)}");
            }
            lines.Add("SAVE " + world.Save().ToJson());
            lines.AddRange(world.Log.Select(l => "LOG " + l));
        }

        foreach (var flowId in data.FlowOrder)
        {
            for (int seed = 0; seed < 6; seed++)
            {
                var world = new SkeinWorld(data);
                lines.Add($"FLOW {flowId} seed={seed}");
                try
                {
                    var story = new SkeinStory(world, flowId);
                    var beat = story.Start();
                    for (int step = 0; step < 40; step++)
                    {
                        lines.Add($"{BeatLine(beat)} playing={world.Playing ?? "-"}");
                        if (beat.Kind == SkeinBeatKind.End) break;
                        if ((step + seed) % 3 == 0) world.Advance(1 + (seed % 2));
                        int n = beat.Choices.Count;
                        beat = story.Choose(n == 0 ? 0 : (step * 31 + seed * 17) % n);
                    }
                }
                catch (InvalidOperationException err)
                {
                    lines.Add("ERROR " + err.Message);
                }
                lines.Add("SAVE " + world.Save().ToJson());
            }
        }

        {
            var a = new SkeinWorld(data);
            foreach (var s in stmts.Take(20)) a.Execute(s);
            var b = new SkeinWorld(data, SkeinSave.FromJson(a.Save().ToJson()));
            var same = b.Save().ToJson() == a.Save().ToJson();
            lines.Add($"RESTORE {(same ? "true" : "false")} {string.Join(",", conds.Select(c => J(b.Evaluate(c))))}");
        }
        return string.Join("\n", lines) + "\n";
    }

    static int Main(string[] args)
    {
        var dir = args.Length > 0 ? args[0] : ".";
        int failed = 0, total = 0;
        foreach (var path in Directory.GetFiles(dir, "*.game.json").OrderBy(p => p, StringComparer.Ordinal))
        {
            total++;
            var name = Path.GetFileName(path).Replace(".game.json", "");
            var expected = File.ReadAllText(Path.Combine(dir, name + ".trace.txt"));
            var actual = Trace(File.ReadAllText(path));
            if (actual == expected) { Console.WriteLine($"PASS {name} ({expected.Count(c => c == '\n')} lines)"); continue; }
            failed++;
            var e = expected.Split('\n');
            var a = actual.Split('\n');
            int i = 0;
            while (i < Math.Min(e.Length, a.Length) && e[i] == a[i]) i++;
            Console.WriteLine($"FAIL {name} at line {i + 1}\n  expected: {(i < e.Length ? e[i] : "<eof>")}\n  actual:   {(i < a.Length ? a[i] : "<eof>")}");
            File.WriteAllText(Path.Combine(dir, name + ".actual.txt"), actual, new UTF8Encoding(false));
        }
        Console.WriteLine($"{total - failed}/{total} fixtures match the reference runtime");
        return failed == 0 ? 0 : 1;
    }
}
