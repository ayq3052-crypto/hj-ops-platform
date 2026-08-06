import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const serviceKey = process.env.HJ_SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("HJ_SUPABASE_SERVICE_ROLE_KEY is required");

const baseUrl = process.env.HJ_TEST_BASE_URL || "http://127.0.0.1:8791";
const restUrl = "https://khpgrfpnvgzkfjmxhuny.supabase.co/rest/v1";
const tables = [
  "v_customers_current",
  "v_contracts_current",
  "v_payment_month_table",
  "v_message_draft_queue",
  "system_settings",
  "crm_year_rows",
  "branches",
];

const query = async (table) => {
  const response = await fetch(`${restUrl}/${table}?select=*`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return response.json();
};

const datasets = Object.fromEntries(
  await Promise.all(tables.map(async (table) => [table, await query(table)])),
);

const fakeClient = {
  auth: {
    getSession: async () => ({
      data: { session: { user: { id: "readonly-ui-test" } } },
      error: null,
    }),
  },
  from(table) {
    return {
      select: async () => ({ data: datasets[table] || [], error: null }),
    };
  },
};

const storage = new Map();
const context = vm.createContext({
  console,
  structuredClone,
  URL,
  window: {
    location: {
      href: "http://127.0.0.1/readonly-ui-test",
      replace() {
        throw new Error("unexpected redirect");
      },
    },
    supabase: {
      createClient: () => fakeClient,
    },
  },
  document: {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild() {} },
  },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;

for (const file of ["ops/customer-id.js", "ops/roc-date.js", "ops/crm-cycle.js", "db-client.js"]) {
  vm.runInContext(
    fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    context,
    { filename: file },
  );
}

const platform = await context.window.HJ_DB.loadPlatformData();
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const browserContext = await browser.newContext({
  locale: "zh-TW",
  timezoneId: "Asia/Taipei",
});
const page = await browserContext.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.route("**/auth-gate.js*", (route) =>
  route.fulfill({ contentType: "application/javascript", body: "" }),
);
await page.route("**/db-client.js*", (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `
      (() => {
        const platform = ${JSON.stringify(platform)};
        window.HJ_DB = {
          ensureSession: async () => true,
          applyPlatformGlobals: async () => {
            window.HJ_CRM_SOURCE_DATA = platform.crmSource;
            window.hjCrmSourceData = platform.crmSource;
            window.hjImportedPaymentData = platform.paymentImported;
            window.hjImportedPaymentDataByYear = platform.paymentImportedByYear;
            window.hjDefaultPaymentRows = platform.paymentCurrent;
            window.hjFutureDraftItems = platform.draftItems;
            window.HJ_STAMP_ASSETS = platform.stampAssets;
            return platform;
          },
          hydrateSavedPageState: async () => ({ verified: true, rows: 0 }),
          migrateLegacyCrmYears: async () => ({ migrated: false, rows: 0 }),
          clearLegacyLocalDataForDb: () => {},
          installLocalStorageSync: () => {},
          flushPendingWrites: async () => ({ verified: true, pending: 0 }),
          markDraftItemNotified: async () => {
            throw new Error("readonly UI test must not write");
          },
        };
      })();
    `,
  }),
);

await page.goto(`${baseUrl}/drafts.html`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelectorAll("#draftYearSelect option").length > 0);
await page.waitForFunction(() => !document.querySelector("#dbLoadState"));

if (process.env.HJ_RENEWAL_BUCKET_ONLY === "1") {
  const result = await page.evaluate(() => {
    const items = eval("draftItems");
    const liveRenewals = items.filter((item) => isRenewalDraftItem(item) && effectiveStatus(item) !== "done");
    const wrongBuckets = liveRenewals
      .filter((item) => displayStatus(item) !== "needs-check")
      .map((item) => ({ id: item.id, status: effectiveStatus(item), displayStatus: displayStatus(item) }));
    const paymentNoticesChanged = items
      .filter((item) => !isRenewalDraftItem(item) && effectiveStatus(item) !== "done")
      .filter((item) => displayStatus(item) !== effectiveStatus(item))
      .map((item) => ({ id: item.id, status: effectiveStatus(item), displayStatus: displayStatus(item) }));

    const payableRenewal = liveRenewals.find((item) => item.paymentRefs?.length);
    let paymentCompletion = null;
    if (payableRenewal) {
      const changedRows = [];
      payableRenewal.paymentRefs.forEach((ref) => {
        const rows = paymentRowsFor(ref.venue || payableRenewal.venue, ref.month || payableRenewal.month, ref.year || payableRenewal.year);
        rows
          .filter((row) => normalizePaymentValue(row.id) === normalizePaymentValue(ref.id))
          .forEach((row) => {
            changedRows.push({ row, paidAmount: row.paidAmount });
            row.paidAmount = "1";
          });
      });
      paymentCompletion = {
        customerNo: payableRenewal.customerNo,
        status: effectiveStatus(payableRenewal),
        displayStatus: displayStatus(payableRenewal),
      };
      changedRows.forEach(({ row, paidAmount }) => {
        row.paidAmount = paidAmount;
      });
      paymentRowsCache = new Map();
    }

    return {
      label: document.querySelector('[data-draft-filter="needs-check"] span')?.textContent?.trim(),
      liveRenewalCount: liveRenewals.length,
      wrongBuckets,
      paymentNoticesChanged,
      paymentCompletion,
    };
  });

  assert.equal(result.label, "續約詢問");
  assert.ok(result.liveRenewalCount > 0, "formal data must include at least one live renewal card");
  assert.deepEqual(result.wrongBuckets, [], "all live renewal cards must be grouped under renewal inquiry");
  assert.deepEqual(result.paymentNoticesChanged, [], "payment notice buckets must remain unchanged");
  assert.ok(result.paymentCompletion, "formal data must include a payable renewal card");
  assert.equal(result.paymentCompletion.status, "done");
  assert.equal(result.paymentCompletion.displayStatus, "done");
  console.log(JSON.stringify({ ...result, formalWrites: 0 }, null, 2));
  await browser.close();
  process.exit(0);
}

if (process.env.HJ_DRAFT_DEBUG === "1") {
  console.log(JSON.stringify(await page.evaluate(() =>
    eval("draftItems")
      .filter((item) =>
        /(^|\\s)V22(?=\\s|$)/i.test(`${item.customerNo || ""} ${item.title || ""}`)
        || (item.paymentRefs || []).some((ref) => String(ref.id || "").toUpperCase() === "V22")
      )
      .map((item) => ({
        id: item.id,
        year: item.year,
        month: item.month,
        status: item.status,
        kind: item.kind,
        renewalEventKey: item.renewalEventKey,
        renewalLead: item.renewalLead,
        persistedDraft: item.persistedDraft,
        persistedStatus: item.persistedStatus,
        paymentRefs: item.paymentRefs,
      }))
  ), null, 2));
  await browser.close();
  process.exit(0);
}

const sightings = [];
const readVisibleCards = async (year, venue, month, status) => {
  await page.selectOption("#draftYearSelect", String(year));
  await page.locator(`[data-draft-venue="${venue}"]`).click();
  await page.locator(`[data-draft-month="${month}月"]`).click();
  await page.locator(`[data-draft-filter="${status}"]`).click();
  const cards = page.locator("#draftList .draft-list-item");
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    sightings.push({
      year,
      venue,
      month,
      status,
      text: (await card.innerText()).replace(/\s+/g, " ").trim(),
      card,
    });
  }
};

