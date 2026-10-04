# Vanguard holdings fixtures

Recorded from the public VOO (0968) and VT (3141) weighted-holdings endpoints on 2026-10-03; both responses were effective 2026-08-31. No authentication or portfolio data was sent.

These are **trimmed representative snapshots**, not full fund allocations. They retain leading holdings, selected share classes/listings, and unpublished weights, plus reserve arrays to verify those are not added to equity exposure. Fixture counts and allocation sums must not be used as production validation targets. Tests and the demo server never request Vanguard live.

Production retrieves the entire equity array. A separate manual smoke check used the full responses (505 VOO equities and 10,090 VT equities); the app does not depend on those temporary files.
