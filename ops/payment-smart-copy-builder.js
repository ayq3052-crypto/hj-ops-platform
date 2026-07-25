(function initPaymentSmartCopyBuilder(root, factory) {
  const api = factory(root.HJPaymentSmartImportV2 || (typeof require === "function" ? require("./payment-smart-import-v2.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJPaymentSmartCopyBuilder = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function paymentSmartCopyBuilderFactory(engine) {
  if (!engine) throw new Error("payment smart import v2 尚未載入");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const monthLabel = (month) => `${Number(month)}月`;
  const baseYear = 2026;

  function build({ crmSource, paymentImportedByYear }) {
    const source = clone(paymentImportedByYear || {});
    const byYear = { taichung: { 2026: {} }, huanrui: { 2026: {} } };
    const imported = { taichung: {}, huanrui: {} };
    for (const venue of ["taichung", "huanrui"]) {
      for (let month = 1; month <= 12; month += 1) {
        const label = monthLabel(month);
        const rows = clone(source?.[venue]?.["2026"]?.[label] || []).filter((row) => !row._testGenerated);
        if (rows.length) {
          byYear[venue]["2026"][label] = rows;
          imported[venue][label] = clone(rows);
        }
      }
    }
    const history = ["taichung", "huanrui"].flatMap((venue) => Object.entries(byYear[venue]["2026"]).flatMap(([label, rows]) =>
      rows.map((row) => ({ ...row, venue, year: 2026, month: Number(label.replace(/\D/g, "")), source_snapshot: row }))));
    const activeCrmRowsRaw = ["taichung", "huanrui"].flatMap((venue) => {
      const venueData = crmSource?.venues?.[venue];
      return Object.entries(venueData?.years || {}).flatMap(([year, rows]) => (rows || [])
        .filter((row) => {
          const state = String(row?.cycleState || row?.cycle_state || "historical");
          return row.folder !== "ended" && ["historical", "confirmed"].includes(state);
        })
        .map((row) => ({ ...row, venue, crmYear: Number(year) })));
    });
    const activeCrmRows = [];
    const seenCrmCycles = new Set();
    activeCrmRowsRaw.forEach((row) => {
      const key = `${row.venue}|${String(row.id || "").normalize("NFKC").trim().toUpperCase()}|p${Number(row.contractPeriod || row.contract_period) || 0}|${row.start}|${row.end}`;
      if (seenCrmCycles.has(key)) return;
      seenCrmCycles.add(key);
      activeCrmRows.push(row);
    });
    const maxContractYear = Math.max(baseYear, ...activeCrmRows.map((crm) => engine.parseRocDate(crm.end)?.westernYear || baseYear));
    const generatedYears = Array.from({ length: maxContractYear - baseYear + 1 }, (_, index) => baseYear + index);

    const addGenerated = (row) => {
      const venue = row.venue;
      const year = String(row.dueYear);
      const label = monthLabel(row.dueMonth);
      byYear[venue][year] ||= {};
      byYear[venue][year][label] ||= [];
      const legacy = {
        _testGenerated: true, section: row.section, id: row.customerNo, name: row.name || "", company: row.company || "",
        cycle: row.paymentCycle || "", start: row.contractStart || "", end: row.contractEnd || "",
        price: row.monthlyPrice == null ? "" : `${row.monthlyPrice}/m`, paidDate: "", paidAmount: "", nextDate: row.nextDate || "", invoice: "",
        manualStatus: "normal", note: row.type === "renewal-reminder" ? "合約到期，先確認續約" : "測試版 V2 由 2026 真實資料與 CRM 新循環帶入",
      };
      const type = legacy.note.startsWith("合約到期") ? "renewal-reminder" : "payment";
      const identity = `${legacy.id}|${legacy.cycle}|${legacy.start}|${legacy.end}|${type}`;
      if (!byYear[venue][year][label].some((item) => {
        const itemType = String(item.note || "").startsWith("合約到期") ? "renewal-reminder" : "payment";
        return `${item.id}|${item.cycle}|${item.start}|${item.end}|${itemType}` === identity;
      })) byYear[venue][year][label].push(legacy);
    };

    for (const venue of ["taichung", "huanrui"]) {
      for (const crm of activeCrmRows.filter((row) => row.venue === venue)) {
        const inputCrm = {
          venue, customerNo: crm.id, name: crm.name, company: crm.company, service: crm.item, paymentCycle: crm.cycle,
          contractStart: crm.start, contractEnd: crm.end, contractYears: crm.contractYears,
          amount: crm.amount, pricePlan: crm.pricePlan,
          hasSecondStage: crm.hasSecondStage,
          stage1Years: crm.stage1Years, stage1Start: crm.stage1Start, stage1End: crm.stage1End,
          stage2Years: crm.stage2Years, stage2Start: crm.stage2Start, stage2End: crm.stage2End,
          stage2Amount: crm.stage2Amount, stage2Kind: crm.stage2Kind,
          pricingStages: crm.pricingStages,
          status: "active",
        };
        if (engine.serviceKind(crm.item) === "free-seat" && !engine.parseRocDate(crm.end)) {
          for (const year of generatedYears) for (let month = 1; month <= 12; month += 1) {
            const preview = engine.buildPreview({ crm: inputCrm, history, mode: "new", targetYear: year, targetMonth: month });
            for (const row of preview.payments) addGenerated(row);
          }
          continue;
        }
        const start = engine.parseRocDate(crm.start);
        const preview = engine.buildPreview({ crm: inputCrm, history, mode: "new", targetYear: start?.westernYear, targetMonth: start?.month });
        for (const row of preview.payments.filter((item) => generatedYears.includes(item.dueYear))) addGenerated(row);
        if (preview.reminder && preview.reminder.dueYear > baseYear && generatedYears.includes(preview.reminder.dueYear)) {
          addGenerated(preview.reminder);
        }
      }
    }

    const copied2026Rows = Object.values(byYear.taichung["2026"]).flat().filter((row) => !row._testGenerated).length + Object.values(byYear.huanrui["2026"]).flat().filter((row) => !row._testGenerated).length;
    const generated2026Rows = Object.values(byYear.taichung["2026"]).flat().filter((row) => row._testGenerated).length + Object.values(byYear.huanrui["2026"]).flat().filter((row) => row._testGenerated).length;
    const generated2027Rows = Object.values(byYear.taichung["2027"] || {}).flat().length + Object.values(byYear.huanrui["2027"] || {}).flat().length;
    const generatedRowsByYear = Object.fromEntries(generatedYears.map((year) => [String(year),
      Object.values(byYear.taichung[String(year)] || {}).flat().filter((row) => row._testGenerated).length +
      Object.values(byYear.huanrui[String(year)] || {}).flat().filter((row) => row._testGenerated).length]));
    return { paymentImported: imported, paymentImportedByYear: byYear, paymentCurrent: clone(byYear.taichung["2026"]["6月"] || []), counts: { copied2026Rows, generated2026Rows, generated2027Rows, generatedRowsByYear, maxGeneratedYear: maxContractYear } };
  }

  return { build };
});
