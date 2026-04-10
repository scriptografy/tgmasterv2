const request = async (url, options = {}) => {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const mergedHeaders = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    cache: "no-store",
    headers: mergedHeaders,
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
};

export const api = {
  health: () => request("/api/health"),
  getLicenseStatus: () => request("/api/license/status"),
  unlockLicense: (password) =>
    request("/api/license/unlock", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  disableLicense: ({ adminKey, password } = {}) =>
    request("/api/license/disable", {
      method: "POST",
      body: JSON.stringify({ adminKey, password }),
    }),
  getDashboard: () => request("/api/dashboard"),
  getDatabaseStats: () => request("/api/database"),
  getDatabaseAudiences: () => request("/api/database/audiences"),
  getDatabaseProfiles: ({ audience = "", q = "", limit = 300 } = {}) =>
    request(`/api/database/profiles?audience=${encodeURIComponent(audience)}&q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`),
  updateDatabaseProfile: (id, payload) =>
    request(`/api/database/profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload || {}),
    }),
  deleteDatabaseProfiles: (payload) =>
    request("/api/database/profiles/delete", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  deleteDatabaseAudiences: (payload) =>
    request("/api/database/audiences/delete", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  getDatabaseLogs: ({ q = "", limit = 500 } = {}) =>
    request(`/api/database/logs?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`),
  deleteDatabaseLogs: (payload) =>
    request("/api/database/logs/delete", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  getDatabaseAccountProfiles: ({ q = "", limit = 500 } = {}) =>
    request(`/api/database/account-profiles?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`),
  updateDatabaseAccountProfile: (sessionName, payload) =>
    request(`/api/database/account-profiles/${encodeURIComponent(sessionName)}`, {
      method: "PATCH",
      body: JSON.stringify(payload || {}),
    }),
  deleteDatabaseAccountProfiles: (payload) =>
    request("/api/database/account-profiles/delete", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  resetDatabase: (payload) =>
    request("/api/database/reset", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getAppSettings: () => request("/api/settings"),
  updateAppSettings: (payload) =>
    request("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getBotMe: () => request("/api/bot/me"),
  telegramSendCode: (payload) =>
    request("/api/telegram/auth/send-code", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  telegramVerifyCode: (payload) =>
    request("/api/telegram/auth/verify-code", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getProxies: () => request("/api/proxies"),
  importProxies: (lines, protocol) =>
    request("/api/proxies/import", {
      method: "POST",
      body: JSON.stringify({ lines, protocol }),
    }),
  testAllProxies: () => request("/api/proxies/test-all", { method: "POST" }),
  getProxyExitIp: (id) => request(`/api/proxies/${id}/exit-ip`),
  toggleProxy: (id) => request(`/api/proxies/${id}/toggle`, { method: "PATCH" }),
  deleteProxy: (id) => request(`/api/proxies/${id}`, { method: "DELETE" }),

  getAccounts: () => request("/api/accounts?lite=1"),
  getAccountsDetailed: () => request("/api/accounts/detailed"),
  verifyAccounts: () =>
    request("/api/accounts/verify", {
      method: "POST",
    }),
  importAccountsArchive: (payload) =>
    request("/api/accounts/import-archive", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importAccountsArchiveFile: ({ file, fileName }) => {
    const form = new FormData();
    form.append("archive", file);
    if (fileName) form.append("fileName", String(fileName));
    return request("/api/accounts/import-archive-file", {
      method: "POST",
      body: form,
    });
  },
  toggleAccount: (sessionName) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}/toggle`, { method: "PATCH" }),
  deleteAccount: (sessionName) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}`, { method: "DELETE" }),
  getAccountServiceCode: (sessionName) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}/service-code`),
  getAccountExitIp: (sessionName) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}/exit-ip`),
  getAccountSpambotCheck: (sessionName) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}/spambot-check`),
  updateAccountProfile: (sessionName, payload) =>
    request(`/api/accounts/${encodeURIComponent(sessionName)}/profile`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getProfileStyleTemplates: () => request("/api/profile-style-templates"),
  createProfileStyleTemplate: (payload) =>
    request("/api/profile-style-templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProfileStyleTemplate: (id, payload) =>
    request(`/api/profile-style-templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteProfileStyleTemplate: (id) =>
    request(`/api/profile-style-templates/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  startParsing: (payload) =>
    request("/api/parsing/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getParsingResults: ({ sourceLink, periodDays, premiumFilter }) =>
    request(
      `/api/parsing/results?sourceLink=${encodeURIComponent(sourceLink)}&periodDays=${encodeURIComponent(
        periodDays
      )}&premiumFilter=${encodeURIComponent(premiumFilter)}`
    ),
  getParsingLiveResults: () => request("/api/parsing/live-results"),
  getParsingRuns: () => request("/api/parsing/runs"),
  ingestParsedUsers: (rows) =>
    request("/api/parsing/ingest", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
  startTelethonParsing: (payload) =>
    request("/api/parsing/telethon/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getParsingAudiences: () => request("/api/parsing/audiences"),
  getAudienceRecipients: (id) =>
    request(`/api/parsing/audiences/${encodeURIComponent(id)}/recipients`),
  getTelethonParsingStatus: () => request("/api/parsing/telethon/status"),
  stopTelethonParsing: () =>
    request("/api/parsing/telethon/stop", {
      method: "POST",
    }),
  startBotAdminParsing: (payload) =>
    request("/api/parsing/bot/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getBotAdminParsingStatus: () => request("/api/parsing/bot/status"),
  getBotAdminParsingLiveResults: () => request("/api/parsing/bot/live-results"),
  stopBotAdminParsing: () =>
    request("/api/parsing/bot/stop", {
      method: "POST",
    }),
  createBotInviteLink: (payload) =>
    request("/api/bot-invites/create", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  syncBotInviteLinks: (payload) =>
    request("/api/bot-invites/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  refreshBotInviteMeta: (payload) =>
    request("/api/bot-invites/refresh-meta", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  deleteBotInviteLink: (payload) =>
    request("/api/bot-invites/delete-link", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  deleteBotInviteChannels: (payload) =>
    request("/api/bot-invites/delete-channels", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  getBotInviteLinks: ({ chatId = "", botName = "" } = {}) =>
    request(
      `/api/bot-invites?chatId=${encodeURIComponent(chatId)}&botName=${encodeURIComponent(botName)}`
    ),
  getBotInviteJoins: ({ chatId = "", inviteLink = "" } = {}) =>
    request(
      `/api/bot-invites/joins?chatId=${encodeURIComponent(chatId)}&inviteLink=${encodeURIComponent(inviteLink)}`
    ),
  startTelethonMailing: (payload) =>
    request("/api/mailing/telethon/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTelethonMailingStatus: () => request("/api/mailing/telethon/status"),
  stopTelethonMailing: () =>
    request("/api/mailing/telethon/stop", {
      method: "POST",
    }),
  startTelethonReactions: (payload) =>
    request("/api/reactions/telethon/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTelethonReactionsStatus: () => request("/api/reactions/telethon/status"),
  stopTelethonReactions: () =>
    request("/api/reactions/telethon/stop", {
      method: "POST",
    }),
  getMessagesDialogs: ({ sessionName, limit = 50 }) =>
    request(
      `/api/messages/dialogs?sessionName=${encodeURIComponent(sessionName)}&limit=${encodeURIComponent(limit)}`
    ),
  getMessagesHistory: ({ sessionName, peer, limit = 80 }) =>
    request(
      `/api/messages/history?sessionName=${encodeURIComponent(sessionName)}&peer=${encodeURIComponent(
        peer
      )}&limit=${encodeURIComponent(limit)}`
    ),
  sendMessageReply: ({ sessionName, peer, message }) =>
    request("/api/messages/send", {
      method: "POST",
      body: JSON.stringify({ sessionName, peer, message }),
    }),
};
