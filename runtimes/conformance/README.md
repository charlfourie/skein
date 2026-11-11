# Runtime conformance kit

Every Skein runtime plays stories exactly like the reference runtime,
[`src/shared/export/runtime.ts`](../../src/shared/export/runtime.ts). This kit is how
that's checked, and how a new port (GDScript, C++, Lua…) proves it.

```
fixtures/
  <name>.game.json   an export: the Lighthouse example, plus seeded synthetic exports
                     covering every operator, statement, node type, coercion edge,
                     line IDs and variables inside lines
  <name>.trace.txt   what the reference runtime does with it, line by line
```

A port is **conformant** when, for every fixture, it produces a trace that is
byte-for-byte the same as the committed one. The steps that make a trace are in
`trace()` in [`generate.ts`](generate.ts): a statement sweep, play-throughs of every
flow with several choice policies, a save/restore round trip, and clock edges.
Mirror them exactly. The C# harness, [`runtimes/csharp/tests/Program.cs`](../csharp/tests/Program.cs),
is a worked example.

```bash
dotnet run --project runtimes/csharp/tests     # the C# runtime against the fixtures
npx tsx runtimes/conformance/generate.ts        # regenerate after changing the reference runtime
npx tsx runtimes/conformance/generate.ts --check
```

CI runs `--check` (the fixtures must be up to date) and every port's harness on
each push. Fixtures only change when the reference runtime's behaviour changes on
purpose: commit them with that change, and update every port in the same pull request.

Licensed MIT, like the runtimes (see [`../LICENSE`](../LICENSE)).
