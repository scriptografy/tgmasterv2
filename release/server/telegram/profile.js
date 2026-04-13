export const getAccountProfile = async ({ rootDir, scriptPath, runPythonJson, sessionName, apiId, apiHash, proxyJson = "" }) => {
  const normalizeProfileError = (value) => {
    const msg = String(value || "").trim();
    const low = msg.toLowerCase();
    if (
      low.includes("license is not active") ||
      low.includes("license validation failed") ||
      low.includes("license server unavailable") ||
      low.includes("license key not set")
    ) {
      return "License is not active";
    }
    return msg;
  };
  try {
    const args = [
      "get",
      "--api-id",
      String(apiId),
      "--api-hash",
      String(apiHash),
      "--session",
      String(sessionName),
    ];
    if (proxyJson) args.push("--proxy-json", String(proxyJson));
    const result = await runPythonJson(rootDir, scriptPath, args);
    if (!result?.ok) return { authorized: false, error: normalizeProfileError(result?.error || "profile read failed") };
    return { authorized: true, ...(result.profile || {}) };
  } catch (err) {
    return { authorized: false, error: normalizeProfileError(String(err.message || err)) };
  }
};
