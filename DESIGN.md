# Design

The visual system of the built UI (`client/src`). Operate-mode product UI: a personal brokerage ledger.

## Color (tokens in `client/src/index.css`, light and dark)
- Grounds: `bg` (page), `surface` (tables, panels), `surface-2` (hover, skeletons, inline code).
- Rules: `rule` (row hairlines), `rule-strong` (table heads, statement band, inputs).
- Text: `ink`, `muted` (≥4.5:1 on surface in both themes).
- `accent` (ink blue): primary actions, current tab, selected segment, focus ring, weight bars. Never decoration.
- `gain` / `loss`: only for gains and losses (and destructive actions use `loss` text).
- `warn` / `warn-soft`: data that needs a look (flags, pending, manual splits, price warnings).
- Theme follows the system until toggled; the choice is stored in `localStorage`.

## Type
System UI stack only (no network fonts, by the privacy constraint). Body 14px, tables 13px, labels 12px, section titles 15px semibold, page titles 20px semibold, headline figure 26px. All figures use tabular numerals: `.num` in cells (no wrap), `.tnum` in running text.

## Components
- `Table`: sortable ledger table, right-aligned numeric columns, hairline rows, totals row with the accounting single-over-double rule (`.ledger-total`). Columns hide by breakpoint rather than letting the page scroll; the table scrolls inside its own frame on phones.
- Statement band: figures in a row between two strong rules, divided by hairlines at `lg`. Not cards.
- `Button` (primary / secondary / ghost / danger, sm / md), `Segmented` for filters and two-way choices, `Notice` (info / warn / loss) for banners, `Flag` pill for per-row data warnings, `Empty` for empty states that say what to do next, `Skeleton` for loading.
- Panels (add/edit form, import) open inline above the table; no modals.

## Motion
150 ms colour/background transitions on controls; the refresh progress bar width. Nothing else. Reduced motion disables all transitions.
