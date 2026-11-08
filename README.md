# Kenya prices pipeline

A daily data pipeline for Kenyan pump prices and inflation. It extracts official EPRA and Central Bank of Kenya data, cleans it, loads a PostgreSQL star schema, checks the result before publishing it, and commits curated CSV files that a Power BI dashboard reads.

Written in TypeScript on Node.js, scheduled with GitHub Actions.

```mermaid
flowchart LR
    E[EPRA pump prices] --> F[Polite fetch]
    I[CBK inflation] --> F
    X[CBK exchange rate archive] --> F
    F --> P[Parse and clean]
    P -->|rejected rows, with reasons| R[(rejected_rows)]
    P --> L[Load in one transaction]
    L --> Q{Quality checks}
    Q -->|fail| B[Roll back]
    Q -->|pass| C[(PostgreSQL star schema)]
    C --> V[Curated views]
    V --> CSV[data/curated/*.csv]
    CSV --> PBI[Power BI]
```

## What it found

From the latest run:

- Nairobi petrol rose from KES 180.66 in November 2024 to KES 226.96 in October 2026, while 12-month inflation went from 2.75% to 7.32%.
- In the latest notice, petrol ranges from KES 223.72 in Kaloleni to KES 247.62 in Mandera.
- In April 2026 EPRA revised a price notice the day after issuing it, which the pipeline keeps as two notices.

## Sources

| Source | What | Coverage | Refreshed |
|---|---|---|---|
| [EPRA pump prices](https://www.epra.go.ke/pump-prices) | Super petrol, diesel and kerosene for about 230 towns | November 2024 onwards, 25 notices | Daily |
| [CBK inflation](https://www.centralbank.go.ke/inflation-rates/) | Annual average and 12-month inflation | January 2005 onwards, 262 months | Daily |
| [CBK exchange rates](https://www.centralbank.go.ke/rates/forex-exchange-rates/) | Shilling against 21 currencies | 2007 to 3 January 2024 | Once, as an archive |

The exchange rates are an archive because CBK stopped updating both its CSV file and its web table on 4 January 2024. I checked the per-year files too, which end in 2015. Nairobi Securities Exchange prices were left out because NSE sells its market data under licence.

## Cleaning

Each source had problems that were found by profiling the real data, not assumed:

| Problem | Where | Handling |
|---|---|---|
| Two date formats, `11/10/2016` and `2016-10-11` | CBK rates | The slash form is day first: the same day appears as `11/10/2016` and `2016-10-11` |
| One currency under two labels, such as `SINGAPORE $` and `SINGAPORE DOLLAR` | CBK rates | Mapped to ISO codes |
| Some rates quoted the other way round, as foreign units per shilling | CBK rates | Converted to shillings per unit |
| 488 exact duplicate rows | CBK rates | One copy kept |
| 105 cases of one currency with two different rates on the same day | CBK rates | Both copies rejected, since neither can be trusted |
| 22 rows where buy, mean and sell are out of order | CBK rates | Rejected |
| A row dated 2038 | CBK rates | Rejected |
| A header row and a blank row in the middle of the file | CBK rates | Rejected |
| April 2019 listed twice | CBK inflation | One copy kept |
| A price notice revised the next day | EPRA | Kept as two notices |
| Towns missing from some notices | EPRA | Price change left blank instead of compared with an older notice |

Nothing is dropped silently. Every rejected row goes to `rejected_rows` with its line number and reason.

## Design decisions

- **Write, audit, publish.** A run loads everything in one transaction and runs the quality checks inside it. If an error-level check fails, the transaction rolls back, so the published tables only ever hold data that passed. The run and its rejected rows are still recorded.
- **Safe to re-run.** Loads are upserts that rewrite a row only when its value changed. A second run on the same day reports every row as unchanged.
- **Polite extraction.** The fetcher names itself in its user agent, follows robots.txt (with wildcard rules, per RFC 9309), retries server errors with backoff, does not retry missing pages, and keeps a copy of what it downloaded.
- **Loud failures on layout changes.** If EPRA's table loses its expected columns, the run fails instead of loading wrong data.
- **Dates stay as text.** `DATE` columns are read as `YYYY-MM-DD` strings. Read as JavaScript dates they become local midnight, which in Nairobi prints as the previous day.

## Quality checks

| Check | Level |
|---|---|
| The latest pump price notice is no more than a week past its end | error |
| The latest notice covers at least 200 towns | error |
| Every pump price is between KES 80 and 500 | error |
| No price moves more than 30% from one notice to the next | warning |
| Inflation is no more than three months old | error |
| No month is missing from the inflation series | warning |
| The exchange rate archive has at least 30,000 rates | error |
| Every USD rate is between KES 60 and 200 | error |

## Schedule

`.github/workflows/pipeline.yml` runs at 07:00 Nairobi time. It builds the database from the sources, checks it, and commits the curated CSV files only when the data changed. Add a `DATABASE_URL` repository secret to load a hosted PostgreSQL as well.

## Power BI

The dashboard reads the curated CSV files from GitHub, so it refreshes without a gateway. [docs/powerbi.md](docs/powerbi.md) has the data sources, model, DAX measures and page layout.

## Running it

You need Node.js 22+ and PostgreSQL.

```bash
npm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prices
npm run pipeline
```

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prices_test
npm run typecheck
npm test
```

The integration tests reset the schema of the database they are given, so point `TEST_DATABASE_URL` at a database you can throw away. Without it, only the unit tests run.

## Limitations

- **The Power BI file is not in the repository.** It needs Power BI Desktop, which runs only on Windows. The guide describes how to build it.
- **The exchange rates stop in January 2024**, so they cannot be compared with the pump prices, which start in November 2024.
- **Prices are per notice, not per day.** EPRA publishes a price for a period, usually from the 15th to the 14th.
- **EPRA's pages could change.** The parser checks the table's columns and fails loudly, but a redesign would need code changes.
- **Without a `DATABASE_URL` secret, the scheduled run's database is temporary.** The curated CSV files are the lasting output, and the run history is kept only in that run's log.
