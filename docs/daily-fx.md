# Daily USD/JPY

The existing `/api/cron/daily-job` schedule (`0 22 * * *`, 07:00 JST)
collects the ECB daily reference rate through Frankfurter before stock analysis.
No additional API key is required. This is a reference rate, not a live quote
or a broker execution rate. ECB holidays and weekends retain the prior reference date.

## Production Setup

1. Apply `supabase/migrations/20260914_fx_rates.sql` in the target Supabase SQL editor.
2. Ensure `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`
   are configured on the server. Never expose the service-role key to the browser.
3. Deploy the application with the existing `vercel.json` schedule.
4. Run the authenticated GET daily job once, or wait for the next scheduled run.
   Inspect `fxRefresh.ok` in its response. With no watchlist the job returns 412,
   but FX collection still runs first and its result is included.
5. Check `/api/fx/usd-jpy`: `ok`, `rate`, `asOf` (provider date), `fetchedAt`,
   `stale`, and `updateFailed`. Before the first successful collection it returns 503.

Both the simulator API and AI analysis read the saved rate. Failed collection
does not replace history. A failed attempt is persisted separately. A collection
older than 36 hours or reference date older than seven days is marked stale;
the latter is a conservative age threshold, not an ECB holiday-calendar calculation.
The next scheduled run retries collection. Server logs and the daily job warning
report failures. Public responses do not expose internal database error details.

Verification: `node --test tests/fx-rates.test.cjs` and `npx tsc --noEmit --incremental false`.

Sources: https://frankfurter.dev/ and
https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
Frankfurter permits commercial API use; underlying provider terms still apply.
