import React, { useEffect, useState } from "react";
import { Heart, Power, Play, Users } from "lucide-react";
import { api } from "../../api/client";
import { mapAccountsToOptions } from "../../utils/accountOptions";

const ReactionsModule = () => {
  const [sessionOptions, setSessionOptions] = useState([]);
  const [sessionName, setSessionName] = useState("sessions/main");
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [chatLink, setChatLink] = useState("");
  const [emoji, setEmoji] = useState("👍");
  const [days, setDays] = useState(30);
  const [joinWaitSeconds, setJoinWaitSeconds] = useState(15);
  const [useAllAccounts, setUseAllAccounts] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState("Готово к запуску.");
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAccounts().then((accounts) => {
      const opts = mapAccountsToOptions(accounts);
      setSessionOptions(opts);
      if (opts.length) {
        setSessionName(opts[0].value);
        setSelectedSessions([opts[0].value]);
      }
    }).catch(() => setSessionOptions([]));
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const s = await api.getTelethonReactionsStatus();
        setRunning(Boolean(s.running));
        if (s.logs?.length) setLogs(s.logs);
        if (s.error) setError(String(s.error));
        if (s.status === "done") setStatusText("Задача завершена.");
        else if (s.status === "error") setStatusText("Задача завершилась с ошибкой.");
        else if (s.status === "stopped") setStatusText("Остановлено пользователем.");
        else if (s.running) setStatusText("Идет расстановка реакций...");
      } catch {
        setError("Не удалось получить статус реакций.");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const start = async () => {
    if (!chatLink.trim() || running) return;
    setError("");
    setStatusText("Запуск...");
    try {
      await api.startTelethonReactions({
        sessionName,
        sessionNames: useAllAccounts
          ? sessionOptions.map((s) => s.value)
          : (selectedSessions.length ? selectedSessions : [sessionName]),
        chatLink,
        emoji,
        days: Math.max(1, Number(days) || 30),
        joinWaitSeconds: Math.max(0, Number(joinWaitSeconds) || 0),
      });
      setRunning(true);
    } catch (err) {
      setError(String(err?.message || err || "Ошибка запуска"));
      setStatusText("Запуск не выполнен.");
    }
  };

  const stop = async () => {
    try {
      await api.stopTelethonReactions();
      setRunning(false);
      setStatusText("Остановлено.");
    } catch {
      setError("Не удалось остановить задачу.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Heart size={18} className="text-pink-400" />
            Реакции без флуда
          </h3>
          <p className="text-xs text-gray-400">
            Алгоритм: находит сообщения в чате за выбранный период и ставит реакцию только один раз на одного уникального пользователя.
          </p>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Session</label>
            <select value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm">
              {!sessionOptions.length && <option value="sessions/main">sessions/main</option>}
              {sessionOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={useAllAccounts}
                onChange={(e) => setUseAllAccounts(Boolean(e.target.checked))}
                className="accent-pink-500"
              />
              Использовать все аккаунты (автопереключение при блоке)
            </label>
            {!useAllAccounts && (
              <div className="mt-2 border border-gray-700 rounded-md p-2 max-h-32 overflow-auto space-y-1">
                {sessionOptions.length ? sessionOptions.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedSessions.includes(s.value)}
                      onChange={(e) => {
                        const on = Boolean(e.target.checked);
                        setSelectedSessions((prev) => {
                          if (on) return Array.from(new Set([...prev, s.value]));
                          return prev.filter((x) => x !== s.value);
                        });
                      }}
                      className="accent-pink-500"
                    />
                    {s.label}
                  </label>
                )) : <div className="text-xs text-gray-500">Нет доступных аккаунтов.</div>}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Ссылка на чат или пост</label>
            <input
              value={chatLink}
              onChange={(e) => setChatLink(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              placeholder="Чат: https://t.me/.. или инвайт t.me/+.. | Пост: https://t.me/<channel>/<postId>"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Реакция</label>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Период (дни)</label>
              <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Ожидание вступления (сек)</label>
              <input
                type="number"
                min={0}
                value={joinWaitSeconds}
                onChange={(e) => setJoinWaitSeconds(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              />
              <div className="mt-1 text-[11px] text-gray-500">
                Используется только для приватных инвайт-ссылок. Если вступление по заявке — ставь 10–60 сек.
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <button
              onClick={running ? stop : start}
              disabled={!running && !chatLink.trim()}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center space-x-2 ${
                running
                  ? "bg-red-600/20 text-red-500 border border-red-500/50 hover:bg-red-600/30"
                  : chatLink.trim()
                    ? "bg-pink-600 text-white hover:bg-pink-700"
                    : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
            >
              {running ? <Power size={20} /> : <Play size={20} />}
              <span>{running ? "Остановить реакции" : "Запустить реакции"}</span>
            </button>
            <p className="mt-3 text-xs text-gray-400">{statusText}</p>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 text-xs text-cyan-400 mb-3">
              <Users size={14} />
              <span>Лог выполнения</span>
            </div>
            <div className="max-h-56 overflow-auto space-y-1">
              {logs.slice(0, 20).map((l, i) => (
                <div key={`${l}-${i}`} className="text-gray-400 bg-gray-800/50 border border-gray-800 rounded px-2 py-1 text-xs">{l}</div>
              ))}
              {!logs.length && <div className="text-xs text-gray-500">Логов пока нет.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReactionsModule;