for (const year of [2026, 2027]) {
  for (const venue of ["taichung", "huanrui"]) {
    for (let month = 1; month <= 12; month += 1) {
      for (const status of ["today", "follow", "upcoming", "needs-check"]) {
        await readVisibleCards(year, venue, month, status);
      }
    }
  }
}

const exactIdPattern = (customerNo) => {
  const escaped = customerNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i");
};
const forCustomer = (customerNo, options = {}) =>
  sightings.filter((item) =>
    exactIdPattern(customerNo).test(item.text)
    && (!options.year || item.year === options.year)
    && (!options.venue || item.venue === options.venue)
  );

for (const [customerNo, venue] of [["170", "taichung"], ["224", "taichung"]]) {
  assert.equal(
    forCustomer(customerNo, { venue }).length,
    0,
    `${venue} ${customerNo} has a closing payment row and must not retain an active draft card`,
  );
}

const renewalTargets = [
  ["V22", "huanrui", 2026],
  ["V23", "huanrui", 2026],
  ["V26", "huanrui", 2026],
  ["V28", "huanrui", 2026],
  ["V32", "huanrui", 2027],
];
for (const [customerNo, venue, year] of renewalTargets) {
  const matches = forCustomer(customerNo, { year, venue });
  assert.equal(
    matches.length,
    1,
    `${venue} ${customerNo} should have exactly one ${year} lifecycle card, got ${matches.length}`,
  );
}

