import React, { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Globe, Plus, Search, Shield, Trash2, XCircle } from "lucide-react";
import { api } from "../../api/client";

const parseProxyLine = (line) => {
  const parts = line.split(":").map((v) => v.trim());
  if (parts.length < 2) return null;
  const [host, port, login = "-", pass = "-"] = parts;
  return { host, port, login, pass };
};

const ProxyManager = () => {
  const [proxyInput, setProxyInput] = useState("");
  const [protocol, setProtocol] = useState("HTTP/S");
  const [search, setSearch] = useState("");
  const [proxies, setProxies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ipLoadingId, setIpLoadingId] = useState(null);
  const [exitIpByProxyId, setExitIpByProxyId] = useState({});
  const [ipMessage, setIpMessage] = useState("");
  const [telethonUseProxy, setTelethonUseProxy] = useState(true);

  const loadProxies = async () => {
    setIsLoading(true);
    try {
      const data = await api.getProxies();
      setProxies(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProxies();
    api
      .getAppSettings()
      .then((s) => setTelethonUseProxy(s.telethonUseProxy !== false))
      .catch(() => {});
  }, []);

  const setTelethonProxyRequired = async (checked) => {
    const prev = telethonUseProxy;
    setTelethonUseProxy(checked);
    try {
      await api.updateAppSettings({ telethonUseProxy: checked });
    } catch {
      setTelethonUseProxy(prev);
    }
  };

  const filtered = useMemo(
    () => proxies.filter((p) => `${p.host}:${p.port} ${p.login}`.toLowerCase().includes(search.toLowerCase().trim())),
    [proxies, search]
  );

  const stats = useMemo(() => {
    const online = proxies.filter((p) => p.status === "online").length;
    const offline = proxies.filter((p) => p.status === "offline").length;
    const enabled = proxies.filter((p) => p.enabled).length;
    return { total: proxies.length, online, offline, enabled };
  }, [proxies]);

  const handleImport = () => {
    const parsed = proxyInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseProxyLine)
      .filter(Boolean);

    if (!parsed.length) return;

    api
      .importProxies(
        parsed.map((p) => `${p.host}:${p.port}:${p.login}:${p.pass}`),
        protocol
      )
      .then(() => {
        setProxyInput("");
        return loadProxies();
      });
  };

  const testAll = () => {
    api.testAllProxies().then(loadProxies);
  };

  const removeProxy = (id) => api.deleteProxy(id).then(loadProxies);
  const toggleProxy = (id) => api.toggleProxy(id).then(loadProxies);

  const fetchProxyIp = async (proxy) => {
    setIpLoadingId(proxy.id);
    setIpMessage("");
    try {
      const result = await api.getProxyExitIp(proxy.id);
      if (result?.ip) {
        setExitIpByProxyId((prev) => ({ ...prev, [proxy.id]: { ip: result.ip, error: "" } }));
        setIpMessage(`Прокси ${proxy.host}:${proxy.port} → внешний IP: ${result.ip}`);
      }
    } catch (e) {
      const msg = String(e?.message || e || "Ошибка");
      setExitIpByProxyId((prev) => ({ ...prev, [proxy.id]: { ip: "", error: msg } }));
      setIpMessage(msg);
    } finally {
      setIpLoadingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Всего</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="bg-gray-900 border border-green-500/20 rounded-xl p-4">
          <p className="text-xs text-green-400 uppercase">Online</p>
          <p className="text-2xl font-bold text-green-300">{stats.online}</p>
        </div>
        <div className="bg-gray-900 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs text-red-400 uppercase">Offline</p>
          <p className="text-2xl font-bold text-red-300">{stats.offline}</p>
        </div>
        <div className="bg-gray-900 border border-blue-500/20 rounded-xl p-4">
          <p className="text-xs text-blue-400 uppercase">В работе</p>
          <p className="text-2xl font-bold text-blue-300">{stats.enabled}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div>
          <p className="text-sm text-white font-medium">Прокси для Telethon</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Включено: парсинг, рассылка и авторизация идут через активный прокси из списка ниже. Выключено: прямое подключение (если сеть позволяет).
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <span className="text-xs text-gray-400">Требовать прокси</span>
          <input
            type="checkbox"
            checked={telethonUseProxy}
            onChange={(e) => setTelethonProxyRequired(e.target.checked)}
            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center">
            <Plus className="mr-2 text-blue-400" size={18} />
            Импорт прокси
          </h3>
          <textarea
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 h-44 outline-none focus:border-blue-500"
            placeholder="IP:PORT:USER:PASS (по одному в строке)"
          />
          <div className="mt-3 flex gap-2">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg p-2.5 outline-none"
            >
              <option>HTTP/S</option>
              <option>SOCKS5</option>
            </select>
            <button onClick={handleImport} className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg text-sm font-bold">
              Добавить
            </button>
          </div>
          <button
            onClick={testAll}
            className="mt-3 w-full bg-gray-800 border border-gray-700 hover:border-blue-500 text-gray-200 py-2 rounded-lg text-sm"
          >
            Протестировать все
          </button>
        </div>

        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-lg font-bold text-white flex items-center">
              <Globe className="mr-2 text-blue-400" size={18} />
              Пул прокси
            </h3>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                placeholder="Поиск по IP или логину"
              />
            </div>
          </div>

          <div className="space-y-2 max-h-[440px] overflow-auto pr-1">
            {isLoading && <div className="text-sm text-gray-500 py-4">Загрузка...</div>}
            {filtered.map((proxy) => (
              <div key={proxy.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-white font-semibold truncate">
                    {proxy.host}:{proxy.port}
                  </p>
                  <p className="text-xs text-gray-400">
                    {proxy.protocol} • Логин: {proxy.login || "-"} {proxy.latency_ms ? `• ${proxy.latency_ms} ms` : ""}
                  </p>
                  {exitIpByProxyId[proxy.id]?.ip && (
                    <p className="text-[11px] text-cyan-300 mt-1 font-mono">
                      IP: {exitIpByProxyId[proxy.id].ip}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      proxy.status === "online"
                        ? "text-green-300 border-green-500/30 bg-green-500/10"
                        : proxy.status === "offline"
                          ? "text-red-300 border-red-500/30 bg-red-500/10"
                          : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10"
                    }`}
                  >
                    {proxy.status === "online" ? "ONLINE" : proxy.status === "offline" ? "OFFLINE" : "UNKNOWN"}
                  </span>

                  <button
                    onClick={() => fetchProxyIp(proxy)}
                    disabled={ipLoadingId === proxy.id}
                    className="p-1.5 rounded-md border text-slate-300 border-slate-500/40 bg-slate-500/10 disabled:opacity-50"
                    title="Внешний IP через этот прокси (HTTPS)"
                  >
                    <Activity size={13} />
                  </button>
                  <button
                    onClick={() => toggleProxy(proxy.id)}
                    className={`p-2 rounded-md border ${
                      proxy.enabled ? "text-green-300 border-green-500/30 bg-green-500/10" : "text-gray-400 border-gray-600"
                    }`}
                    title="Включить/выключить"
                  >
                    <Shield size={14} />
                  </button>
                  <button onClick={() => removeProxy(proxy.id)} className="p-2 rounded-md border border-red-500/30 text-red-300 bg-red-500/10" title="Удалить">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="text-center py-10 text-gray-500 border border-dashed border-gray-700 rounded-lg">
                По фильтру ничего не найдено
              </div>
            )}
          </div>
        </div>
      </div>

      {ipMessage && (
        <div className="bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200">{ipMessage}</div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
        <div className="text-xs text-gray-400">Safe routing активен: неиспользуемые и offline прокси исключаются автоматически.</div>
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="text-green-400" />
          <XCircle size={14} className="text-red-400" />
        </div>
      </div>
    </div>
  );
};

export default ProxyManager;
