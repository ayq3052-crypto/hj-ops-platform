(() => {
  const authKey = "hj-home-auth-v2";
  const unlockKey = "hj-home-unlock-until-v2";
  const legacySessionKey = "hj-home-session-v1";
  const isLocalTest = window.location.protocol === "file:" || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  if (isLocalTest) return;

  const hasAuth = () => {
    try {
      return Boolean(JSON.parse(localStorage.getItem(authKey) || "null"));
    } catch {
      return false;
    }
  };

  const unlockedUntil = () => Number(localStorage.getItem(unlockKey) || 0);
  const isUnlocked = () => hasAuth() && unlockedUntil() > Date.now();

  const goHome = () => {
    const next = encodeURIComponent(window.location.href);
    window.location.replace(`./home.html?next=${next}`);
  };

  const lock = () => {
    localStorage.removeItem(unlockKey);
    sessionStorage.removeItem(legacySessionKey);
    goHome();
  };

  if (!isUnlocked()) {
    goHome();
    return;
  }

  window.setTimeout(lock, Math.max(0, unlockedUntil() - Date.now()));
  window.addEventListener("storage", (event) => {
    if (event.key === unlockKey && !isUnlocked()) lock();
  });
  window.addEventListener("focus", () => {
    if (!isUnlocked()) lock();
  });
})();
