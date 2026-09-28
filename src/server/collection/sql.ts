/** SQL fragments over a collection row `co` joined to its printing `c`. */

/** Price of one copy in its own finish: foil copies use the foil price, etched the etched price. */
export const COPY_PRICE_SQL =
  "CAST(json_extract(c.prices, CASE co.finish WHEN 'foil' THEN '$.usd_foil' WHEN 'etched' THEN '$.usd_etched' ELSE '$.usd' END) AS REAL)"

/** Nonfoil, then foil, then etched, as an ORDER BY term over a finish column. */
export const finishOrderSql = (column: string) => `CASE ${column} WHEN 'nonfoil' THEN 0 WHEN 'foil' THEN 1 ELSE 2 END`
