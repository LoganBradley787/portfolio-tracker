# Product

<!-- impeccable:product-schema 1 -->

> Inferred from the design spec and CLAUDE.md (the owner was not reachable for an interview). Items not stated there are marked *(assumed)*.

## Platform

web

## Users
A single individual investor, opening the app occasionally on a laptop at `localhost` to see what the portfolio is worth, how it moved, and whether the numbers can be trusted. Replaces a spreadsheet tracker they know well.

## Product Purpose
A fast local replacement for the sheet: true history from replayed transactions, splits detected from market data, proper return figures. Success: shares and cost match the spreadsheet exactly for the owner's real transactions, and the dashboard renders in under a second from cached data.

## Positioning
Correct from first principles rather than tuned to the data: splits from the provider, as-traded shares and raw closes, average cost matching the sheet with FIFO later. Every way a number could be wrong is surfaced on a data-health page.

## Operating Context
Imports a paste of the sheet's Transactions tab; adds trades by form; exports CSV. Any number of account labels. Prices from Tiingo's free tier (50 requests/hour).

## Capabilities and Constraints
Local only, no auth. Outbound data is limited to ticker symbols/dates sent to Tiingo and public fund identifiers sent to Vanguard for automatic VOO/VT holdings. Portfolio quantities and amounts stay local; no web fonts or unrelated third-party requests. Securities only, USD, with automatic dividend reinvestment at the ex-date close. The "attention needed" alert page from the sheet is explicitly not wanted.

## Evidence on Hand
An invented 15-row sample (`tests/fixtures/sample/`) and recorded provider responses (`tests/fixtures/tiingo/`). The owner's real transactions are never part of the repository.

## Product Principles
- Numbers first: every figure tabular, aligned, and traceable.
- Show doubt where it applies: flags on the row, banners for oversells and failed refreshes.
- Never block on the network: render from the database, refresh in the background.
- Sheet parity is the baseline; any difference is intended and documented.
