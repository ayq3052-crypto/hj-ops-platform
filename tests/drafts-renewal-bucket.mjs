import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ops/drafts.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../drafts.html", import.meta.url), "utf8");

const functionSource = (name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
  if (!match) throw new Error(`missing function: ${name}`);
  return match[0];
};

const context = vm.createContext({
  Boolean,
  String,
  draftIsPaymentComplete: (item) => Boolean(item.paymentComplete),
  isSnoozed: () => false,
  noticeForItem: () => null,
});

vm.runInContext(functionSource("isRenewalDraftItem"), context);
vm.runInContext(functionSource("effectiveStatus"), context);
vm.runInContext(functionSource("displayStatus"), context);

const displayStatus = (item) => vm.runInContext(`displayStatus(${JSON.stringify(item)})`, context);

for (const status of ["today", "follow", "upcoming", "needs-check"]) {
  assert.equal(
    displayStatus({ kind: "續約詢問", status, paymentComplete: false }),
    "needs-check",
    `unpaid renewal with ${status} must be grouped under renewal inquiry`,
  );
}

assert.equal(
  displayStatus({ renewalEventKey: "renewal:example", status: "today", paymentComplete: false }),
  "needs-check",
  "renewal event keys must also be grouped under renewal inquiry",
);
assert.equal(
  displayStatus({ kind: "續約詢問", status: "today", paymentComplete: true }),
  "done",
  "completed renewal payment must disappear instead of returning to renewal inquiry",
);
assert.equal(
  displayStatus({ kind: "繳費通知", status: "today", paymentComplete: false }),
  "today",
  "payment notices must keep their original display bucket",
);

assert.match(html, /data-draft-filter="needs-check">\s*<span>續約詢問<\/span>/);
assert.match(source, /displayStatus\(item\) === activeStatus/);
assert.match(source, /displayStatus\(item\) === status/);

console.log(JSON.stringify({
  renewalBuckets: ["today", "follow", "upcoming", "needs-check"].map(() => "needs-check"),
  completedRenewal: "done",
  paymentNotice: "unchanged",
  label: "續約詢問",
}, null, 2));
