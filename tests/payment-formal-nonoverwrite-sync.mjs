import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const paymentUiSource = fs.readFileSync(new URL("../ops/payments.js", import.meta.url), "utf8");
assert.doesNotMatch(
  paymentUiSource,
  /noteText === "新辦"[\s\S]*repairedRow\.note = "新循環"/,
  "loading or repairing a row must never reclassify a human note from 新辦 to 新循環",
);
assert.doesNotMatch(
  paymentUiSource,
  /function normalizeRowForMonth[\s\S]*?row\.note\s*=\s*prioritizeContractConfirmationNote/,
  "loading a month must never inject renewal text into a human note",
);
assert.match(
  paymentUiSource,
  /note:\s*existing\.note \|\| incoming\.note \|\| ""/,
  "duplicate cleanup must preserve the existing historical note",
);
assert.match(
  paymentUiSource,
  /note:\s*savedRow\.note \|\| baseRow\.note \|\| ""/,
  "history repair must preserve the saved operator note",
);
assert.doesNotMatch(
  paymentUiSource,
  /note:\s*stripContractConfirmationNote\(row\.note\)/,
  "renewal completion must not strip text from the operator note",
);

class MockStorage {
  constructor() {
    this.values = new Map();
  }
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

const branches = [{ id: "branch-tc", code: "taichung", name: "台中館" }];
const customers = [
  { id: "customer-1", branch_id: "branch-tc", customer_no: "1" },
  { id: "customer-2", branch_id: "branch-tc", customer_no: "2" },
];
const formalRow = {
  id: "payment-1",
  branch_id: "branch-tc",
  year: 2026,
  month: 1,
  customer_no: "1",
  payment_cycle: "Y",
  source_snapshot: {
    id: "1",
    company: "正式公司",
    paidDate: "1/5",
    paidAmount: "1800",
    invoice: "✔️",
    manualStatus: "paid",
    note: "正式人工備註",
  },
  metadata: {
    start: "115/01/01",
    end: "116/01/01",
    price: "1800/m",
  },
};
const formalStatusRow = {
  id: "payment-2",
  branch_id: "branch-tc",
  year: 2026,
  month: 1,
  customer_no: "2",
  payment_cycle: "Y",
  row_status: "open",
  source_snapshot: {
    id: "2",
    company: "另一正式公司",
    manualStatus: "normal",
    note: "原本備註",
  },
  metadata: {
    start: "115/01/02",
    end: "116/01/02",
    price: "1800/m",
    manual_status: "normal",
  },
};
const formalRows = [formalRow, formalStatusRow];
const updates = [];
const inserts = [];
let failNextUpdate = false;

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
  }
  select() {
    this.operation = "select";
    return this;
  }
  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }
  insert(payload) {
    inserts.push({ table: this.table, payload });
    if (this.table === "payment_month_rows") {
      formalRows.push({ id: `payment-${formalRows.length + 1}`, ...structuredClone(payload) });
    }
    return Promise.resolve({ data: null, error: null });
  }
  eq(field, value) {
    this.filters.push([field, value]);
    return this;
  }
  then(resolve, reject) {
    try {
      if (this.operation === "update") {
        if (failNextUpdate) {
          failNextUpdate = false;
          resolve({ data: null, error: new Error("simulated network failure") });
          return;
        }
        updates.push({ table: this.table, payload: this.payload, filters: this.filters });
        if (this.table === "payment_month_rows") {
          const row = formalRows.find((candidate) => this.filters.every(([field, value]) => candidate[field] === value));
          if (row) Object.assign(row, structuredClone(this.payload));
        }
        resolve({ data: null, error: null });
        return;
      }
      let data = [];
      if (this.table === "branches") data = branches;
      if (this.table === "customers") data = customers;
      if (this.table === "payment_month_rows") data = formalRows;
      data = data.filter((row) => this.filters.every(([field, value]) => row[field] === value));
      resolve({ data, error: null });
    } catch (error) {
      reject(error);
    }
  }
}

const fakeClient = {
  from(table) {
    return new QueryBuilder(table);
  },
};
const localStorage = new MockStorage();
const context = vm.createContext({
  console,
  Storage: MockStorage,
  localStorage,
  document: {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild() {} },
  },
  window: {
    location: { href: "http://127.0.0.1/test", replace() {} },
    supabase: { createClient: () => fakeClient },
    setTimeout(callback, delay = 0) {
      if (delay < 1000) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
  },
});
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = localStorage;
context.globalThis = context;

vm.runInContext(fs.readFileSync(new URL("../db-client.js", import.meta.url), "utf8"), context, {
  filename: "db-client.js",
});
context.window.HJ_DB.installLocalStorageSync();

