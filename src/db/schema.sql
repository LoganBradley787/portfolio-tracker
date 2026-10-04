-- Migration 1: initial schema. Numbers are REAL (64-bit floats), dates are
-- ISO 'YYYY-MM-DD' text, timestamps are ISO 8601 text in UTC.

CREATE TABLE transactions (
  id      INTEGER PRIMARY KEY,
  seq     INTEGER NOT NULL,
  ticker  TEXT    NOT NULL,
  type    TEXT    NOT NULL CHECK (type IN ('Buy', 'Sell')),
  shares  REAL    NOT NULL,
  price   REAL    NOT NULL,
  date    TEXT    NOT NULL,
  account TEXT    NOT NULL DEFAULT '',
  note    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX transactions_date_seq ON transactions (date, seq);

CREATE TABLE securities (
  ticker             TEXT PRIMARY KEY,
  asset_type         TEXT NOT NULL DEFAULT 'Stock' CHECK (asset_type IN ('Stock', 'ETF')),
  provider_symbol    TEXT,
  name               TEXT,
  sector             TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('ok', 'pending', 'unresolved')),
  history_through    TEXT,
  last_history_fetch TEXT,
  last_error         TEXT
);

CREATE TABLE prices (
  ticker TEXT NOT NULL,
  date   TEXT NOT NULL,
  close  REAL NOT NULL,
  PRIMARY KEY (ticker, date)
) WITHOUT ROWID;

CREATE TABLE splits (
  ticker  TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  ratio   REAL NOT NULL,
  source  TEXT NOT NULL CHECK (source IN ('provider', 'manual')),
  PRIMARY KEY (ticker, ex_date)
);

CREATE TABLE dividends (
  ticker  TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  amount  REAL NOT NULL,
  PRIMARY KEY (ticker, ex_date)
);

CREATE TABLE quotes (
  ticker     TEXT PRIMARY KEY,
  last       REAL NOT NULL,
  prev_close REAL,
  as_of      TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE provider_requests (
  id     INTEGER PRIMARY KEY,
  at     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  symbol TEXT,
  status INTEGER,
  ok     INTEGER NOT NULL
);
CREATE INDEX provider_requests_at ON provider_requests (at);

CREATE TABLE imported_splits (
  id      INTEGER PRIMARY KEY,
  ticker  TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  ratio   REAL NOT NULL
);

CREATE TABLE schema_version (version INTEGER NOT NULL);
