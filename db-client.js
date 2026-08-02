(() => {
  const supabaseUrl = "https://khpgrfpnvgzkfjmxhuny.supabase.co";
  const supabaseKey = "sb_publishable_q13oqBYsvYnhkuuZ79kA5g_dt9YaujM";
  const supabaseCdn = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  let clientPromise = null;
  let platformDataPromise = null;
  let branchesPromise = null;
  const crmStorageKey = "hj-crm-clean-v5-data-repair";
  const crmYearSyncMarkerKey = "hj-crm-year-supabase-v1";
  const savedPageStateKeys = new Set([
    "hj-contract-drafts-v2",
    "hjDraftNoticeLogV1",
  ]);

  const venueLabels = {
    taichung: "台中館",
    huanrui: "環瑞館",
  };
  const currentGregorianYear = String(new Date().getFullYear());
  const crmCycle = () => window.HJCrmCycle;

  const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const moneyText = (value, suffix = "") => {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return `${number % 1 === 0 ? String(Math.trunc(number)) : String(number)}${suffix}`;
  };

  const textOrEmpty = (value) => String(value ?? "").trim();
  const comparableValue = (value) => {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(comparableValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, comparableValue(value[key])]),
      );
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return value;
  };
  const valuesMatch = (left, right) => (
    JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right))
  );
  const assertFieldsMatch = (actual, expected, fields, label) => {
    const mismatches = fields.filter((field) => !valuesMatch(actual?.[field], expected?.[field]));
    if (mismatches.length) {
      throw new Error(`${label} 寫入後核對失敗：${mismatches.join("、")}`);
    }
  };
  const normalizeCustomerNo = (value) => {
    if (window.HJCustomerId?.normalize) return window.HJCustomerId.normalize(value);
    const raw = String(value ?? "").normalize("NFKC").trim();
    return /^v\d*$/iu.test(raw) ? `V${raw.slice(1)}` : raw;
  };
  const canonicalRocDate = (value) => {
    const raw = textOrEmpty(value);
    if (!raw) return "";
    if (window.HJRocDate?.normalize) return window.HJRocDate.normalize(raw);
    const match = raw.normalize("NFKC").match(/^(\d{2,4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})$/);
    if (!match) return raw;
    const enteredYear = Number(match[1]);
    const rocYear = enteredYear >= 1911 ? enteredYear - 1911 : enteredYear;
    return `${rocYear}/${String(Number(match[2])).padStart(2, "0")}/${String(Number(match[3])).padStart(2, "0")}`;
  };
  const canonicalCustomerSnapshot = (row, customerNo = normalizeCustomerNo(row?.id || row?.customer_no)) => {
    const snapshot = { ...(row && typeof row === "object" ? row : {}), id: customerNo };
    ["start", "end", "signedAt", "birthday", "stage1Start", "stage1End", "stage2Start", "stage2End"].forEach((key) => {
      if (snapshot[key]) snapshot[key] = canonicalRocDate(snapshot[key]);
    });
    if (Array.isArray(snapshot.pricingStages)) {
      snapshot.pricingStages = snapshot.pricingStages.map((stage) => ({
        ...stage,
        ...(stage?.start ? { start: canonicalRocDate(stage.start) } : {}),
        ...(stage?.end ? { end: canonicalRocDate(stage.end) } : {}),
      }));
    }
    return snapshot;
  };
  const historicalPaymentSnapshot = (row, customerNo = normalizeCustomerNo(row?.id || row?.customer_no)) => {
    const snapshot = { ...(row && typeof row === "object" ? row : {}) };
    delete snapshot._dbDirtyFields;
    return {
      ...snapshot,
      id: customerNo,
    };
  };

  const isoToRoc = (value) => {
    if (!value) return "";
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return "";
    return `${Number(match[1]) - 1911}/${match[2]}/${match[3]}`;
  };

  const rocToIso = (value) => {
    const parsed = window.HJRocDate?.parse?.(value);
    if (parsed) return `${parsed.westernYear}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
    const match = String(value || "").match(/(\d{2,3})[/.年-](\d{1,2})[/.月-](\d{1,2})/);
    if (!match) return null;
    return `${Number(match[1]) + 1911}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  };

  const validIsoDate = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() + 1 !== Number(month)
      || date.getUTCDate() !== Number(day)
    ) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const paymentDateForDb = (value, fallbackWesternYear) => {
    const text = textOrEmpty(value);
    if (!text) return null;
    const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) return validIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);
    const rocDate = rocToIso(text);
    if (rocDate) return rocDate;
    const monthDay = text.match(/^(\d{1,2})[/.月-](\d{1,2})日?$/);
    if (!monthDay || !Number.isFinite(Number(fallbackWesternYear))) return null;
    return validIsoDate(Number(fallbackWesternYear), monthDay[1], monthDay[2]);
  };

  const dateKeyFromIso = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  };

  const contractYearsFromIso = (start, end) => {
    const startMatch = String(start || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    const endMatch = String(end || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!startMatch || !endMatch) return "";
    if (startMatch[2] !== endMatch[2] || startMatch[3] !== endMatch[3]) return "";
    const years = Number(endMatch[1]) - Number(startMatch[1]);
    return years > 0 ? String(years) : "";
  };

  const numericMoney = (value) => {
    const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  const normalizeCycle = (value) => {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return null;
    if (["M", "3M", "6M", "Y", "2Y", "3Y"].includes(text)) return text;
    return "custom";
  };

  const serviceTypeFromText = (...parts) => {
    const text = parts.filter(Boolean).join(" ");
    if (/辦公室/.test(text)) return "office";
    if (/自由座|共享座位|共享辦公室/.test(text)) return "seat";
    if (/會議室/.test(text)) return "meeting_room";
    if (/公司登記|代辦公司/.test(text)) return "company_registration";
    if (/信件/.test(text)) return "mail";
    if (/營登|營業登記|行號|小規模/.test(text)) return "registration";
    return "other";
  };

  const itemFromServiceType = (serviceType) => ({
    registration: "營登",
    office: "辦公室",
    seat: "自由座",
    meeting_room: "會議室",
    company_registration: "公司登記",
    mail: "信件",
    other: "其他",
  })[serviceType] || "其他";

  const monthNumber = (label) => {
    const number = Number(String(label || "").replace(/[^\d]/g, ""));
    return number >= 1 && number <= 12 ? number : 6;
  };

  const monthLabel = (number) => monthLabels[Number(number) - 1] || "6月";

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-hj-src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.defer = false;
    script.dataset.hjSrc = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.head.appendChild(script);
  });

  const loadSupabase = async () => {
    if (window.supabase?.createClient) return window.supabase;
    await loadScript(supabaseCdn);
    if (!window.supabase?.createClient) throw new Error("Supabase 載入失敗");
    return window.supabase;
  };

  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = loadSupabase().then((lib) => lib.createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "hj-supabase-auth-v1",
        },
      }));
    }
    return clientPromise;
  };

  const getSession = async () => {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  };

  const ensureSession = async () => {
    const session = await getSession();
    if (!session) {
      const next = encodeURIComponent(window.location.href);
      window.location.replace(`./home.html?next=${next}`);
      return null;
    }
    return session;
  };

  const signInOrSignUp = async (email, password, options = {}) => {
    const client = await getClient();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const preferSignUp = Boolean(options.preferSignUp);
    if (!preferSignUp) {
      const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (!signInError && signInData.session) return signInData.session;
    }
    
    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: normalizedEmail,
      password,
    });
    if (signUpError && !/already registered|already exists/i.test(signUpError.message || "")) throw signUpError;
    if (signUpData.session) return signUpData.session;
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (signInError) throw signInError;
    return signInData.session;
  };

  const signOut = async () => {
    const client = await getClient();
    await client.auth.signOut();
  };

  const queryAll = async (table, select = "*") => {
    const client = await getClient();
    const { data, error } = await client.from(table).select(select);
    if (error) throw error;
    return data || [];
  };

  const queryOptional = async (table, select = "*") => {
    const client = await getClient();
    const { data, error } = await client.from(table).select(select);
    if (error && ["PGRST205", "42P01"].includes(error.code)) return [];
    if (error) throw error;
    return data || [];
  };

  const getBranches = async () => {
    if (!branchesPromise) {
      branchesPromise = queryAll("branches", "id,code,name").then((rows) => ({
        list: rows,
        byCode: Object.fromEntries(rows.map((row) => [row.code, row])),
        byId: Object.fromEntries(rows.map((row) => [row.id, row])),
      }));
    }
    return branchesPromise;
  };

  const paymentCycleFromContract = (customer, contract) => textOrEmpty(contract?.payment_cycle || customer.payment_cycle);

  const contractModeFromPolicy = (policy) => {
    if (policy === "reuse_existing") return "renewal";
    return "";
  };

  const customerToCrmRow = (row, index, contract = null) => {
    const snapshot = row.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {};
    const contractDraft = snapshot.contractDraft && typeof snapshot.contractDraft === "object" ? snapshot.contractDraft : {};
    const storedOfficeMode = textOrEmpty(contractDraft.officeContractMode);
    const cycle = paymentCycleFromContract(row, contract);
    const monthly = contract?.monthly_amount ?? row.monthly_amount;
    const deposit = contract?.deposit_amount ?? row.deposit_amount;
    return {
      id: normalizeCustomerNo(row.customer_no),
      name: textOrEmpty(row.customer_name),
      company: textOrEmpty(row.company_name),
      category: textOrEmpty(snapshot.category),
      item: textOrEmpty(snapshot.item) || itemFromServiceType(row.service_type),
      cycle,
      start: isoToRoc(contract?.start_date || row.contract_start),
      end: isoToRoc(contract?.end_date || row.contract_end),
      mark: textOrEmpty(snapshot.mark),
      payDay: row.payment_day ? String(row.payment_day) : textOrEmpty(snapshot.payDay),
      amount: textOrEmpty(snapshot.amount) || moneyText(monthly, monthly ? "/m" : ""),
      pricePlan: textOrEmpty(snapshot.pricePlan),
      hasSecondStage: snapshot.hasSecondStage === true || snapshot.hasSecondStage === "true",
      stage1Years: textOrEmpty(snapshot.stage1Years),
      stage1Start: textOrEmpty(snapshot.stage1Start),
      stage1End: textOrEmpty(snapshot.stage1End),
      stage2Years: textOrEmpty(snapshot.stage2Years),
      stage2Start: textOrEmpty(snapshot.stage2Start),
      stage2End: textOrEmpty(snapshot.stage2End),
      stage2Amount: textOrEmpty(snapshot.stage2Amount),
      stage2Kind: textOrEmpty(snapshot.stage2Kind),
      pricingStages: Array.isArray(snapshot.pricingStages) ? snapshot.pricingStages : [],
      industry: textOrEmpty(snapshot.industry),
      signedAt: textOrEmpty(snapshot.signedAt) || isoToRoc(contract?.signed_date),
      deposit: textOrEmpty(snapshot.deposit) || moneyText(deposit),
      coNumber: textOrEmpty(row.company_tax_id || snapshot.coNumber),
      birthday: textOrEmpty(snapshot.birthday) || isoToRoc(row.birthday),
      address: textOrEmpty(row.address || snapshot.address),
      phone: textOrEmpty(row.phone || snapshot.phone),
      idNumber: textOrEmpty(row.identity_number || snapshot.idNumber),
      locker: textOrEmpty(snapshot.locker),
      mail: textOrEmpty(row.email || snapshot.mail),
      notes: textOrEmpty(row.notes || snapshot.notes),
      folder: row.crm_status === "ended" ? "ended" : "active",
      venue: row.branch_code,
      sourceSystem: textOrEmpty(row.source_system),
      sourceSnapshot: snapshot,
      sourceFormat: "db",
      uid: row.source_row_key || `${row.branch_code}-${row.crm_status || "active"}-${String(index + 1).padStart(3, "0")}-${normalizeCustomerNo(row.customer_no)}`,
      contractYears: textOrEmpty(snapshot.contractYears) || contractYearsFromIso(contract?.start_date || row.contract_start, contract?.end_date || row.contract_end),
      contractTerm: textOrEmpty(snapshot.contractTerm),
      depositPolicy: textOrEmpty(contract?.deposit_policy),
      officeContractMode: storedOfficeMode === "renewal" ? "renewal" : contractModeFromPolicy(contract?.deposit_policy),
      contractStatus: textOrEmpty(contract?.contract_status),
      cycleState: "historical",
      contractPeriod: Number(contract?.contract_period) || 1,
      currentContractPeriod: Number(contract?.contract_period) || 1,
      confirmedAt: "",
      isCurrentContract: true,
      stampVersion: textOrEmpty(contract?.stamp_version),
    };
  };

  const crmSourceWithVenues = (venues, activeVenue = "taichung") => ({
    generatedAt: new Date().toISOString(),
    activeVenue,
    sources: {
      taichung: {
        label: "台中館",
        sourceLabel: "Supabase 正式資料庫",
        sourceLink: supabaseUrl,
        idMode: "number",
      },
      huanrui: {
        label: "環瑞館",
        sourceLabel: "Supabase 正式資料庫",
        sourceLink: supabaseUrl,
        idMode: "v",
      },
    },
    venues,
  });

  const buildCrmSource = (customers, contracts = []) => {
    const contractByCustomer = new Map(contracts.map((contract) => [contract.customer_id, contract]));
    const venues = {};
    Object.keys(venueLabels).forEach((venue) => {
      const rows = customers
        .filter((row) => row.branch_code === venue)
        .sort((a, b) => String(a.customer_no).localeCompare(String(b.customer_no), "zh-Hant", { numeric: true }))
        .map((row, index) => customerToCrmRow(row, index, contractByCustomer.get(row.id)));
      venues[venue] = { activeYear: currentGregorianYear, years: { [currentGregorianYear]: rows } };
    });
    return crmSourceWithVenues(venues);
  };

  const preferredActiveYear = (years) => {
    if (years[currentGregorianYear]) return currentGregorianYear;
    const available = Object.keys(years).sort((a, b) => Number(a) - Number(b));
    return available.filter((year) => Number(year) <= Number(currentGregorianYear)).at(-1) || available[0] || currentGregorianYear;
  };

  const buildCrmSourceFromYearRows = (yearRows, branches, customers = [], contracts = []) => {
    if (!Array.isArray(yearRows) || !yearRows.length) return null;
    const venues = Object.fromEntries(Object.keys(venueLabels).map((venue) => [venue, { activeYear: "", years: {} }]));
    const currentCustomerById = new Map((customers || []).map((customer) => [customer.id, customer]));
    const currentContractByCustomer = new Map((contracts || []).map((contract) => [contract.customer_id, contract]));
    const currentPeriodByCustomer = new Map();
    yearRows.forEach((stored) => {
      const state = textOrEmpty(stored.cycle_state) || crmCycle()?.inferState?.(stored.row_data || {}, stored.year);
      if (!["historical", "confirmed"].includes(state) || !stored.customer_id) return;
      currentPeriodByCustomer.set(stored.customer_id, Math.max(currentPeriodByCustomer.get(stored.customer_id) || 1, Number(stored.contract_period) || 1));
    });
    yearRows
      .slice()
      .sort((left, right) => Number(left.year) - Number(right.year) || String(left.customer_no).localeCompare(String(right.customer_no), "zh-Hant", { numeric: true }))
      .forEach((stored, index) => {
        const venue = branches.byId[stored.branch_id]?.code;
        if (!venues[venue]) return;
        const year = String(stored.year);
        const snapshot = canonicalCustomerSnapshot(stored.row_data && typeof stored.row_data === "object" ? stored.row_data : {}, stored.customer_no);
        const currentCustomer = currentCustomerById.get(stored.customer_id);
        const cycleState = textOrEmpty(stored.cycle_state) || crmCycle()?.inferState?.(snapshot, year) || (Number(year) <= Number(currentGregorianYear) ? "historical" : "legacy_generated");
        const contractPeriod = Number(stored.contract_period) || 0;
        const snapshotStart = rocToIso(snapshot.start);
        const snapshotEnd = rocToIso(snapshot.end);
        const isCurrentContract = ["historical", "confirmed"].includes(cycleState)
          && Boolean(currentCustomer)
          && snapshotStart === textOrEmpty(currentCustomer.contract_start)
          && snapshotEnd === textOrEmpty(currentCustomer.contract_end)
          && textOrEmpty(currentCustomer.crm_status || "active") !== "ended";
        const row = {
          ...snapshot,
          id: normalizeCustomerNo(snapshot.id || stored.customer_no),
          folder: stored.folder === "ended" ? "ended" : "active",
          venue,
          uid: textOrEmpty(snapshot.uid || stored.source_row_key) || `${venue}-${year}-${String(index + 1).padStart(3, "0")}-${stored.customer_no}`,
          sourceFormat: "db-year",
          cycleState,
          contractPeriod,
          currentContractPeriod: currentPeriodByCustomer.get(stored.customer_id) || 1,
          confirmedAt: textOrEmpty(stored.confirmed_at),
          isCurrentContract,
        };
        venues[venue].years[year] ||= [];
        venues[venue].years[year].push(row);
      });
    Object.entries(venues).forEach(([venue, venueData]) => {
      const currentRows = (customers || [])
        .filter((customer) => customer.branch_code === venue)
        .sort((left, right) => String(left.customer_no).localeCompare(String(right.customer_no), "zh-Hant", { numeric: true }))
        .map((customer, index) => customerToCrmRow(customer, index, currentContractByCustomer.get(customer.id)));
      const currentYearRows = venueData.years[currentGregorianYear] ||= [];
      const existingCustomerNos = new Set(currentYearRows.map((row) => normalizeCustomerNo(row.id)));
      currentRows.forEach((row) => {
        if (!existingCustomerNos.has(normalizeCustomerNo(row.id))) currentYearRows.push(row);
      });
      crmCycle()?.projectCyclesToYearShells?.(venueData, Number(currentGregorianYear));
      const years = Object.keys(venueData.years).sort((a, b) => Number(a) - Number(b));
      venueData.activeYear = preferredActiveYear(venueData.years);
      venueData.years[venueData.activeYear] ||= [];
    });
    return crmSourceWithVenues(venues);
  };

  const paymentDbRowToLegacy = (row) => {
    const snapshot = row.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {};
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const manualStatus =
      snapshot.manualStatus ||
      snapshot.manual_status ||
      metadata.manual_status ||
      (row.row_status === "ignored" ? "nonbillable" : "");
    const dbCycle = textOrEmpty(row.payment_cycle);
    const snapshotCycle = textOrEmpty(snapshot.cycle);
    const cycle = dbCycle && dbCycle.toLowerCase() !== "custom" ? dbCycle : snapshotCycle || dbCycle;
    return {
      ...snapshot,
      _dbId: textOrEmpty(row.id),
      section: textOrEmpty(row.section || snapshot.section || "待確認"),
      id: normalizeCustomerNo(row.customer_no || snapshot.id),
      name: textOrEmpty(row.customer_name || snapshot.name),
      company: textOrEmpty(row.company_name || snapshot.company),
      cycle: textOrEmpty(cycle),
      price: textOrEmpty(snapshot.price || moneyText(row.amount_due)),
      paidDate: textOrEmpty(snapshot.paidDate || row.payment_date),
      paidAmount: textOrEmpty(snapshot.paidAmount || moneyText(row.amount_paid)),
      nextDate: textOrEmpty(snapshot.nextDate || row.next_payment_date),
      manualStatus: textOrEmpty(manualStatus),
      invoice: textOrEmpty(row.invoice_number || snapshot.invoice),
      note: textOrEmpty(row.memo || snapshot.note),
    };
  };

  const buildPaymentGlobals = (paymentRows) => {
    const imported = { taichung: {}, huanrui: {} };
    const importedByYear = { taichung: {}, huanrui: {} };
    let currentRows = [];
    paymentRows
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach((row) => {
        const venue = row.branch_code;
        const label = monthLabel(row.month);
        const legacy = paymentDbRowToLegacy(row);
        const yearKey = String(row.year || 2026);
        if (!importedByYear[venue]) importedByYear[venue] = {};
        if (!importedByYear[venue][yearKey]) importedByYear[venue][yearKey] = {};
        if (!importedByYear[venue][yearKey][label]) importedByYear[venue][yearKey][label] = [];
        importedByYear[venue][yearKey][label].push(legacy);
        if (venue === "taichung" && Number(row.year) === 2026 && Number(row.month) === 6) {
          currentRows.push(legacy);
          return;
        }
        if (!imported[venue]) imported[venue] = {};
        if (!imported[venue][label]) imported[venue][label] = [];
        imported[venue][label].push(legacy);
      });
    return { imported, importedByYear, currentRows };
  };

  const draftDbRowToLegacy = (row) => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceMonth = metadata.source_month || (row.scheduled_for ? monthLabel(new Date(row.scheduled_for).getMonth() + 1) : "6月");
    const sourceYear = Number(metadata.source_year || (row.scheduled_for ? new Date(row.scheduled_for).getFullYear() : 2026)) || 2026;
    const sourceId = metadata.source_id || row.id;
    const label = String(row.title || "").split(" / ").pop() || "訊息草稿";
    const fallbackPaymentRefs = [{ venue: row.branch_code, month: sourceMonth, year: sourceYear, id: row.customer_no }];
    const paymentRefs = (Array.isArray(metadata.payment_refs) && metadata.payment_refs.length ? metadata.payment_refs : fallbackPaymentRefs).map((ref) => ({
      ...ref,
      venue: ref.venue || ref.branch_code || row.branch_code,
      month: ref.month || sourceMonth,
      year: Number(ref.year || sourceYear) || sourceYear,
      id: normalizeCustomerNo(ref.id || ref.customer_no || row.customer_no),
    }));
    const dbStatus = String(row.status || "");
    const sourceStatus =
      dbStatus === "posted_waiting" || dbStatus === "sent"
        ? "follow"
        : dbStatus === "cancelled" || dbStatus === "done"
          ? "done"
          : metadata.source_status || "today";
    const lastNotifiedAt =
      textOrEmpty(metadata.lastNotifiedAt || metadata.last_notified_at) ||
      dateKeyFromIso(row.sent_at) ||
      (sourceStatus === "follow" ? dateKeyFromIso(row.updated_at) : "");
    return {
      id: sourceId,
      venue: row.branch_code,
      month: sourceMonth,
      year: sourceYear,
      status: sourceStatus,
      lastNotifiedAt,
      paymentRefs,
      kind: row.draft_type === "renewal" ? "續約" : "繳費追蹤",
      title: row.title || [row.customer_no, row.company_name || row.customer_name].filter(Boolean).join(" "),
      subtitle: row.company_name || row.customer_name || "",
      due: metadata.source_due || "",
      amount: metadata.source_amount || "",
      snoozeUntil: textOrEmpty(metadata.snooze_until || metadata.snoozeUntil),
      followNote: textOrEmpty(metadata.follow_note || metadata.followNote),
      messages: [{ label, body: row.body || "" }],
      persistedDraft: true,
      persistedStatus: dbStatus,
      renewalEventKey: textOrEmpty(metadata.renewal_event_key),
    };
  };

  const loadPlatformData = async () => {
    if (!platformDataPromise) {
      platformDataPromise = (async () => {
        await ensureSession();
        const [customers, contracts, paymentRows, drafts, settings, crmYearRows, branches] = await Promise.all([
          queryAll("v_customers_current"),
          queryAll("v_contracts_current"),
          queryAll("v_payment_month_table"),
          queryAll("v_message_draft_queue"),
          queryAll("system_settings", "key,value"),
          queryOptional("crm_year_rows"),
          getBranches(),
        ]);
        const crmSource = buildCrmSourceFromYearRows(crmYearRows, branches, customers, contracts) || buildCrmSource(customers, contracts);
        const paymentGlobals = buildPaymentGlobals(paymentRows);
        const settingsByKey = Object.fromEntries((settings || []).map((row) => [row.key, row.value]));
        return {
          crmSource,
          paymentImported: paymentGlobals.imported,
          paymentImportedByYear: paymentGlobals.importedByYear,
          paymentCurrent: paymentGlobals.currentRows,
          draftItems: drafts.map(draftDbRowToLegacy),
          stampAssets: settingsByKey.contract_stamp_assets_v1 || {},
          counts: {
            customers: customers.length,
            contracts: contracts.length,
            paymentRows: paymentRows.length,
            drafts: drafts.length,
            crmYearRows: crmYearRows.length,
          },
        };
      })();
    }
    return platformDataPromise;
  };

  const applyPlatformGlobals = async () => {
    const data = await loadPlatformData();
    window.HJ_CRM_SOURCE_DATA = data.crmSource;
    window.hjCrmSourceData = data.crmSource;
    window.hjImportedPaymentData = data.paymentImported;
    window.hjImportedPaymentDataByYear = data.paymentImportedByYear;
    window.hjDefaultPaymentRows = data.paymentCurrent;
    window.hjFutureDraftItems = data.draftItems;
    window.HJ_STAMP_ASSETS = data.stampAssets;
    return data;
  };

  const refreshPlatformData = async () => {
    platformDataPromise = null;
    return loadPlatformData();
  };

  const customerPayloadFromCrmRow = (row, branches) => {
    const branch = branches.byCode[row.venue || "taichung"];
    const customerNo = normalizeCustomerNo(row.id);
    if (!branch || !customerNo) return null;
    return {
      branch_id: branch.id,
      customer_no: customerNo,
      legacy_no: textOrEmpty(row.uid) || null,
      customer_name: textOrEmpty(row.name) || null,
      company_name: textOrEmpty(row.company) || null,
      company_tax_id: /^\d{8}$/.test(textOrEmpty(row.coNumber)) ? textOrEmpty(row.coNumber) : null,
      identity_number: textOrEmpty(row.idNumber) || null,
      birthday: rocToIso(row.birthday),
      phone: textOrEmpty(row.phone) || null,
      email: textOrEmpty(row.mail) || null,
      address: textOrEmpty(row.address) || null,
      service_type: serviceTypeFromText(row.item, row.category),
      payment_cycle: normalizeCycle(row.cycle),
      monthly_amount: numericMoney(row.amount),
      deposit_amount: numericMoney(row.deposit),
      contract_start: rocToIso(row.start),
      contract_end: rocToIso(row.end),
      payment_day: Number(row.payDay) || null,
      crm_status: row.folder === "ended" ? "ended" : "active",
      source_system: "web_crm",
      source_row_key: textOrEmpty(row.uid) || null,
      source_snapshot: canonicalCustomerSnapshot(row, customerNo),
      notes: textOrEmpty(row.notes) || null,
    };
  };

  const syncCrmData = async (crmData) => {
    const client = await getClient();
    const branches = await getBranches();
    const seen = new Map();
    Object.values(crmData?.venues || {}).forEach((venueData) => {
      Object.values(venueData.years || {}).forEach((rows) => {
        (rows || []).forEach((row) => {
          const payload = customerPayloadFromCrmRow(row, branches);
          if (payload) seen.set(`${payload.branch_id}|${payload.customer_no}`, payload);
        });
      });
    });
    const rows = Array.from(seen.values());
    if (!rows.length) return;
    const { error } = await client.from("customers").upsert(rows, { onConflict: "branch_id,customer_no" });
    if (error) throw error;
  };

  const crmYearPayloads = async (crmData, source = "web_crm") => {
    const branches = await getBranches();
    const customers = await queryAll("customers", "id,branch_id,customer_no");
    const customerByKey = new Map(customers.map((customer) => [`${customer.branch_id}|${normalizeCustomerNo(customer.customer_no)}`, customer.id]));
    const payloads = [];
    Object.entries(crmData?.venues || {}).forEach(([venue, venueData]) => {
      const branch = branches.byCode[venue];
      if (!branch) return;
      Object.entries(venueData?.years || {}).forEach(([year, rows]) => {
        (rows || []).forEach((row) => {
          if (row?.isProjection === true) return;
          const customerNo = normalizeCustomerNo(row.id);
          if (!customerNo) return;
          payloads.push({
            branch_id: branch.id,
            customer_id: customerByKey.get(`${branch.id}|${customerNo}`) || null,
            year: Number(year),
            customer_no: customerNo,
            folder: row.folder === "ended" ? "ended" : "active",
            source_row_key: textOrEmpty(row.uid) || null,
            row_data: canonicalCustomerSnapshot({ ...row, venue }, customerNo),
            source,
            cycle_state: textOrEmpty(row.cycleState || row.cycle_state) || crmCycle()?.inferState?.(row, year) || "legacy_generated",
            contract_period: Number(row.contractPeriod || row.contract_period) || 0,
            confirmed_at: textOrEmpty(row.confirmedAt || row.confirmed_at) || null,
          });
        });
      });
    });
    return payloads;
  };

  const upsertCrmYearPayloads = async (payloads) => {
    const client = await getClient();
    for (let index = 0; index < payloads.length; index += 400) {
      const batch = payloads.slice(index, index + 400);
      const { error } = await client.from("crm_year_rows").upsert(batch, { onConflict: "branch_id,year,customer_no,contract_period" });
      if (error) throw error;
    }
  };

  const syncCrmYearData = async (crmData, options = {}) => {
    const payloads = await crmYearPayloads(crmData, options.source || "web_crm");
    if (!payloads.length) return { rows: 0 };
    await upsertCrmYearPayloads(payloads);
    localStorage.setItem(crmYearSyncMarkerKey, "ready");
    platformDataPromise = null;
    return { rows: payloads.length };
  };

  const saveCrmYearRow = async (row, year, customerId, branchId) => {
    const customerNo = normalizeCustomerNo(row.id);
    const payload = {
      branch_id: branchId,
      customer_id: customerId || null,
      year: Number(year),
      customer_no: customerNo,
      folder: row.folder === "ended" ? "ended" : "active",
      source_row_key: textOrEmpty(row.uid) || null,
      row_data: canonicalCustomerSnapshot({ ...row, venue: row.venue || "taichung" }, customerNo),
      source: "web_crm",
      cycle_state: textOrEmpty(row.cycleState || row.cycle_state) || crmCycle()?.inferState?.(row, year) || "legacy_generated",
      contract_period: Number(row.contractPeriod || row.contract_period) || 0,
      confirmed_at: textOrEmpty(row.confirmedAt || row.confirmed_at) || null,
    };
    await upsertCrmYearPayloads([payload]);
    localStorage.setItem(crmYearSyncMarkerKey, "ready");
  };

  const verifyCrmPersistence = async (row, options, customerPayload, expectedPeriod, verifyCustomer = true) => {
    const client = await getClient();
    if (verifyCustomer) {
      const { data: savedCustomer, error: customerError } = await client
        .from("customers")
        .select("*")
        .eq("branch_id", customerPayload.branch_id)
        .eq("customer_no", customerPayload.customer_no)
        .maybeSingle();
      if (customerError) throw customerError;
      if (!savedCustomer) throw new Error("CRM 寫入後找不到客戶資料");
      assertFieldsMatch(savedCustomer, customerPayload, [
        "branch_id",
        "customer_no",
        "customer_name",
        "company_name",
        "company_tax_id",
        "identity_number",
        "birthday",
        "phone",
        "email",
        "address",
        "service_type",
        "payment_cycle",
        "monthly_amount",
        "deposit_amount",
        "contract_start",
        "contract_end",
        "payment_day",
        "crm_status",
        "source_row_key",
        "notes",
      ], "CRM 客戶資料");
    }

    const year = Number(options.year) || new Date().getFullYear();
    let yearQuery = client
      .from("crm_year_rows")
      .select("id,folder,row_data,contract_period")
      .eq("branch_id", customerPayload.branch_id)
      .eq("year", year)
      .eq("customer_no", customerPayload.customer_no);
    if (Number.isInteger(Number(expectedPeriod))) {
      yearQuery = yearQuery.eq("contract_period", Number(expectedPeriod));
    }
    const { data: savedYearRow, error: yearRowError } = await yearQuery.maybeSingle();
    if (yearRowError) throw yearRowError;
    if (!savedYearRow) throw new Error("CRM 年度資料寫入後找不到");
    const expectedSnapshot = canonicalCustomerSnapshot(
      { ...row, venue: row.venue || "taichung" },
      customerPayload.customer_no,
    );
    const snapshotFields = [
      "id",
      "name",
      "company",
      "category",
      "item",
      "start",
      "end",
      "cycle",
      "amount",
      "stageAmount",
      "deposit",
      "payDay",
      "coNumber",
      "birthday",
      "address",
      "phone",
      "idNumber",
      "mail",
      "folder",
    ].filter((field) => Object.prototype.hasOwnProperty.call(expectedSnapshot, field));
    assertFieldsMatch(savedYearRow.row_data || {}, expectedSnapshot, snapshotFields, "CRM 年度資料");
    const expectedFolder = row.folder === "ended" ? "ended" : "active";
    if (savedYearRow.folder !== expectedFolder) throw new Error("CRM 年度狀態寫入後核對失敗");
    return { verified: true, customerNo: customerPayload.customer_no, year };
  };

  const markCrmYearSyncPending = () => localStorage.removeItem(crmYearSyncMarkerKey);

  const migrateLegacyCrmYears = async () => {
    // 安全邊界：頁面載入時不再把瀏覽器舊快照整批回寫正式 CRM。
    return { migrated: false, rows: 0 };
  };

  const saveCrmRow = async (row, options = {}) => {
    const client = await getClient();
    const branches = await getBranches();
    const intent = ["new", "edit", "renewal", "folder"].includes(options.intent) ? options.intent : "edit";
    const customerPayload = customerPayloadFromCrmRow(row, branches);
    if (!customerPayload) throw new Error("CRM 資料不足，無法儲存正式資料");

    const existingCustomerQuery = await client
      .from("customers")
      .select("id,branch_id,customer_no,contract_start,contract_end")
      .eq("branch_id", customerPayload.branch_id)
      .eq("customer_no", customerPayload.customer_no)
      .maybeSingle();
    if (existingCustomerQuery.error) throw existingCustomerQuery.error;
    if (intent === "new" && existingCustomerQuery.data) throw new Error("此編號已存在，不能當新客戶重複建立");

    const existingCustomer = existingCustomerQuery.data;

    const rowState = textOrEmpty(row.cycleState || row.cycle_state) || crmCycle()?.inferState?.(row, options.year);
    const canMutateCurrent = ["historical", "confirmed"].includes(rowState) && row.isCurrentContract !== false;
    if (intent === "renewal") {
      if (!existingCustomer) throw new Error("找不到可續約的目前 CRM");
      const expectedPeriod = Number(options.expectedContractPeriod);
      if (!Number.isInteger(expectedPeriod) || expectedPeriod < 1) throw new Error("CRM 期次無法判讀，請重新整理後再續約");
      if (options.expectedStart && options.expectedStart !== existingCustomer.contract_start) throw new Error("CRM 起始日已變更，請重新整理後再續約");
      if (options.expectedEnd && options.expectedEnd !== existingCustomer.contract_end) throw new Error("CRM 到期日已變更，請重新整理後再續約");
    } else if (["edit", "folder"].includes(intent) && !canMutateCurrent) {
      // 歷史列或舊系統預生列只能保存該年度快照，不可反向覆蓋目前 CRM。
      await saveCrmYearRow(row, Number(options.year) || new Date().getFullYear(), existingCustomer?.id || null, customerPayload.branch_id);
      await verifyCrmPersistence(
        row,
        options,
        customerPayload,
        Number(row.contractPeriod || row.contract_period) || 0,
        false,
      );
      platformDataPromise = null;
      return existingCustomer || { id: null, branch_id: customerPayload.branch_id };
    }

    if (intent === "renewal") {
      const nextPeriod = Number(options.expectedContractPeriod) + 1;
      const renewalSavedRow = {
        ...row,
        cycleState: "confirmed",
        contractPeriod: nextPeriod,
        confirmedAt: new Date().toISOString(),
        isCurrentContract: true,
      };
      const year = Number(options.year) || new Date().getFullYear();
      const yearRowPayload = {
        branch_id: existingCustomer.branch_id,
        year,
        customer_no: normalizeCustomerNo(renewalSavedRow.id),
        folder: "active",
        source_row_key: textOrEmpty(renewalSavedRow.uid) || null,
        row_data: canonicalCustomerSnapshot({ ...renewalSavedRow, venue: renewalSavedRow.venue || "taichung" }, normalizeCustomerNo(renewalSavedRow.id)),
        source: "web_crm",
      };
      const { error } = await client.rpc("save_confirmed_crm_renewal", {
        p_customer_id: existingCustomer.id,
        p_expected_contract_period: Number(options.expectedContractPeriod),
        p_expected_start: options.expectedStart,
        p_expected_end: options.expectedEnd,
        p_customer_payload: customerPayload,
        p_year_row_payload: yearRowPayload,
      });
      if (error) throw error;
      await verifyCrmPersistence(renewalSavedRow, options, customerPayload, nextPeriod, true);
      platformDataPromise = null;
      return { ...existingCustomer, row: renewalSavedRow };
    }

    let savedCustomer = existingCustomer;
    if (intent !== "renewal") {
      const { data, error: customerError } = await client
        .from("customers")
        .upsert(customerPayload, { onConflict: "branch_id,customer_no" })
        .select("id,branch_id")
        .single();
      if (customerError) throw customerError;
      savedCustomer = data;
    }

    const savedRow = {
      ...row,
      cycleState: rowState || "confirmed",
      contractPeriod: Number(row.contractPeriod || row.contract_period) || 1,
      confirmedAt: textOrEmpty(row.confirmedAt) || (intent === "new" ? new Date().toISOString() : null),
      isCurrentContract: true,
    };
    await saveCrmYearRow(savedRow, Number(options.year) || new Date().getFullYear(), savedCustomer.id, savedCustomer.branch_id);
    await verifyCrmPersistence(
      savedRow,
      options,
      customerPayload,
      Number(savedRow.contractPeriod || savedRow.contract_period) || 1,
      true,
    );

    if (intent === "folder" && row.folder === "ended") {
      const { error: invalidateError } = await client
        .from("crm_year_rows")
        .update({ cycle_state: "invalidated" })
        .eq("branch_id", savedCustomer.branch_id)
        .eq("customer_no", normalizeCustomerNo(row.id))
        .eq("cycle_state", "legacy_generated")
        .gt("year", Number(options.year) || new Date().getFullYear());
      if (invalidateError) throw invalidateError;
    }

    platformDataPromise = null;
    return { ...savedCustomer, row: savedRow };
  };

  const parsePaymentStorageKey = (key) => {
    if (key === "hjPaymentRows202606TaichungV1") return { venue: "taichung", year: 2026, month: "6月" };
    const match = String(key || "").match(/^hjPaymentRows(\d{4})_(taichung|huanrui)_(\d{1,2}月)_v1$/);
    if (!match) return null;
    return { year: Number(match[1]), venue: match[2], month: match[3] };
  };

  const paymentPayloadFromLegacy = (row, context, branches, customersByNo, index) => {
    const branch = branches.byCode[context.venue];
    if (!branch) return null;
    const customerNo = normalizeCustomerNo(row.id);
    const customer = customerNo ? customersByNo.get(customerNo) : null;
    return {
      branch_id: branch.id,
      customer_id: customer?.id || null,
      year: Number(context.year),
      month: monthNumber(context.month),
      section: textOrEmpty(row.section) || "待確認",
      sort_order: index,
      customer_no: customerNo || null,
      customer_name: textOrEmpty(row.name) || null,
      company_name: textOrEmpty(row.company) || null,
      service_type: serviceTypeFromText(row.section, row.note),
      payment_cycle: normalizeCycle(row.cycle),
      amount_due: numericMoney(row.price),
      amount_paid: numericMoney(row.paidAmount),
      // 人工欄位仍原樣保存在 source_snapshot；資料庫日期欄只接收可安全判讀的完整日期。
      payment_date: paymentDateForDb(row.paidDate, context.year),
      next_payment_date: paymentDateForDb(row.nextDate),
      invoice_status: /✔|V|已開|開立/.test(String(row.invoice || "")) ? "issued" : "pending",
      invoice_number: textOrEmpty(row.invoice) || null,
      row_status: numericMoney(row.paidAmount) ? "paid" : row.manualStatus === "nonbillable" ? "ignored" : "open",
      reminder_state: /已通知|已貼/.test(String(row.note || "")) ? "posted_waiting" : "none",
      memo: textOrEmpty(row.note) || null,
      source_system: "manual",
      source_snapshot: historicalPaymentSnapshot(row, customerNo),
      metadata: {
        source_month_label: context.month,
        start: row.start || null,
        end: row.end || null,
        price: row.price || null,
        manual_status: row.manualStatus || null,
      },
    };
  };

  const paymentRowIdentity = (row) => {
    const snapshot = row?.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {};
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const rowKey = textOrEmpty(snapshot._rowKey || row?._rowKey);
    if (rowKey) return `key:${rowKey}`;
    return [
      normalizeCustomerNo(row?.customer_no ?? row?.id),
      textOrEmpty(row?.payment_cycle ?? row?.cycle).toUpperCase(),
      textOrEmpty(metadata.start || snapshot.start || row?.start),
      textOrEmpty(metadata.end || snapshot.end || row?.end),
    ].join("|");
  };

  const syncPaymentRows = async (key, rows) => {
    const context = parsePaymentStorageKey(key);
    if (!context || !Array.isArray(rows)) return;
    const client = await getClient();
    const branches = await getBranches();
    const branch = branches.byCode[context.venue];
    if (!branch) return;
    const { data: customers, error: customersError } = await client
      .from("customers")
      .select("id,customer_no")
      .eq("branch_id", branch.id);
    if (customersError) throw customersError;
    const customersByNo = new Map((customers || []).map((customer) => [normalizeCustomerNo(customer.customer_no), customer]));
    const month = monthNumber(context.month);
    const payloadEntries = rows
      .map((sourceRow, index) => ({
        sourceRow,
        payload: paymentPayloadFromLegacy(sourceRow, context, branches, customersByNo, index),
      }))
      .filter((entry) => Boolean(entry.payload));
    if (!payloadEntries.length) return;

    // Payment months contain hand-entered collection history. Never mirror a
    // browser array by deleting the formal month first. Existing rows are
    // updated only when their DB id is present; genuinely new rows are inserted
    // one by one, and missing browser rows leave formal history untouched.
    const { data: existingRows, error: existingError } = await client
      .from("payment_month_rows")
      .select("id,customer_no,payment_cycle,source_snapshot,metadata")
      .eq("branch_id", branch.id)
      .eq("year", Number(context.year))
      .eq("month", month);
    if (existingError) throw existingError;

    const existingById = new Map((existingRows || []).map((row) => [textOrEmpty(row.id), row]));
    const existingIdentities = new Set((existingRows || []).map(paymentRowIdentity));
    const allowedDirtyFields = new Set([
      "section",
      "name",
      "company",
      "cycle",
      "start",
      "end",
      "price",
      "paidDate",
      "paidAmount",
      "nextDate",
      "invoice",
      "manualStatus",
      "note",
      "previousSection",
      "previousVenue",
      "previousYear",
      "previousMonth",
      "previousNote",
    ]);
    const existingPatchFor = (existing, payload, sourceRow) => {
      const dirtyFields = Array.from(new Set(
        (Array.isArray(sourceRow?._dbDirtyFields) ? sourceRow._dbDirtyFields : [])
          .map(textOrEmpty)
          .filter((field) => allowedDirtyFields.has(field)),
      ));
      if (!dirtyFields.length) return null;

      const patch = {};
      const snapshot = {
        ...(existing?.source_snapshot && typeof existing.source_snapshot === "object" ? existing.source_snapshot : {}),
      };
      const metadata = {
        ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      };
      let metadataChanged = false;
      dirtyFields.forEach((field) => {
        snapshot[field] = payload.source_snapshot?.[field] ?? null;
      });
      patch.source_snapshot = snapshot;

      if (dirtyFields.includes("section")) {
        patch.section = payload.section;
        patch.service_type = payload.service_type;
      }
      if (dirtyFields.includes("name")) patch.customer_name = payload.customer_name;
      if (dirtyFields.includes("company")) patch.company_name = payload.company_name;
      if (dirtyFields.includes("cycle")) patch.payment_cycle = payload.payment_cycle;
      if (dirtyFields.includes("price")) {
        patch.amount_due = payload.amount_due;
        metadata.price = payload.metadata?.price ?? null;
        metadataChanged = true;
      }
      if (dirtyFields.includes("start")) {
        metadata.start = payload.metadata?.start ?? null;
        metadataChanged = true;
      }
      if (dirtyFields.includes("end")) {
        metadata.end = payload.metadata?.end ?? null;
        metadataChanged = true;
      }
      if (dirtyFields.includes("paidDate")) patch.payment_date = payload.payment_date;
      if (dirtyFields.includes("paidAmount")) {
        patch.amount_paid = payload.amount_paid;
        patch.row_status = payload.row_status;
      }
      if (dirtyFields.includes("nextDate")) patch.next_payment_date = payload.next_payment_date;
      if (dirtyFields.includes("invoice")) {
        patch.invoice_status = payload.invoice_status;
        patch.invoice_number = payload.invoice_number;
      }
      if (dirtyFields.includes("manualStatus")) {
        patch.row_status = payload.row_status;
        metadata.manual_status = payload.metadata?.manual_status ?? null;
        metadataChanged = true;
      }
      if (dirtyFields.includes("note")) {
        patch.memo = payload.memo;
        patch.reminder_state = payload.reminder_state;
      }
      if (metadataChanged) patch.metadata = metadata;
      return patch;
    };

    const expectedUpdates = [];
    const expectedInsertIdentities = [];
    for (const { payload, sourceRow } of payloadEntries) {
      const dbId = textOrEmpty(sourceRow._dbId);
      if (dbId && existingById.has(dbId)) {
        const patch = existingPatchFor(existingById.get(dbId), payload, sourceRow);
        if (!patch) continue;
        const { error: updateError } = await client
          .from("payment_month_rows")
          .update(patch)
          .eq("id", dbId);
        if (updateError) throw updateError;
        expectedUpdates.push({ id: dbId, patch });
        continue;
      }
      const identity = paymentRowIdentity(payload);
      if (existingIdentities.has(identity)) continue;
      const { error: insertError } = await client.from("payment_month_rows").insert(payload);
      if (insertError) throw insertError;
      existingIdentities.add(identity);
      expectedInsertIdentities.push({ identity, payload });
    }

    const { data: verifiedRows, error: verificationError } = await client
      .from("payment_month_rows")
      .select("*")
      .eq("branch_id", branch.id)
      .eq("year", Number(context.year))
      .eq("month", month);
    if (verificationError) throw verificationError;
    const verifiedById = new Map((verifiedRows || []).map((row) => [textOrEmpty(row.id), row]));
    expectedUpdates.forEach(({ id, patch }) => {
      const saved = verifiedById.get(id);
      if (!saved) throw new Error(`繳費表寫入後找不到資料列 ${id}`);
      assertFieldsMatch(saved, patch, Object.keys(patch), "繳費表");
    });
    expectedInsertIdentities.forEach(({ identity, payload }) => {
      const saved = (verifiedRows || []).find((row) => paymentRowIdentity(row) === identity);
      if (!saved) throw new Error(`繳費表新增後找不到資料列 ${payload.customer_no || ""}`);
      assertFieldsMatch(saved, payload, [
        "section",
        "customer_no",
        "customer_name",
        "company_name",
        "payment_cycle",
        "amount_due",
        "amount_paid",
        "payment_date",
        "next_payment_date",
        "invoice_status",
        "row_status",
        "memo",
      ], "繳費表");
    });
    return {
      verified: true,
      updated: expectedUpdates.length,
      inserted: expectedInsertIdentities.length,
    };
  };

  const verifyPaymentRowTargets = async (targets = []) => {
    const expectedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!expectedTargets.length) return { verified: true, targets: 0 };

    const client = await getClient();
    const branches = await getBranches();
    const grouped = new Map();

    expectedTargets.forEach((target) => {
      const venue = normalizeVenue(target?.venue);
      const branch = branches.byCode[venue];
      const year = Number(target?.year);
      const month = monthNumber(target?.month);
      if (!branch || !Number.isFinite(year) || !month) {
        throw new Error("繳費表寫入驗證缺少館別或年月");
      }
      const key = `${branch.id}|${year}|${month}`;
      if (!grouped.has(key)) grouped.set(key, { branch, venue, year, month, targets: [] });
      grouped.get(key).targets.push(target);
    });

    for (const group of grouped.values()) {
      const { data, error } = await client
        .from("payment_month_rows")
        .select("id,customer_no,payment_cycle,source_snapshot,metadata")
        .eq("branch_id", group.branch.id)
        .eq("year", group.year)
        .eq("month", group.month);
      if (error) throw error;

      const identities = new Set((data || []).map(paymentRowIdentity));
      group.targets.forEach((target) => {
        const identity = paymentRowIdentity(target.row);
        if (identities.has(identity)) return;
        const customerNo = normalizeCustomerNo(target?.row?.customer_no ?? target?.row?.id);
        throw new Error(
          `繳費表寫入後找不到 ${group.venue} ${group.year}/${String(group.month).padStart(2, "0")} ${customerNo}`,
        );
      });
    }

    return { verified: true, targets: expectedTargets.length };
  };

  const syncDraftEdits = async (edits) => {
    if (!edits || typeof edits !== "object") return;
    const client = await getClient();
    const branches = await getBranches();
    const { data, error } = await client.from("message_drafts").select("id,metadata");
    if (error) throw error;
    const updates = [];
    const inserts = [];
    Object.entries(edits).forEach(([key, body]) => {
      const [sourceId, indexText] = key.split("::");
      const messageIndex = Number(indexText || 0);
      const match = (data || []).find((row) => row.metadata?.source_id === sourceId && Number(row.metadata?.source_message_index || 0) === messageIndex);
      if (match) updates.push({ id: match.id, body: String(body) });
      else {
        const parsed = parseAutoDraftSourceId(sourceId);
        const branch = parsed ? branches.byCode[parsed.venue] : null;
        if (branch) {
          inserts.push({
            branch_id: branch.id,
            channel: "line",
            draft_type: "payment_reminder",
            title: `自動草稿 ${parsed.customerNo || sourceId}`,
            body: String(body),
            status: "draft",
            requires_human_confirmation: true,
            metadata: {
              source_id: sourceId,
              source_message_index: messageIndex,
              source_status: "today",
              source_year: parsed.year,
              source_month: `${parsed.month}月`,
              payment_refs: [{ venue: parsed.venue, year: parsed.year, month: `${parsed.month}月`, id: parsed.customerNo }],
            },
          });
        }
      }
    });
    for (const update of updates) {
      const { error: updateError } = await client.from("message_drafts").update({ body: update.body }).eq("id", update.id);
      if (updateError) throw updateError;
    }
    if (inserts.length) {
      const { error: insertError } = await client.from("message_drafts").insert(inserts);
      if (insertError) throw insertError;
    }
    const { data: verifiedRows, error: verificationError } = await client
      .from("message_drafts")
      .select("id,body,metadata");
    if (verificationError) throw verificationError;
    Object.entries(edits).forEach(([key, body]) => {
      const [sourceId, indexText] = key.split("::");
      const messageIndex = Number(indexText || 0);
      const saved = (verifiedRows || []).find((row) => (
        row.metadata?.source_id === sourceId
        && Number(row.metadata?.source_message_index || 0) === messageIndex
      ));
      if (!saved || String(saved.body ?? "") !== String(body)) {
        throw new Error(`訊息草稿 ${key} 寫入後核對失敗`);
      }
    });
    return { verified: true, rows: Object.keys(edits).length };
  };

  const syncPageState = async (stateKey, payload) => {
    if (!savedPageStateKeys.has(stateKey)) return { verified: true, rows: 0 };
    const client = await getClient();
    const statePayload = {
      state_key: stateKey,
      payload: payload && typeof payload === "object" ? payload : {},
      updated_at: new Date().toISOString(),
    };
    const { error } = await client
      .from("page_saved_state")
      .upsert(statePayload, { onConflict: "state_key" });
    if (error) throw error;
    const { data: saved, error: verificationError } = await client
      .from("page_saved_state")
      .select("state_key,payload")
      .eq("state_key", stateKey)
      .maybeSingle();
    if (verificationError) throw verificationError;
    if (!saved || !valuesMatch(saved.payload, statePayload.payload)) {
      throw new Error(`${stateKey} 寫入後核對失敗`);
    }
    return { verified: true, rows: 1 };
  };

  const hydrateSavedPageState = async (page) => {
    const keysByPage = {
      contracts: ["hj-contract-drafts-v2"],
      drafts: ["hjDraftNoticeLogV1"],
    };
    const keys = keysByPage[page] || [];
    if (!keys.length) return { rows: 0 };
    const client = await getClient();
    const { data, error } = await client
      .from("page_saved_state")
      .select("state_key,payload")
      .in("state_key", keys);
    if (error) throw error;
    (data || []).forEach((row) => {
      localStorage.setItem(row.state_key, JSON.stringify(row.payload || {}));
    });
    return { rows: (data || []).length };
  };

  const paymentRefKey = (ref = {}, fallbackYear = 2026) => [
    "payment-ref",
    ref.venue || ref.branch_code || "",
    ref.year || fallbackYear || 2026,
    ref.month || "",
    normalizeCustomerNo(ref.id || ref.customer_no),
  ].join("|");

  const legacyPaymentRefKey = (ref = {}) => [
    "payment-ref",
    ref.venue || ref.branch_code || "",
    "",
    ref.month || "",
    normalizeCustomerNo(ref.id || ref.customer_no),
  ].join("|");

  const draftKeysFromMetadata = (metadata = {}, fallbackId = "") => {
    const keys = new Set();
    if (fallbackId) keys.add(String(fallbackId));
    if (metadata.source_id) keys.add(String(metadata.source_id));
    if (metadata.renewal_event_key) keys.add(String(metadata.renewal_event_key));
    const fallbackYear = Number(metadata.source_year) || 2026;
    (Array.isArray(metadata.payment_refs) ? metadata.payment_refs : []).forEach((ref) => {
      const canonicalKey = paymentRefKey(ref, fallbackYear);
      const legacyKey = legacyPaymentRefKey(ref);
      if (canonicalKey) keys.add(canonicalKey);
      if (legacyKey) keys.add(legacyKey);
    });
    return keys;
  };

  const markDraftItemNotified = async (item) => {
    if (!item || typeof item !== "object") return;
    const client = await getClient();
    const branches = await getBranches();
    const branch = branches.byCode[item.venue || "taichung"];
    if (!branch) return;
    const notifiedAt = new Date().toISOString();
    const notifiedDate = dateKeyFromIso(notifiedAt);
    const sourceYear = Number(item.year) || 2026;
    const paymentRefs = (Array.isArray(item.paymentRefs) ? item.paymentRefs : []).map((ref) => ({
      ...ref,
      venue: ref.venue || item.venue || "taichung",
      month: ref.month || item.month || null,
      year: Number(ref.year || sourceYear) || sourceYear,
      id: normalizeCustomerNo(ref.id || item.id),
    }));
    const itemMetadata = {
      source_id: normalizeCustomerNo(item.id),
      source_status: "follow",
      source_year: sourceYear,
      source_month: textOrEmpty(item.month) || null,
      source_due: textOrEmpty(item.due),
      source_amount: textOrEmpty(item.amount),
      payment_refs: paymentRefs,
      lastNotifiedAt: notifiedDate,
      last_notified_at: notifiedDate,
      ...(textOrEmpty(item.renewalEventKey) ? { renewal_event_key: textOrEmpty(item.renewalEventKey) } : {}),
    };
    const itemKeys = draftKeysFromMetadata(itemMetadata, item.id);
    const { data, error } = await client.from("message_drafts").select("id,branch_id,metadata");
    if (error) throw error;
    const matches = (data || []).filter((row) => {
      if (row.branch_id && row.branch_id !== branch.id) return false;
      const rowKeys = draftKeysFromMetadata(row.metadata || {}, row.metadata?.source_id);
      return Array.from(itemKeys).some((key) => rowKeys.has(key));
    });
    for (const row of matches) {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const { error: updateError } = await client
        .from("message_drafts")
        .update({
          status: "posted_waiting",
          sent_at: notifiedAt,
          metadata: { ...metadata, ...itemMetadata },
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
    }
    if (matches.length) {
      const { data: verified, error: verificationError } = await client
        .from("message_drafts")
        .select("id,status,sent_at,metadata")
        .in("id", matches.map((row) => row.id));
      if (verificationError) throw verificationError;
      matches.forEach((row) => {
        const saved = (verified || []).find((itemRow) => itemRow.id === row.id);
        if (!saved || saved.status !== "posted_waiting" || !saved.sent_at) {
          throw new Error("訊息通知狀態寫入後核對失敗");
        }
      });
      return { verified: true, rows: matches.length };
    }
    const firstMessage = Array.isArray(item.messages) ? item.messages[0] : null;
    const insertPayload = {
      branch_id: branch.id,
      channel: "line",
      draft_type: item.kind === "續約" ? "renewal" : "payment_reminder",
      title: textOrEmpty(item.title) || textOrEmpty(item.id) || "訊息草稿",
      body: textOrEmpty(firstMessage?.body),
      status: "posted_waiting",
      sent_at: notifiedAt,
      requires_human_confirmation: true,
      metadata: itemMetadata,
    };
    const { data: inserted, error: insertError } = await client
      .from("message_drafts")
      .insert(insertPayload)
      .select("id,status,sent_at,metadata")
      .single();
    if (insertError) throw insertError;
    if (!inserted?.id || inserted.status !== "posted_waiting" || !inserted.sent_at) {
      throw new Error("訊息通知狀態新增後核對失敗");
    }
    return { verified: true, rows: 1 };
  };

  const parseAutoDraftSourceId = (sourceId) => {
    const match = String(sourceId || "").match(/^auto-(\d{4})-(taichung|huanrui)-(\d{1,2})-([^-]+)/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      venue: match[2],
      month: Number(match[3]),
      customerNo: normalizeCustomerNo(match[4]),
    };
  };

  const installLocalStorageSync = () => {
    if (window.__hjDbLocalStorageSyncInstalled) return;
    window.__hjDbLocalStorageSyncInstalled = true;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const outboxStorageKey = "hj-db-pending-writes-v1";
    const queue = new Map();
    let timer = null;
    let flushPromise = null;
    let lastState = "idle";
    const isSyncedStorageKey = (key) => Boolean(
      parsePaymentStorageKey(key)
      || key === "hjDraftMessageEditsV1"
      || savedPageStateKeys.has(key)
    );

    const renderSaveState = (state, detail = "") => {
      lastState = state;
      if (typeof document?.dispatchEvent === "function" && typeof CustomEvent === "function") {
        document.dispatchEvent(new CustomEvent("hj-db-save-state", {
          detail: { state, detail, pending: queue.size },
        }));
      }
      if (typeof document?.querySelector !== "function" || !document.body) return;
      let indicator = document.querySelector("#hjDbSaveState");
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "hjDbSaveState";
        Object.assign(indicator.style, {
          position: "fixed",
          right: "16px",
          bottom: "16px",
          zIndex: "100000",
          maxWidth: "360px",
          padding: "10px 14px",
          borderRadius: "12px",
          fontSize: "14px",
          fontWeight: "700",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
          pointerEvents: "none",
          transition: "opacity .2s ease",
        });
        document.body.appendChild(indicator);
      }
      const display = {
        saving: ["資料正在存入資料庫…", "#fffbeb", "#92400e", "#f59e0b"],
        saved: ["已存入資料庫並核對", "#ecfdf5", "#065f46", "#10b981"],
        error: ["資料庫未存成功，內容已保留待重試", "#fff1f2", "#9f1239", "#fb7185"],
        idle: ["", "transparent", "transparent", "transparent"],
      }[state] || ["", "transparent", "transparent", "transparent"];
      indicator.textContent = display[0];
      indicator.title = detail || "";
      indicator.style.background = display[1];
      indicator.style.color = display[2];
      indicator.style.border = `1px solid ${display[3]}`;
      indicator.style.opacity = state === "idle" ? "0" : "1";
      if (state === "saved") {
        window.setTimeout(() => {
          if (lastState === "saved" && queue.size === 0) renderSaveState("idle");
        }, 2200);
      }
    };

    const persistOutbox = () => {
      if (!queue.size) {
        originalRemoveItem.call(localStorage, outboxStorageKey);
        return;
      }
      originalSetItem.call(localStorage, outboxStorageKey, JSON.stringify(
        Object.fromEntries(queue.entries()),
      ));
    };

    const loadOutbox = () => {
      let cleaned = false;
      try {
        const saved = JSON.parse(localStorage.getItem(outboxStorageKey) || "{}");
        Object.entries(saved && typeof saved === "object" ? saved : {}).forEach(([key, value]) => {
          if (typeof value !== "string" || !isSyncedStorageKey(key)) {
            cleaned = true;
            return;
          }
          if (localStorage.getItem(key) === value) {
            queue.set(key, value);
          } else {
            cleaned = true;
          }
        });
      } catch (error) {
        cleaned = true;
        console.warn("[HJ DB] 無法讀取待同步佇列", error);
      }
      if (cleaned) persistOutbox();
    };

    const flush = async () => {
      if (flushPromise) return flushPromise;
      flushPromise = (async () => {
        if (!queue.size) return { verified: true, pending: 0 };
        renderSaveState("saving");
        const errors = [];
        for (const [key, value] of Array.from(queue.entries())) {
          try {
            const parsed = JSON.parse(value);
            if (parsePaymentStorageKey(key)) await syncPaymentRows(key, parsed);
            else if (key === "hjDraftMessageEditsV1") await syncDraftEdits(parsed);
            else if (savedPageStateKeys.has(key)) await syncPageState(key, parsed);
            if (queue.get(key) === value) queue.delete(key);
            persistOutbox();
          } catch (error) {
            errors.push({ key, error });
            console.error("DB sync failed; write retained for retry", key, error);
          }
        }
        if (errors.length) {
          renderSaveState("error", errors.map(({ key, error }) => `${key}: ${error?.message || error}`).join("\n"));
          window.clearTimeout(timer);
          timer = null;
          const failure = new Error("資料尚未全部存入資料庫，已保留待重試");
          failure.causes = errors;
          throw failure;
        }
        renderSaveState("saved");
        return { verified: true, pending: queue.size };
      })().finally(() => {
        flushPromise = null;
      });
      return flushPromise;
    };

    const queueWrite = (key, value) => {
      queue.set(key, value);
      persistOutbox();
      renderSaveState("saving");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        flush().catch(() => {
          // The visible error state and durable outbox already preserve the failure.
        });
      }, 700);
    };

    Storage.prototype.setItem = function setItemWithDbSync(key, value) {
      originalSetItem.call(this, key, value);
      if (this !== localStorage) return;
      if (isSyncedStorageKey(key)) {
        queueWrite(key, value);
      }
    };

    loadOutbox();
    if (typeof window.addEventListener === "function") {
      window.addEventListener("online", () => {
        if (queue.size) flush().catch(() => {});
      });
      window.addEventListener("beforeunload", (event) => {
        if (!flushPromise) return;
        event.preventDefault();
        event.returnValue = "仍有資料尚未存入資料庫";
      });
    }

    window.HJ_DB.flushPendingWrites = flush;
    window.HJ_DB.pendingWriteCount = () => queue.size;
    window.HJ_DB.saveState = () => ({ state: lastState, pending: queue.size });
  };

  const clearLegacyLocalDataForDb = () => {
    const removeKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (
        key === "hj-crm-clean-v5-data-repair" ||
        key === "hj-crm-payment-bridge-v1" ||
        key === "setItem" ||
        /^hjPaymentRows/.test(key)
      ) {
        removeKeys.push(key);
      }
    }
    removeKeys.forEach((key) => localStorage.removeItem(key));
  };

  window.HJ_DB = {
    normalizeCustomerNo,
    normalizePaymentDateForDb: paymentDateForDb,
    verifyPaymentRowTargets,
    getClient,
    getSession,
    ensureSession,
    signInOrSignUp,
    signOut,
    loadPlatformData,
    refreshPlatformData,
    applyPlatformGlobals,
    installLocalStorageSync,
    clearLegacyLocalDataForDb,
    migrateLegacyCrmYears,
    syncCrmYearData,
    markCrmYearSyncPending,
    saveCrmRow,
    markDraftItemNotified,
    hydrateSavedPageState,
  };
})();
