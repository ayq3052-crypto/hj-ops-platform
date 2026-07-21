(function initRocDate(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HJRocDate = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function rocDateFactory() {
  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function build(enteredYear, enteredMonth, enteredDay, hasDay = true) {
    const rawYear = Number(enteredYear);
    const month = Number(enteredMonth);
    const day = Number(enteredDay || 1);
    if (!Number.isInteger(rawYear) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    const westernYear = rawYear >= 1911 ? rawYear : rawYear + 1911;
    const rocYear = westernYear - 1911;
    if (westernYear < 2000 || month < 1 || month > 12 || day < 1) return null;
    const date = new Date(Date.UTC(westernYear, month - 1, day));
    if (date.getUTCFullYear() !== westernYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return {
      westernYear,
      rocYear,
      month,
      day,
      hasDay,
      monthIndex: westernYear * 12 + month - 1,
      dayIndex: Math.floor(date.getTime() / 86400000),
      key: `${rocYear}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
    };
  }

  function parse(value) {
    const normalized = text(value);
    if (!normalized) return null;
    const digits = normalized.replace(/\s/g, "");
    if (/^\d+$/.test(digits)) {
      if (digits.length === 8 && Number(digits.slice(0, 4)) >= 1911) return build(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
      if (digits.length === 7) return build(digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7));
      if (digits.length === 6) {
        const possibleRocYear = Number(digits.slice(0, 3));
        return possibleRocYear >= 100 && possibleRocYear <= 999
          ? build(digits.slice(0, 3), digits.slice(3, 4), digits.slice(4, 6))
          : build(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6));
      }
      if (digits.length === 5) return build(digits.slice(0, 2), digits.slice(2, 3), digits.slice(3, 5));
    }
    const separated = normalized
      .replace(/年/g, "/")
      .replace(/月/g, "/")
      .replace(/日/g, "")
      .replace(/[.\-／]/g, "/")
      .match(/^(\d{2,4})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{1,2}))?$/);
    if (!separated) return null;
    return build(separated[1], separated[2], separated[3] || 1, Boolean(separated[3]));
  }

  function format(value) {
    const parsed = value && typeof value === "object" && Number.isFinite(value.rocYear)
      ? build(value.rocYear, value.month, value.day, value.hasDay !== false)
      : parse(value);
    return parsed?.key || "";
  }

  function normalize(value) {
    const raw = text(value);
    if (!raw) return "";
    return format(raw) || raw;
  }

  function same(left, right) {
    const a = parse(left);
    const b = parse(right);
    return Boolean(a && b && a.dayIndex === b.dayIndex);
  }

  return { parse, format, normalize, same };
});