const closingProjectionChecks = await page.evaluate(() => {
  const closingKeys = new Set([customerWorkflowKey("huanrui", "V22")]);
  return {
    sameVenueSameCustomer: draftBelongsToClosingCustomer(
      { paymentRefs: [{ venue: "huanrui", id: "Ｖ２２" }] },
      closingKeys,
    ),
    otherVenueSameCustomer: draftBelongsToClosingCustomer(
      { paymentRefs: [{ venue: "taichung", id: "V22" }] },
      closingKeys,
    ),
    sameVenueOtherCustomer: draftBelongsToClosingCustomer(
      { paymentRefs: [{ venue: "huanrui", id: "V23" }] },
      closingKeys,
    ),
  };
});
assert.deepEqual(closingProjectionChecks, {
  sameVenueSameCustomer: true,
  otherVenueSameCustomer: false,
  sameVenueOtherCustomer: false,
});

const v22ClosingRoundTrip = await page.evaluate(() => {
  const rows = window.hjImportedPaymentDataByYear.huanrui["2026"]["9月"];
  const originalLength = rows.length;
  rows.push({
    id: "V22",
    company: "隔離測試",
    section: "待遷出 / 9月辦理",
    cycle: "Y",
    start: "114/09/15",
    end: "115/09/15",
    price: "1800/m",
  });
  refreshDraftItems();
  const hiddenCount = draftItems.filter((item) =>
    (item.paymentRefs || []).some((ref) =>
      String(ref.venue || item.venue) === "huanrui"
      && normalizeCustomerId(ref.id) === "V22"
    )
  ).length;
  rows.splice(originalLength);
  refreshDraftItems();
  const restoredCount = draftItems.filter((item) =>
    (item.paymentRefs || []).some((ref) =>
      String(ref.venue || item.venue) === "huanrui"
      && normalizeCustomerId(ref.id) === "V22"
    )
  ).length;
  return { hiddenCount, restoredCount };
});
assert.equal(v22ClosingRoundTrip.hiddenCount, 0, "moving V22 into closing must hide its active card");
assert.equal(v22ClosingRoundTrip.restoredCount, 1, "moving V22 out of closing must restore its one active card");

const formal220 = datasets.v_message_draft_queue.filter((item) =>
  String(item.customer_no || "").trim() === "220"
);
assert.equal(formal220.length, 2, "220 should retain both formal history messages");
assert.equal(
  new Set(formal220.map((item) => String(item.body || "").trim())).size,
  2,
  "220 formal history messages should remain distinct",
);

for (const customerNo of ["118", "166", "220", "255", "280", "281"]) {
  assert.equal(
    forCustomer(customerNo, { year: 2026, venue: "taichung" }).length,
    0,
    `paid/new customer ${customerNo} should not have a 2026 action card`,
  );
}

assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
console.log(JSON.stringify({
  formalRows: {
    customers: platform.counts.customers,
    payments: platform.counts.paymentRows,
    drafts: platform.counts.drafts,
  },
  humanUiCellsVisited: 2 * 2 * 12 * 4,
  closingCustomersAbsent: ["170", "224"],
  closingProjectionChecks,
  v22ClosingRoundTrip,
  oneLifecycleCard: renewalTargets.map(([customerNo, venue, year]) => ({ year, venue, customerNo })),
  customer220: {
    completedCards: 0,
    preservedFormalMessageBodies: 2,
  },
  paidNewCustomersAbsent: ["118", "166", "220", "255", "280", "281"],
  formalWrites: 0,
}, null, 2));

await browser.close();
