-- A small star schema: facts for prices and rates, dimensions for towns, fuels and currencies.

CREATE TABLE pipeline_runs (
    id          BIGSERIAL PRIMARY KEY,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
    summary     JSONB NOT NULL DEFAULT '{}'
);

-- Source rows that were not loaded, with the reason, so cleaning can be reviewed.
CREATE TABLE rejected_rows (
    id      BIGSERIAL PRIMARY KEY,
    run_id  BIGINT NOT NULL REFERENCES pipeline_runs (id),
    source  TEXT NOT NULL,
    line    INTEGER NOT NULL,
    reason  TEXT NOT NULL,
    raw     TEXT NOT NULL
);
CREATE INDEX rejected_rows_run_idx ON rejected_rows (run_id);

CREATE TABLE dim_town (
    town_id SERIAL PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE
);

CREATE TABLE dim_product (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
INSERT INTO dim_product (code, name) VALUES
    ('PMS', 'Super petrol'), ('AGO', 'Diesel'), ('IK', 'Kerosene');

CREATE TABLE dim_currency (
    code      CHAR(3) PRIMARY KEY,
    quoted_as TEXT NOT NULL CHECK (quoted_as IN ('kes_per_unit', 'kes_per_100', 'units_per_kes'))
);

CREATE TABLE fact_pump_price (
    cycle_start  DATE NOT NULL,
    cycle_end    DATE NOT NULL,
    town_id      INTEGER NOT NULL REFERENCES dim_town (town_id),
    product_code TEXT NOT NULL REFERENCES dim_product (code),
    price_kes    NUMERIC(8, 2) NOT NULL CHECK (price_kes > 0),
    run_id       BIGINT NOT NULL REFERENCES pipeline_runs (id),
    PRIMARY KEY (cycle_start, town_id, product_code),
    CHECK (cycle_end > cycle_start)
);

CREATE TABLE fact_inflation (
    month              DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
    annual_average_pct NUMERIC(6, 2) NOT NULL,
    twelve_month_pct   NUMERIC(6, 2) NOT NULL,
    run_id             BIGINT NOT NULL REFERENCES pipeline_runs (id)
);

CREATE TABLE fact_fx_rate (
    rate_date     DATE NOT NULL,
    currency_code CHAR(3) NOT NULL REFERENCES dim_currency (code),
    mean          NUMERIC(14, 6) NOT NULL,
    buy           NUMERIC(14, 6) NOT NULL,
    sell          NUMERIC(14, 6) NOT NULL,
    kes_per_unit  NUMERIC(18, 8) NOT NULL CHECK (kes_per_unit > 0),
    run_id        BIGINT NOT NULL REFERENCES pipeline_runs (id),
    PRIMARY KEY (rate_date, currency_code),
    CHECK (buy <= mean AND mean <= sell)
);
