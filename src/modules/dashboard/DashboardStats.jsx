import React, { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Database, Eraser, MessageSquare, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { api } from "../../api/client";

const DashboardStats = () => {
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetWipeProxies, setResetWipeProxies] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const loadDashboard = async () => {
    setIsLoading(true);
    try {
      const data = await api.getDashboard();
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadDashboard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const handleResetDatabase = async () => {
    setResetMessage("");
    const line1 =
      "Будут удалены все строки в: parsed_users, parsing_runs, outbound_messages, system_events, accounts_state. Счётчики AUTOINCREMENT сброшены. Настройки (API Telegram, AI) не трогаются.";
    const line2 = resetWipeProxies ? " Также будут удалены ВСЕ прокси." : " Список прокси сохранится.";
    if (!window.confirm(`${line1}${line2}\n\nПродолжить?`)) return;
    const typed = window.prompt('Для подтверждения введите слово: СБРОС');
    if (typed !== "СБРОС") {
      setResetMessage("Отменено: нужно ввести «СБРОС»");
      return;
    }
    setResetLoading(true);
    try {
      await api.resetDatabase({ confirm: "СБРОС", includeProxies: resetWipeProxies });
      setResetMessage("База данных очищена.");
      await loadDashboard();
    } catch (e) {
      setResetMessage(String(e?.message || e || "Ошибка"));
    } finally {
      setResetLoading(false);
    }
  };

  const kpis = useMemo(() => {
    if (!dashboard) return [];
    return [
      {
        label: "Аккаунты в работе",
        value: `${dashboard.kpi.accountsActive} / ${dashboard.kpi.accountsTotal}`,
        delta: "источник: sessions",
        icon: Users,
        tone: "blue",
      },
      {
        label: "Собрано контактов",
        value: String(dashboard.kpi.contactsCollected),
        delta: "источник: parsed_users",
        icon: Database,
        tone: "green",
      },
      {
        label: "Отправлено сообщений",
        value: String(dashboard.kpi.messagesTotal),
        delta: `Доставка: ${Number(dashboard.efficiency.deliveryRate || 0).toFixed(1)}%`,
        icon: MessageSquare,
        tone: "violet",
      },
      {
        label: "Активные прокси",
        value: `${dashboard.kpi.proxiesOnline} / ${dashboard.kpi.proxiesTotal}`,
        delta: `Offline: ${dashboard.kpi.proxiesOffline}`,
        icon: ShieldCheck,
        tone: "amber",
      },
    ];
  }, [dashboard]);

  const moduleStatus = useMemo(() => {
    if (!dashboard) return [];
    return [
      { name: "Парсинг", status: dashboard.modules.parsing.text, extra: dashboard.modules.parsing.extra, ok: dashboard.modules.parsing.ok },
      { name: "Рассылка", status: dashboard.modules.mailing.text, extra: dashboard.modules.mailing.extra, ok: dashboard.modules.mailing.ok },
      { name: "Прокси чекер", status: dashboard.modules.proxyChecker.text, extra: dashboard.modules.proxyChecker.extra, ok: dashboard.modules.proxyChecker.ok },
      { name: "База данных", status: dashboard.modules.database.text, extra: dashboard.modules.database.extra, ok: dashboard.modules.database.ok },
    ];
  }, [dashboard]);

  const events = dashboard?.events || [];

  const toneClass = {
    blue: "text-blue-300 border-blue-500/20 bg-blue-500/10",
    green: "text-green-300 border-green-500/20 bg-green-500/10",
    violet: "text-violet-300 border-violet-500/20 bg-violet-500/10",
    amber: "text-amber-300 border-amber-500/20 bg-amber-500/10",
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => loadDashboard()}
          disabled={isLoading}
          className="text-xs px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-200 hover:border-blue-500 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          Обновить обзор
        </button>
      </div>
      {isLoading && !dashboard && <div className="text-sm text-gray-500">Загрузка данных обзора...</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-gray-900 border border-gray-800 p-5 rounded-xl">
              <div className="flex items-start justify-between">
                <p className="text-gray-400 text-sm">{kpi.label}</p>
                <div className={`p-2 rounded-lg border ${toneClass[kpi.tone]}`}>
                  <Icon size={15} />
                </div>
              </div>
              <h3 className="text-2xl font-bold mt-1 text-white">{kpi.value}</h3>
              <p className="text-xs text-gray-500 mt-1">{kpi.delta}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-400" />
              Эффективность за 24 часа
            </h3>
            <span className="text-xs text-gray-500">
              {dashboard?.generatedAt ? `обновлено ${new Date(dashboard.generatedAt).toLocaleTimeString()}` : "нет данных"}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Доставка сообщений</span>
                <span className="text-green-300 font-semibold">{Number(dashboard?.efficiency?.deliveryRate || 0).toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500" style={{ width: `${Number(dashboard?.efficiency?.deliveryRate || 0).toFixed(1)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Конверсия ответа</span>
                <span className="text-blue-300 font-semibold">{Number(dashboard?.efficiency?.responseRate || 0).toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${Number(dashboard?.efficiency?.responseRate || 0).toFixed(1)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity size={18} className="text-cyan-400" />
            Состояние модулей
          </h3>
          <div className="space-y-2">
            {moduleStatus.map((item) => (
              <div key={item.name} className="border border-gray-800 bg-gray-800/40 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-white">{item.name}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${item.ok ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {item.status}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">{item.extra}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Clock3 size={18} className="text-violet-400" />
            Последние события
          </h3>
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event} className="text-sm text-gray-300 border border-gray-800 bg-gray-800/30 rounded-md px-3 py-2">
                {event}
              </div>
            ))}
            {!events.length && <div className="text-sm text-gray-500">Событий пока нет</div>}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white mb-4">Контроль рисков</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-gray-300">
              <CheckCircle2 size={16} className="text-green-400 mt-0.5" />
              <span>Всего сообщений в базе: {dashboard?.kpi?.messagesTotal ?? 0}.</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-300">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5" />
              <span>Прокси offline: {dashboard?.kpi?.proxiesOffline ?? 0}.</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-gray-300">
              <CheckCircle2 size={16} className="text-green-400 mt-0.5" />
              <span>SQLite активна, данные обновлены: {dashboard?.generatedAt ? new Date(dashboard.generatedAt).toLocaleString() : "нет"}.</span>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-amber-400/90 mb-2 flex items-center gap-1">
              <Eraser size={14} />
              Сброс данных SQLite
            </p>
            <p className="text-[11px] text-gray-500 mb-3">
              Очистка таблиц со статистикой и событиями, сброс AUTOINCREMENT. Раздел «Настройки» (api_id, AI) не меняется. Файлы в папке{" "}
              <code className="text-gray-400">sessions/</code> не удаляются.
            </p>
            <label className="flex items-center gap-2 text-xs text-gray-400 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={resetWipeProxies}
                onChange={(e) => setResetWipeProxies(e.target.checked)}
                className="rounded border-gray-600"
              />
              Также удалить все прокси из базы
            </label>
            <button
              type="button"
              onClick={handleResetDatabase}
              disabled={resetLoading}
              className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              {resetLoading ? "Выполняется…" : "Сбросить данные БД"}
            </button>
            {resetMessage && <p className="text-[11px] mt-2 text-gray-400">{resetMessage}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardStats;
