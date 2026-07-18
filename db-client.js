(() => {
  const supabaseUrl = "https://khpgrfpnvgzkfjmxhuny.supabase.co";
  const supabaseKey = "sb_publishable_q13oqBYsvYnhkuuZ79kA5g_dt9YaujM";
  const supabaseCdn = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  let clientPromise = null;
  let platformDataPromise = null;
  let branchesPromise = null;

  const venueLabels = {
    taichung: "台中館",
    huanrui: "環瑞館",
  };

  const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const moneyText = (value, suffix = "") => {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return `${number % 1 === 0 ? String(Math.trunc(number)) : String(number)}${suffix}`;
  };

  const textOrEmpty = (value) => String(value ?? "").trim();

  const isoToRoc = (value) => {
    if (!value) return "";
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return "";
    return `${Number(match[1]) - 1911}/${Number(match[2])}/${Number(match[3])}`;
  };

  const rocToIso = (value) => {
    const match = String(value || "").match(/(\d{2,3})[/.年-](\d{1,2})[/.月-](\d{1,2})/);
    if (!match) return null;
    return `${Number(match[1]) + 1911}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
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
      id: textOrEmpty(row.customer_no),
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
      uid: row.source_row_key || `${row.branch_code}-${row.crm_status || "active"}-${String(index + 1).padStart(3, "0")}-${row.customer_no}`,
      contractYears: textOrEmpty(snapshot.contractYears) || contractYearsFromIso(contract?.start_date || row.contract_start, contract?.end_date || row.contract_end),
      contractTerm: textOrEmpty(snapshot.contractTerm),
      depositPolicy: textOrEmpty(contract?.deposit_policy),
      officeContractMode: storedOfficeMode === "renewal" ? "renewal" : contractModeFromPolicy(contract?.deposit_policy),
      contractStatus: textOrEmpty(contract?.contract_status),
      stampVersion: textOrEmpty(contract?.stamp_version),
    };
  };

  const buildCrmSource = (customers, contracts = []) => {
    const contractByCustomer = new Map(contracts.map((contract) => [contract.customer_id, contract]));
    const venues = {};
    Object.keys(venueLabels).forEach((venue) => {
      const rows = customers
        .filter((row) => row.branch_code === venue)
        .sort((a, b) => String(a.customer_no).localeCompare(String(b.customer_no), "zh-Hant", { numeric: true }))
        .map((row, index) => customerToCrmRow(row, index, contractByCustomer.get(row.id)));
      venues[venue] = { activeYear: "2026", years: { 2026: rows } };
    });
    return {
      generatedAt: new Date().toISOString(),
      activeVenue: "taichung",
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
    };
  };

  const paymentDbRowToLegacy = (row) => {
    const snapshot = row.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {};
    const manualStatus = snapshot.manualStatus || snapshot.manual_status || (row.row_status === "ignored" ? "nonbillable" : "");
    const dbCycle = textOrEmpty(row.payment_cycle);
    const snapshotCycle = textOrEmpty(snapshot.cycle);
    const cycle = dbCycle && dbCycle.toLowerCase() !== "custom" ? dbCycle : snapshotCycle || dbCycle;
    return {
      ...snapshot,
      _dbId: textOrEmpty(row.id),
      section: textOrEmpty(row.section || snapshot.section || "待確認"),
      id: textOrEmpty(row.customer_no || snapshot.id),
      name: textOrEmpty(row.customer_name || snapshot.name),
      company: textOrEmpty(row.company_name || snapshot.company),
      cycle: textOrEmpty(cycle),
      price: textOrEmpty(snapshot.price || moneyText(row.amount_due)),
      paidDate: textOrEmpty(snapshot.paidDate || row.payment_date),
      paidAmount: textOrEmpty(snapshot.paidAmount || moneyText(row.amount_paid)),
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
      id: textOrEmpty(ref.id || ref.customer_no || row.customer_no),
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
    };
  };

  const loadPlatformData = async () => {
    if (!platformDataPromise) {
      platformDataPromise = (async () => {
        await ensureSession();
        const [customers, contracts, paymentRows, drafts, settings] = await Promise.all([
          queryAll("v_customers_current"),
          queryAll("v_contracts_current"),
          queryAll("v_payment_month_table"),
          queryAll("v_message_draft_queue"),
          queryAll("system_settings", "key,value"),
        ]);
        const crmSource = buildCrmSource(customers, contracts);
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

  const customerPayloadFromCrmRow = (row, branches) => {
    const branch = branches.byCode[row.venue || "taichung"];
    if (!branch || !textOrEmpty(row.id)) return null;
    return {
      branch_id: branch.id,
      customer_no: textOrEmpty(row.id),
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
      source_snapshot: row,
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

  const contractPayloadFromCrmRow = (row, customerId, branchId) => {
    const startDate = rocToIso(row.start);
    const endDate = rocToIso(row.end);
    if (!customerId || !branchId || !startDate || !endDate) return null;
    return {
      customer_id: customerId,
      branch_id: branchId,
      contract_no: textOrEmpty(row.id),
      service_type: serviceTypeFromText(row.item, row.category),
      contract_status: row.folder === "ended" ? "ended" : "active",
      start_date: startDate,
      end_date: endDate,
      signed_date: rocToIso(row.signedAt),
      payment_cycle: normalizeCycle(row.cycle),
      monthly_amount: numericMoney(row.amount),
      deposit_amount: numericMoney(row.deposit),
      metadata: {
        source_system: "web_crm",
        source_snapshot: row,
      },
      notes: textOrEmpty(row.notes) || null,
    };
  };

  const saveCrmRow = async (row) => {
    const client = await getClient();
    const branches = await getBranches();
    const customerPayload = customerPayloadFromCrmRow(row, branches);
    if (!customerPayload) throw new Error("CRM 資料不足，無法儲存正式資料");

    const { data: savedCustomer, error: customerError } = await client
      .from("customers")
      .upsert(customerPayload, { onConflict: "branch_id,customer_no" })
      .select("id,branch_id")
      .single();
    if (customerError) throw customerError;

    const contractPayload = contractPayloadFromCrmRow(row, savedCustomer.id, savedCustomer.branch_id);
    if (contractPayload) {
      const { data: existingContracts, error: existingError } = await client
        .from("contracts")
        .select("id")
        .eq("customer_id", savedCustomer.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (existingError) throw existingError;

      if (existingContracts?.[0]?.id) {
        const { error: contractError } = await client
          .from("contracts")
          .update(contractPayload)
          .eq("id", existingContracts[0].id);
        if (contractError) throw contractError;
      } else {
        const { error: contractError } = await client.from("contracts").insert({
          ...contractPayload,
          contract_period: Number(row.contractPeriod || row.contract_period) || 1,
        });
        if (contractError) throw contractError;
      }
    }

    platformDataPromise = null;
    return savedCustomer;
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
    const customerNo = textOrEmpty(row.id);
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
      amount_due: numericMoney(row.paidAmount) || numericMoney(row.price),
      amount_paid: numericMoney(row.paidAmount),
      invoice_status: /✔|V|已開|開立/.test(String(row.invoice || "")) ? "issued" : "pending",
      invoice_number: textOrEmpty(row.invoice) || null,
      row_status: numericMoney(row.paidAmount) ? "paid" : row.manualStatus === "nonbillable" ? "ignored" : "open",
      reminder_state: /已通知|已貼/.test(String(row.note || "")) ? "posted_waiting" : "none",
      memo: textOrEmpty(row.note) || null,
      source_system: "manual",
      source_snapshot: row,
      metadata: {
        source_month_label: context.month,
        start: row.start || null,
        end: row.end || null,
        price: row.price || null,
        manual_status: row.manualStatus || null,
      },
    };
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
    const customersByNo = new Map((customers || []).map((customer) => [textOrEmpty(customer.customer_no), customer]));
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
    const identityFor = (row) => {
      const snapshot = row?.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {};
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const rowKey = textOrEmpty(snapshot._rowKey);
      if (rowKey) return `key:${rowKey}`;
      return [
        textOrEmpty(row.customer_no).toUpperCase(),
        textOrEmpty(row.payment_cycle).toUpperCase(),
        textOrEmpty(metadata.start || snapshot.start),
        textOrEmpty(metadata.end || snapshot.end),
      ].join("|");
    };
    const existingIdentities = new Set((existingRows || []).map(identityFor));

    for (const { payload, sourceRow } of payloadEntries) {
      const dbId = textOrEmpty(sourceRow._dbId);
      if (dbId && existingById.has(dbId)) {
        const { error: updateError } = await client
          .from("payment_month_rows")
          .update(payload)
          .eq("id", dbId);
        if (updateError) throw updateError;
        continue;
      }
      const identity = identityFor(payload);
      if (existingIdentities.has(identity)) continue;
      const { error: insertError } = await client.from("payment_month_rows").insert(payload);
      if (insertError) throw insertError;
      existingIdentities.add(identity);
    }
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
  };

  const paymentRefKey = (ref = {}, fallbackYear = 2026) => [
    "payment-ref",
    ref.venue || ref.branch_code || "",
    ref.year || fallbackYear || 2026,
    ref.month || "",
    textOrEmpty(ref.id || ref.customer_no),
  ].join("|");

  const legacyPaymentRefKey = (ref = {}) => [
    "payment-ref",
    ref.venue || ref.branch_code || "",
    "",
    ref.month || "",
    textOrEmpty(ref.id || ref.customer_no),
  ].join("|");

  const draftKeysFromMetadata = (metadata = {}, fallbackId = "") => {
    const keys = new Set();
    if (fallbackId) keys.add(String(fallbackId));
    if (metadata.source_id) keys.add(String(metadata.source_id));
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
      id: textOrEmpty(ref.id || item.id),
    }));
    const itemMetadata = {
      source_id: textOrEmpty(item.id),
      source_status: "follow",
      source_year: sourceYear,
      source_month: textOrEmpty(item.month) || null,
      source_due: textOrEmpty(item.due),
      source_amount: textOrEmpty(item.amount),
      payment_refs: paymentRefs,
      lastNotifiedAt: notifiedDate,
      last_notified_at: notifiedDate,
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
    if (matches.length) return;
    const firstMessage = Array.isArray(item.messages) ? item.messages[0] : null;
    const { error: insertError } = await client.from("message_drafts").insert({
      branch_id: branch.id,
      channel: "line",
      draft_type: item.kind === "續約" ? "renewal" : "payment_reminder",
      title: textOrEmpty(item.title) || textOrEmpty(item.id) || "訊息草稿",
      body: textOrEmpty(firstMessage?.body),
      status: "posted_waiting",
      sent_at: notifiedAt,
      requires_human_confirmation: true,
      metadata: itemMetadata,
    });
    if (insertError) throw insertError;
  };

  const parseAutoDraftSourceId = (sourceId) => {
    const match = String(sourceId || "").match(/^auto-(\d{4})-(taichung|huanrui)-(\d{1,2})-([^-]+)/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      venue: match[2],
      month: Number(match[3]),
      customerNo: match[4],
    };
  };

  const installLocalStorageSync = () => {
    if (window.__hjDbLocalStorageSyncInstalled) return;
    window.__hjDbLocalStorageSyncInstalled = true;
    const originalSetItem = Storage.prototype.setItem;
    const queue = new Map();
    let timer = null;

    const flush = async () => {
      const entries = Array.from(queue.entries());
      queue.clear();
      for (const [key, value] of entries) {
        try {
          const parsed = JSON.parse(value);
          if (parsePaymentStorageKey(key)) await syncPaymentRows(key, parsed);
          else if (key === "hjDraftMessageEditsV1") await syncDraftEdits(parsed);
        } catch (error) {
          console.warn("DB sync failed", key, error);
        }
      }
    };

    Storage.prototype.setItem = function setItemWithDbSync(key, value) {
      originalSetItem.call(this, key, value);
      if (this !== localStorage) return;
      if (parsePaymentStorageKey(key) || key === "hjDraftMessageEditsV1") {
        queue.set(key, value);
        window.clearTimeout(timer);
        timer = window.setTimeout(flush, 700);
      }
    };
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
    getClient,
    getSession,
    ensureSession,
    signInOrSignUp,
    signOut,
    loadPlatformData,
    applyPlatformGlobals,
    installLocalStorageSync,
    clearLegacyLocalDataForDb,
    saveCrmRow,
    markDraftItemNotified,
  };
})();
