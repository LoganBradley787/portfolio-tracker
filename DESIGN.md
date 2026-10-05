# Design

The visual system of the built UI (`client/src`). A personal brokerage statement, light only.

## Structure
- Five areas in the top bar: Holdings, Performance, Activity, Outlook, Data. Each area is a row of tabs under the top bar (`PageHeader`), and each tab is one page that answers one question. Pages are built to fit a screen or so; a page never stacks unrelated sections.
- Page-level controls (the date range, All / Stocks / ETFs, a search box) sit on the same rule as the tabs, at the right.
- The two global lenses, the account chips and Avg cost / FIFO, live in the top bar because they change every figure in the app.
- Related views of one thing share a frame and a switch rather than stacking: Return / Drawdown on one chart, Your gain / Price change on one table, the ticker's ledger behind tabs.
- The Data → Health page is a checklist. Each check is one line when clear and opens into its table when not.

## Color (tokens in `client/src/index.css`)
- Grounds: `bg` (a faint cool off-white page), `surface` (white, for anything editable: inputs, forms, the import panel), `surface-2` (skeletons).
- Rules: `rule` (hairlines between rows), `rule-strong` (under table heads, around stat rows, the accounting single/double rule on totals).
- Text: `ink`, `muted`, `faint` (counts, notes, disabled).
- `accent` (deep ink blue): links, primary actions, the first chart series. The current tab and the chosen segment are ink, not accent.
- `gain` / `loss` and their soft washes: only for gains and losses (and destructive actions use `loss` text).
- `warn` / `warn-soft`: data that needs a look (flags, pending, manual splits, price warnings, a failed check).
- Chart series: ink blue, ochre, plum, teal; `series-muted` for references such as cost basis.

## Type
Avenir Next first (it is on the owner's Mac and has tabular figures), then the system face; nothing is fetched from the network. Body 14px, tables 13px, labels and notes 12px, section titles 13px semibold, tab labels 15px medium, stat figures 17px medium, the market value 52px regular with tight tracking (`.figure`). All figures use tabular numerals: `.num` in cells (no wrap), `.tnum` in running text.

## Components (`client/src/components/ui.tsx`)
- `PageHeader`: the area's tabs and the page's controls on one rule, with an optional line of context beneath. `PageTitle` for the ticker detail.
- `StatRow` / `Stat`: a row of figures between two rules, divided by hairlines; label above, figure, a line beneath.
- `Section`: a 13px title with an optional count and an aside; no box.
- `Table` (`Table.tsx`): ruled, not boxed. Strong rule under the head, hairlines between rows, totals under a single rule and over a double one. Numeric columns right-aligned and tabular; secondary figures in `muted`; columns hide by breakpoint and the table scrolls inside its frame on phones.
- `Segmented`: the chosen segment is ink on the page, the others muted. `Button` (primary / secondary / ghost / danger, sm / md).
- `Notice`: a left rule in the tone's colour on a white surface, no fill. `Empty` between two hairlines. `Note` for the explanatory line under a table or chart. `Flag` for per-row warnings.
- Charts (`charts.tsx`): no vertical grid, four or five horizontal hairlines, a 1.5px line, no area wash except a faint one under the value line, the latest value written at the end of each line, markers as filled (buy) or open (sell, split) dots. `GainBar` draws a bar from a shared zero line. `FanChart` for the projection, `Sparkline` for a trend in a cell.
- Panels (add/edit form, import) open inline above the table on a white surface between two rules; no modals.

## Motion
150 ms colour and background transitions on controls; the refresh progress bar width. Nothing else. Reduced motion disables all transitions.
