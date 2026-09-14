const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const code = ts.transpileModule(fs.readFileSync("src/lib/fx-rates.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup({ row = null, state = null, fetchError = false, payload, saveError = false } = {}) {
  const writes = [];
  const db = { from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
      async maybeSingle() { return { data: table === "fx_daily_rates" ? row : state, error: null }; },
      async upsert(value) {
        writes.push({ table, value });
        return { error: saveError && table === "fx_daily_rates" ? { message: "storage failure" } : null };
      }
    };
    return query;
  } };
  const context = {
    exports: {}, require: () => ({ createServerSupabase: () => db }),
    Date, AbortSignal, console: { error() {} },
    fetch: async () => {
      if (fetchError) throw new Error("timeout");
      return { ok: true, json: async () => payload };
    }
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, writes };
}

test("rejects invalid currencies, rates and dates", () => {
  const { parseFxRate } = setup();
  const valid = { base: "USD", quote: "JPY", date: "2026-09-11", rate: 154.04 };
  assert.equal(parseFxRate(valid, new Date("2026-09-14")).rate, 154.04);
  for (const patch of [{ rate: 0 }, { rate: -1 }, { rate: Infinity }, { rate: "154" },
    { base: "EUR" }, { quote: "USD" }, { date: "2026-02-30" }, { date: "2099-01-01" }]) {
    assert.throws(() => parseFxRate({ ...valid, ...patch }, new Date("2026-09-14")));
  }
});

test("refresh stores the provider date separately from collection time", async () => {
  const api = setup({ payload: { base: "USD", quote: "JPY", date: "2026-09-11", rate: 154.04 } });
  assert.equal((await api.refreshUsdJpyRate()).ok, true);
  assert.equal(api.writes[0].value.rate_date, "2026-09-11");
  assert.equal(api.writes[0].value.rate, 154.04);
  assert.equal(api.writes[1].value.error, null);
});

test("provider failure records failure without overwriting saved rates", async () => {
  const api = setup({ fetchError: true });
  assert.equal((await api.refreshUsdJpyRate()).ok, false);
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].table, "fx_refresh_state");
});

test("failed persistence is not reported as a successful refresh", async () => {
  const api = setup({ saveError: true, payload: { base: "USD", quote: "JPY", date: "2026-09-11", rate: 154.04 } });
  assert.equal((await api.refreshUsdJpyRate()).ok, false);
  assert.equal(api.writes[1].value.error, "storage failure");
});

test("recent collection of an older holiday reference is not stale", async () => {
  const date = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const api = setup({ row: { rate: 154.04, rate_date: date, source: "ECB", fetched_at: new Date().toISOString() } });
  const value = await api.getUsdJpyRate();
  assert.equal(value.asOf, date);
  assert.equal(value.stale, false);
});

test("failed update retains rate and exposes warning; missed runs are stale", async () => {
  const api = setup({
    row: { rate: 154.04, rate_date: new Date().toISOString().slice(0, 10), source: "ECB", fetched_at: new Date(Date.now() - 48 * 3600000).toISOString() },
    state: { error: "timeout", attempted_at: new Date().toISOString() }
  });
  const value = await api.getUsdJpyRate();
  assert.equal(value.rate, 154.04);
  assert.equal(value.updateFailed, true);
  assert.equal(value.stale, true);
  assert.ok(value.warning);
});

test("missing stored rate fails instead of inventing an exchange rate", async () => {
  await assert.rejects(setup().getUsdJpyRate(), /not been collected/);
});
