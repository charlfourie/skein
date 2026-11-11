# Contributing to Skein

Thanks for helping! Bug reports, demo ideas, docs fixes and code are all welcome.

## Reporting a bug or idea

[Open an issue](https://github.com/charlfourie/skein/issues) with:

- what you did, what you expected, and what happened instead;
- which browser you were using, and whether it was [the hosted version](https://skein-mocha.vercel.app)
  or your own copy;
- a small `.skein.json` that shows the problem, if you can share one.

## Setting up

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/charlfourie/skein.git
cd skein
npm install
npm run dev                                   # the editor at http://localhost:5173, with hot reload
```

## Branches

- **`main` is production.** It is what [skein-mocha.vercel.app](https://skein-mocha.vercel.app)
  serves, so everything on it should be ready for users.
- **`next` is where the next phase is built.** Vercel deploys every push to `next` as a
  preview. Merge `next` into `main` when a piece of work is reviewed and ready to ship.
- Small fixes to production can go straight to `main`; merge `main` back into `next`
  afterwards so the two don't drift apart.
- Open pull requests against `next` unless you're fixing something that's broken on `main`.

## Before you open a pull request

```bash
npm run typecheck
npm test
```

Both run automatically on every push and pull request.

A few habits keep Skein dependable:

- **One source of truth.** Story logic lives in `src/shared`. The editor, Play, Explore
  and every engine runtime use the same rules, so change behaviour there, and keep the
  C# runtime in step (its conformance suite in `runtimes/csharp/tests` checks it).
- **Keep files deterministic.** Never add timestamps, viewport state or anything else
  that changes on every save to the project format. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Format changes need a migration.** Bump `SCHEMA_VERSION`, teach `parse.ts` to
  read older files, run `npm run make:schemas`, and follow [docs/VERSIONING.md](docs/VERSIONING.md).
- **Runtime changes land everywhere at once.** If you change how a story plays in
  `src/shared/export/runtime.ts`, regenerate the conformance fixtures
  (`npx tsx runtimes/conformance/generate.ts`) and update the C# runtime in the same
  pull request; `dotnet run --project runtimes/csharp/tests` must pass.
- **Edits are undoable.** Change the project through `store/ops.ts` or `store/flowOps.ts`,
  so every change is one undo step.
- **Changing a demo?** Edit `scripts/make-demos.ts`, run `npm run make:demos`, and update
  [docs/DEMOS.md](docs/DEMOS.md) if a choice matrix changed.

Add a line to [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Licensing your contribution

By contributing, you agree that your work is licensed under the same terms as the part
of Skein it changes: [Apache 2.0](LICENSE) for the editor, and [MIT](runtimes/LICENSE)
for the runtimes (files marked `SPDX-License-Identifier: MIT`).
