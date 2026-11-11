# Contributing to Skein

Thanks for helping! Bug reports, demo ideas, docs fixes and code are all welcome.

## Reporting a bug or idea

[Open an issue](https://github.com/charlfourie/skein/issues) with:

- what you did, what you expected, and what happened instead;
- whether you were on the desktop app or [the web version](https://skein-mocha.vercel.app),
  and which browser;
- a small `.skein.json` that shows the problem, if you can share one.

## Setting up

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/charlfourie/skein.git
cd skein
npm install
npm run dev                                   # desktop app with hot reload
npx vite --config vite.web.config.ts          # or the web version
```

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
- **Format changes need a migration.** Bump `SCHEMA_VERSION` and teach `parse.ts` to
  read older files.
- **Edits are undoable.** Change the project through `store/ops.ts` or `store/flowOps.ts`,
  so every change is one undo step.
- **Changing a demo?** Edit `scripts/make-demos.ts`, run `npm run make:demos`, and update
  [docs/DEMOS.md](docs/DEMOS.md) if a choice matrix changed.

Add a line to [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Licensing your contribution

By contributing, you agree that your work is licensed under the same terms as the part
of Skein it changes: [Apache 2.0](LICENSE) for the editor, and [MIT](runtimes/LICENSE)
for the runtimes (files marked `SPDX-License-Identifier: MIT`).
