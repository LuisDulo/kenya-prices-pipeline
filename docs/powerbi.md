# Building the Power BI dashboard

The pipeline publishes four curated CSV files to `data/curated/` every day. Power BI reads them straight from GitHub, so the report refreshes with no gateway and no database connection.

## 1. Load the data

In Power BI Desktop, choose **Get data > Web** for each file:

| Table | URL |
|---|---|
| `pump_prices` | `https://raw.githubusercontent.com/LuisDulo/kenya-prices-pipeline/main/data/curated/pump_prices.csv` |
| `inflation` | `https://raw.githubusercontent.com/LuisDulo/kenya-prices-pipeline/main/data/curated/inflation.csv` |
| `fuel_vs_inflation` | `https://raw.githubusercontent.com/LuisDulo/kenya-prices-pipeline/main/data/curated/fuel_vs_inflation.csv` |
| `fx_rates_archive` | `https://raw.githubusercontent.com/LuisDulo/kenya-prices-pipeline/main/data/curated/fx_rates_archive.csv` |

In Power Query, use the first row as headers and set these types. Dates are `YYYY-MM-DD`, so pick **Using locale > English (United States)** if Power BI misreads them.

| Column | Type |
|---|---|
| `cycle_start`, `cycle_end`, `month`, `rate_date` | Date |
| `price_kes`, `change_kes`, `change_pct`, every `*_kes` and `*_pct`, `kes_per_unit`, `mean`, `buy`, `sell` | Decimal number |
| everything else | Text |

`change_kes` and `change_pct` are blank where a town has no price in the previous notice. Leave them blank. Do not replace them with zero, which would claim the price did not change.

## 2. Model

Create a date table with **Modeling > New table**:

```DAX
Calendar =
ADDCOLUMNS (
    CALENDAR ( DATE ( 2005, 1, 1 ), DATE ( YEAR ( TODAY () ) + 1, 12, 31 ) ),
    "Year", YEAR ( [Date] ),
    "Month", FORMAT ( [Date], "mmm yyyy" ),
    "Month start", DATE ( YEAR ( [Date] ), MONTH ( [Date] ), 1 )
)
```

Mark it as a date table, then relate:

| From | To | Cardinality |
|---|---|---|
| `pump_prices[cycle_start]` | `Calendar[Date]` | many to one |
| `fuel_vs_inflation[cycle_start]` | `Calendar[Date]` | many to one |
| `inflation[month]` | `Calendar[Date]` | many to one |
| `fx_rates_archive[rate_date]` | `Calendar[Date]` | many to one |

## 3. Measures

```DAX
Latest Notice = MAX ( pump_prices[cycle_start] )

Average Price = AVERAGE ( pump_prices[price_kes] )

Price In Latest Notice =
VAR latest = [Latest Notice]
RETURN CALCULATE ( [Average Price], pump_prices[cycle_start] = latest )

Nairobi Petrol =
CALCULATE ( [Average Price], pump_prices[town] = "Nairobi", pump_prices[product_code] = "PMS" )

Change Since First Notice % =
VAR first = CALCULATE ( MIN ( pump_prices[cycle_start] ), ALL ( pump_prices ) )
VAR startPrice = CALCULATE ( [Average Price], pump_prices[cycle_start] = first )
RETURN DIVIDE ( [Price In Latest Notice] - startPrice, startPrice )

Town Price Spread =
VAR latest = [Latest Notice]
RETURN
    CALCULATE ( MAX ( pump_prices[price_kes] ), pump_prices[cycle_start] = latest )
        - CALCULATE ( MIN ( pump_prices[price_kes] ), pump_prices[cycle_start] = latest )

Latest Inflation =
VAR lastMonth = MAX ( inflation[month] )
RETURN CALCULATE ( MAX ( inflation[twelve_month_pct] ), inflation[month] = lastMonth )

Average KES per USD =
CALCULATE ( AVERAGE ( fx_rates_archive[kes_per_unit] ), fx_rates_archive[currency_code] = "USD" )
```

Format the `%` measures as percentages and the price measures as `#,0.00`.

## 4. Pages

Use the palette from the other projects: deep emerald `#064E3B`, teal `#0D9488` and gold `#D6A84F` on off-white `#F8FAF7`.

**Overview**

- Cards: Price In Latest Notice (filtered to Super petrol, Nairobi), Change Since First Notice %, Latest Inflation, Town Price Spread.
- Line and clustered column chart: `fuel_vs_inflation[cycle_start]` on the axis, `nairobi_petrol_kes` and `nairobi_diesel_kes` as lines, `inflation_pct` on the secondary axis.

**Towns**

- Map: `pump_prices[town]` as location (set the data category to *City*), Price In Latest Notice as bubble size, filtered to one fuel.
- Table: town, fuel, price, `change_kes`, sorted by price, with conditional formatting on `change_kes`.
- Slicers: fuel and notice.

**Price changes**

- Matrix: towns down the side, `cycle_start` across, `price_kes` as values.
- Note on the page: notices can be revised, as in April 2026, when the notice from the 15th was replaced by one from the 16th.

**Exchange rates (archive)**

- Line chart: `rate_date` by Average KES per USD, with a currency slicer.
- A text box: "CBK stopped publishing this series on 4 January 2024."

## 5. Refresh

Publish to the Power BI Service and set a daily scheduled refresh after 07:30 Nairobi time, once the pipeline has run. Web sources on public URLs need no gateway.