const storageKey = "hjPaymentRows2026_taichung_1月_v1";
const stalePassiveRow = {
  _dbId: "payment-1",
  id: "1",
  company: "",
  cycle: "Y",
  start: "115/01/01",
  end: "116/01/01",
  price: "",
  paidDate: "",
  paidAmount: "",
  invoice: "",
  manualStatus: "",
  note: "",
};
localStorage.setItem(storageKey, JSON.stringify([stalePassiveRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updates.length, 0, "passive reload must not update an existing formal payment row");
assert.equal(inserts.length, 0, "passive reload must not insert a duplicate");

const humanEditedRow = {
  ...stalePassiveRow,
  paidAmount: "2000",
  _dbDirtyFields: ["paidAmount"],
};
localStorage.setItem(storageKey, JSON.stringify([humanEditedRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updates.length, 1, "an explicit human field edit must update exactly one formal row");
assert.deepEqual(
  Object.keys(updates[0].payload).sort(),
  ["amount_paid", "row_status", "source_snapshot"].sort(),
  "only the edited field and its status/snapshot may be updated",
);
assert.equal(updates[0].payload.amount_paid, 2000);
assert.equal(updates[0].payload.source_snapshot.paidAmount, "2000");
assert.equal(updates[0].payload.source_snapshot.paidDate, "1/5", "other formal human fields must remain");
assert.equal(updates[0].payload.source_snapshot.invoice, "✔️", "invoice must remain");
assert.equal(updates[0].payload.source_snapshot.note, "正式人工備註", "note must remain");
assert.equal("_dbDirtyFields" in updates[0].payload.source_snapshot, false);

const humanNoteRow = {
  ...humanEditedRow,
  note: "新辦",
  _dbDirtyFields: ["note"],
};
localStorage.setItem(storageKey, JSON.stringify([humanNoteRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updates.length, 2, "an explicit human note edit must update exactly one formal row");
assert.deepEqual(
  Object.keys(updates[1].payload).sort(),
  ["memo", "reminder_state", "source_snapshot"].sort(),
  "a note edit must not rewrite collection fields or contract fields",
);
assert.equal(updates[1].payload.memo, "新辦");
assert.equal(updates[1].payload.source_snapshot.note, "新辦");
assert.equal(formalRow.memo, "新辦", "saved human note must remain the formal value");

const humanStatusRow = {
  _dbId: "payment-2",
  id: "2",
  company: "另一正式公司",
  cycle: "Y",
  start: "115/01/02",
  end: "116/01/02",
  price: "1800/m",
  manualStatus: "nonbillable",
  note: "原本備註",
  _dbDirtyFields: ["manualStatus"],
};
const savedHumanNoteRow = {
  ...humanNoteRow,
  _dbDirtyFields: [],
};
localStorage.setItem(storageKey, JSON.stringify([savedHumanNoteRow, humanStatusRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updates.length, 3, "an explicit human status edit must update exactly one formal row");
assert.deepEqual(
  Object.keys(updates[2].payload).sort(),
  ["metadata", "row_status", "source_snapshot"].sort(),
  "a manual status edit must not rewrite collection fields or notes",
);
assert.equal(updates[2].payload.row_status, "ignored");
assert.equal(updates[2].payload.metadata.manual_status, "nonbillable");
assert.equal(formalStatusRow.row_status, "ignored", "saved human status must remain the formal value");

const newRow = {
  id: "3",
  company: "新客戶",
  section: "年繳 / 2Y",
  cycle: "Y",
  start: "115/01/01",
  end: "116/01/01",
  price: "1800/m",
};
const savedHumanStatusRow = {
  ...humanStatusRow,
  _dbDirtyFields: [],
};
localStorage.setItem(storageKey, JSON.stringify([stalePassiveRow, savedHumanStatusRow, newRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updates.length, 3, "adding a row must not rewrite existing rows");
assert.equal(inserts.length, 1, "a genuinely new row may be inserted");
assert.equal(inserts[0].payload.customer_no, "3");
assert.equal(inserts[0].payload.amount_due, 1800);

failNextUpdate = true;
const retryRow = {
  ...humanEditedRow,
  paidAmount: "2100",
};
localStorage.setItem(storageKey, JSON.stringify([retryRow, savedHumanStatusRow, newRow]));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(context.window.HJ_DB.pendingWriteCount(), 1, "failed write must remain pending");
assert.ok(localStorage.getItem("hj-db-pending-writes-v1"), "failed write must survive reload in the outbox");
await context.window.HJ_DB.flushPendingWrites();
assert.equal(context.window.HJ_DB.pendingWriteCount(), 0, "retry must clear only after read-back verification");
assert.equal(localStorage.getItem("hj-db-pending-writes-v1"), null, "verified retry must clear the durable outbox");
assert.equal(formalRow.amount_paid, 2100);

console.log("payment formal non-overwrite sync: OK");
