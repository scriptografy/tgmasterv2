const statusEmoji = (color) => {
  if (color === "green") return "🟢";
  if (color === "yellow") return "🟡";
  if (color === "red") return "🔴";
  return "⚪";
};

export const accountOptionLabel = (account) => {
  const base =
    account?.displayLabel ||
    `${account?.name || account?.sessionName || "Аккаунт"} - ${account?.phone || "номер не указан"} - ${account?.statusText || "статус неизвестен"}`;
  return `${statusEmoji(account?.statusColor)} ${base}`;
};

export const mapAccountsToOptions = (accounts) =>
  (Array.isArray(accounts) ? accounts : [])
    .filter((a) => a?.sessionName)
    .map((a) => ({
      value: a.sessionName,
      label: accountOptionLabel(a),
      raw: a,
    }));
