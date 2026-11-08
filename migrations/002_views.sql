-- The curated views that Power BI and the CSV exports read.

-- Each EPRA price notice compared with the notice immediately before it. A town missing from
-- that notice gets no change, rather than a misleading jump across several months. Notices can
-- be revised: in April 2026 a notice from the 15th was replaced by one from the 16th.
CREATE VIEW v_pump_prices AS
WITH notices AS (
    SELECT cycle_start, LAG(cycle_start) OVER (ORDER BY cycle_start) AS previous_start
    FROM (SELECT DISTINCT cycle_start FROM fact_pump_price) AS starts
)
SELECT p.cycle_start,
       p.cycle_end,
       t.name AS town,
       p.product_code,
       d.name AS product_name,
       p.price_kes,
       p.price_kes - prev.price_kes AS change_kes,
       ROUND(100 * (p.price_kes / NULLIF(prev.price_kes, 0) - 1), 2) AS change_pct
FROM fact_pump_price p
JOIN notices n USING (cycle_start)
JOIN dim_town t USING (town_id)
JOIN dim_product d ON d.code = p.product_code
LEFT JOIN fact_pump_price prev
       ON prev.cycle_start = n.previous_start
      AND prev.town_id = p.town_id
      AND prev.product_code = p.product_code;

CREATE VIEW v_inflation AS
SELECT month, annual_average_pct, twelve_month_pct
FROM fact_inflation;

-- Nairobi prices for each notice, beside inflation for the month in which the notice starts.
CREATE VIEW v_fuel_vs_inflation AS
SELECT p.cycle_start,
       p.cycle_end,
       MAX(p.price_kes) FILTER (WHERE p.product_code = 'PMS') AS nairobi_petrol_kes,
       MAX(p.price_kes) FILTER (WHERE p.product_code = 'AGO') AS nairobi_diesel_kes,
       MAX(p.price_kes) FILTER (WHERE p.product_code = 'IK') AS nairobi_kerosene_kes,
       i.twelve_month_pct AS inflation_pct
FROM fact_pump_price p
JOIN dim_town t USING (town_id)
LEFT JOIN fact_inflation i ON i.month = DATE_TRUNC('month', p.cycle_start)::date
WHERE t.name = 'Nairobi'
GROUP BY p.cycle_start, p.cycle_end, i.twelve_month_pct;

CREATE VIEW v_fx_archive AS
SELECT rate_date, currency_code, kes_per_unit, mean, buy, sell
FROM fact_fx_rate;
