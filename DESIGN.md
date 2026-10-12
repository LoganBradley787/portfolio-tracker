# Design

The visual system of the built UI (`client/src`). A personal brokerage statement: white page, black ink set with weight, one blue. Light only.

## Structure
- Five areas in the top bar, in order of how often they are read: Holdings, Performance, Outlook, Activity, Data. Each area is a row of tabs under the top bar (`PageHeader`), and each tab is one page that answers one question. Pages are built to fit a screen or so; a page never stacks unrelated sections.
- There is no wordmark. The first area is the home page, and Settings, in words at the right, opens the choices that change every figure but are rarely touched (cost basis, dividend reinvestment, how figures are shown). No icons in the top bar: a cog drawn small reads as a sun.
- The page runs the full width of the window with a fixed side margin; nothing is centred in a column.
- Page-level controls (the date range, All / Stocks / ETFs, a search box, the benchmark to compare with) sit on the same rule as the tabs, at the right.
- The account chips are the one global lens and live in the top bar.
- Related views of one thing share a frame and a switch rather than stacking: Return / Drawdown and % / $ on one chart, Your gain / Price change on one table, the ticker's ledger behind tabs, the monthly grid as returns or as the lead over a benchmark.
- Explanations never sit under the thing they explain. Every figure and section that needs one has an (i) (`Info`) that opens the full explanation; the page itself carries only the figures, their labels, and short status lines (a warning, a link, a count).
- The Data → Health page is a checklist. Each check is one line when clear and opens into its table when not.

## Color (tokens in `client/src/index.css`)
- Grounds: `bg` and `surface` (white), `surface-2` (a light grey for inputs, panels, skeletons).
- Rules: `rule` (hairlines between rows), `rule-strong` (under table heads, around stat rows, the accounting single/double rule on totals).
- Text: `ink` (near black), `muted` (a dark grey that reads at a glance, for labels and secondary figures), `faint` (counts and disabled text only).
- `accent` (a saturated blue): links, primary actions, the first chart series. The current tab, the chosen segment and the active layer button are ink, not accent.
- `gain` / `loss` and their soft washes: only for gains and losses (and destructive actions use `loss` text).
- `warn` / `warn-soft`: data that needs a look (flags, pending, manual splits, price warnings, a failed check).
- Chart series: blue, ochre, plum, teal; `series-muted` for references such as money invested.
- The allocation ring has its own twelve colours (`--ring-1` to `--ring-12` in `index.css`), biggest slice first: ink, oxblood, vermilion, brass, the series blue and teal, two greys, then plum, moss, steel and sand. Harder than the chart series on purpose. The oxblood is darker and duller than the loss red so the two never read as the same thing. Swatches are squares, not dots.

## Type
Avenir Next first (it is on the owner's Mac and has tabular figures), then the system face; nothing is fetched from the network. Body 15px, tables 14px, labels 13px semibold, section titles 16px semibold, tab labels 16px semibold, area labels 15px semibold, stat figures 22px semibold (28px large), the market value 60px semibold with tight tracking (`.figure`). A secondary figure beside a stat (a percentage next to its dollars) is set in parentheses at the same size and tone as the figure, one weight lighter; the same shape everywhere a percent follows dollars. Nothing on a page is set to be skipped. All figures use tabular numerals: `.num` in cells (no wrap), `.tnum` in running text.

## Components (`client/src/components/ui.tsx`)
- `PageHeader`: the area's tabs and the page's controls on one rule, with an optional line of context beneath. `PageTitle` for the ticker detail and Settings.
- `StatRow` / `Stat`: a row of figures between two rules, divided by hairlines; label above (with an optional (i)), the figure, and an optional second figure beside it.
- `Section`: a 16px title with an optional count, an (i) and an aside; no box.
- `Info`: a circled i that opens a popover with the explanation; closes on Escape or by clicking it again.
- `Table` (`Table.tsx`): ruled, not boxed. Strong rule under the head, hairlines between rows, totals under a single rule and over a double one. Numeric columns right-aligned and tabular; secondary figures in `muted`; columns hide by breakpoint and the table scrolls inside its frame on phones. A bar in a cell (weight, share) sits to the right of its number and closes the row.
- `Segmented`: the chosen segment is ink on the page, the others muted; it is also the benchmark picker, never a native select. `Button` (primary / secondary / ghost / danger, sm / md).
- `Notice`: a left rule in the tone's colour on a light grey ground. `Empty` between two hairlines. `Note` only for a short status line under a table (a warning, a link). `Flag` for per-row warnings.
- Charts (`charts.tsx`): no vertical grid, four or five horizontal hairlines, a 2px line, a faint wash under a value line, the latest value written at the end of each line (with room reserved for it), a tooltip that states the value alone in ink for a single line. The Overview chart shows only the value; markers for buys (filled), sells (open), splits (×) and dividends (ochre, sized by amount) live on the Chart page, which also zooms by dragging. `GainBar` draws a bar from a shared zero line. `FanChart` for the projection, `Sparkline` for a trend in a cell.
- Panels (add/edit form, import) open inline above the table on a grey surface between two rules; no modals.

## Motion
150 ms colour and background transitions on controls; the refresh progress bar width. Nothing else. Reduced motion disables all transitions.
