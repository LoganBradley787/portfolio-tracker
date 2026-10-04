# Portfolio Tracker

A local, single-user web app for tracking a stock and ETF portfolio: holdings, performance against benchmarks, realized gains, underlying fund exposure, and imports from a spreadsheet or broker files. It runs on the owner's machine; there is no account system and no hosted service.

`README.md` describes how to run it and what each page does. `PRODUCT.md` and `DESIGN.md` describe who it is for and how it should look.

## Local notes

If a `local-notes/` folder exists, read `local-notes/README.md` before starting work. It holds the owner's context, the progress log and plans. The folder is git-ignored: never commit anything from it, and never copy its contents into a tracked file, a commit message or a pull request.

## Layout

- `src/engine/` — the calculations. Pure: no I/O, no clock, no database. Test-first.
- `src/import/` — parsers for the spreadsheet format and broker exports. Pure.
- `src/market/` — price and fund-holdings providers and their caches.
- `src/db/` — SQLite schema, migrations and queries. The database lives in `data/`, which is git-ignored.
- `src/server/` — the API. `client/` — the React app.
- `tests/` — mirrors `src/`. `tests/fixtures/` holds recorded public market data and an invented sample portfolio.

## Rules

- **No personal data in the repository.** Nothing that shows what the owner holds, how much, or in how many accounts: no real transactions, balances, account names, broker exports or database files, in code, tests, docs, commit messages or pull requests. Test data is invented (`tests/fixtures/sample/make-reference.py` builds the sample).
- **No secrets in the repository.** `.env` holds `TIINGO_API_KEY` and is git-ignored; `.env.example` shows the format. Send the key as the header `Authorization: Token <key>`, never in a URL. The free tier allows 50 requests an hour; be frugal when calling it live.
- **Stage files by name.** Never `git add -A` or `git add .`; check `git status` before every commit.
- **The commit guard stays on.** `.githooks/` runs `scripts/commit-guard.ts` before every commit and refuses private files, secrets from `.env`, and words on the owner's private list. Never bypass it with `--no-verify`; if it stops a commit, fix the cause.
- **Tests never hit the network.** Use the recorded responses in `tests/fixtures/`.
- **Do not run a development server against the real database while a schema migration is being written.** A half-written migration is recorded as applied.
- Planning, brainstorming and progress notes go in `local-notes/`, not in tracked files.
