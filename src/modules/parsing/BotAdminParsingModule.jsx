import React, { useEffect, useState } from "react";
import { Bot, Play, Power } from "lucide-react";
import { api } from "../../api/client";

const BotAdminParsingModule = () => {
  const [channelId, setChannelId] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [limit, setLimit] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Готово к запуску.");
  const [logs, setLogs] = useState([]);
  const [liveRows, setLiveRows] = useState([]);
  const [error, setError] = useState("");
  const [audienceDir, setAudienceDir] = useState("");
  const isValidChannelId = /^-100\d+$/.test(String(channelId || "").trim());

  useEffect(() => {
    api
      .getBotMe()
      .then((r) => setBotUsername(r?.username ? `@${r.username}` : ""))
      .catch(() => setBotUsername(""));
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const s = await api.getBotAdminParsingStatus();
        setRunning(Boolean(s.running));
        setProgress(Number(s.progress) || 0);
        setAudienceDir(s.audienceDir || "");
        if (s.logs?.length) setLogs(s.logs);
        const live = await api.getBotAdminParsingLiveResults();
        if (Array.isArray(live?.results)) setLiveRows(live.results);
        if (s.error) setError(String(s.error));
        if (s.status === "done") setStatusText("Парсинг подписчиков завершен.");
        else if (s.status === "error") setStatusText("Задача завершилась с ошибкой.");
        else if (s.status === "stopped") setStatusText("Остановлено пользователем.");
        else if (s.running) setStatusText("Идет парсинг подписчиков канала...");
      } catch {
        setError("Не удалось получить статус парсинга бота.");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const start = async () => {
    if (!isValidChannelId || running) return;
    setError("");
    setStatusText("Запуск...");
    try {
      await api.startBotAdminParsing({
        target: "",
        channelId: String(channelId).trim(),
        limit: Number(limit) > 0 ? Math.max(1, Number(limit)) : 0,
      });
      setRunning(true);
      setProgress(5);
    } catch (err) {
      setError(String(err?.message || err || "Ошибка запуска"));
      setStatusText("Запуск не выполнен.");
    }
  };

  const stop = async () => {
    try {
      await api.stopBotAdminParsing();
      setRunning(false);
      setStatusText("Остановлено.");
    } catch {
      setError("Не удалось остановить задачу.");
    }
  };

  const exportLiveCsv = () => {
    if (!liveRows.length) return;
    const header = "id,username,source,last_activity_at,premium\n";
    const rows = liveRows
      .map((r) => {
        const id = String(r.id || "").replace(/,/g, " ");
        const username = String(r.username || "").replace(/,/g, " ");
        const source = String(r.source || "").replace(/,/g, " ");
        const last = String(r.lastActivityAt || "").replace(/,/g, " ");
        const premium = r.isPremium ? "1" : "0";
        return `${id},${username},${source},${last},${premium}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bot-parsing-live-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAudienceTxt = async () => {
    if (!audienceDir) return;
    try {
      const data = await api.getAudienceRecipients(audienceDir);
      const recipients = Array.isArray(data?.recipients) ? data.recipients : [];
      const blob = new Blob([recipients.join("\n")], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${audienceDir}-recipients.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e?.message || e || "Не удалось выгрузить аудиторию"));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Bot size={18} className="text-cyan-400" />
            Парсинг подписчиков канала (bot token)
          </h3>
          <p className="text-xs text-gray-400">
            Бот берется из Настроек. Перед стартом добавьте {botUsername || "бота"} админом в канал.
          </p>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Channel ID</label>
            <input
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              placeholder="Только ID формата -100... (пример: -1001234567890)"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Принимается только chat ID канала, который начинается с <span className="text-cyan-300 font-semibold">-100</span>.
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Лимит пользователей (0 = без лимита)</label>
            <input
              type="number"
              min={0}
              max={50000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <button
              onClick={running ? stop : start}
              disabled={!running && !isValidChannelId}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center space-x-2 ${
                running
                  ? "bg-red-600/20 text-red-500 border border-red-500/50 hover:bg-red-600/30"
                  : isValidChannelId
                    ? "bg-cyan-600 text-white hover:bg-cyan-700"
                    : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
            >
              {running ? <Power size={20} /> : <Play size={20} />}
              <span>{running ? "Остановить" : "Запустить"}</span>
            </button>
            <p className="mt-3 text-xs text-gray-400">{statusText}</p>
            <div className="mt-3 h-2 rounded bg-gray-800 border border-gray-700 overflow-hidden">
              <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-gray-500">Прогресс: {Math.round(progress)}%</div>
            {audienceDir && <div className="mt-2 text-[11px] text-cyan-300">Аудитория: {audienceDir}</div>}
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-xs text-cyan-400 mb-3">Лог выполнения</div>
            <div className="max-h-56 overflow-auto space-y-1">
              {logs.slice(0, 30).map((l, i) => (
                <div key={`${l}-${i}`} className="text-gray-400 bg-gray-800/50 border border-gray-800 rounded px-2 py-1 text-xs">
                  {l}
                </div>
              ))}
              {!logs.length && <div className="text-xs text-gray-500">Логов пока нет.</div>}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-xs text-cyan-400 mb-3">Live найденные пользователи</div>
            <div className="mb-3 flex gap-2">
              <button
                onClick={exportLiveCsv}
                disabled={!liveRows.length}
                className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
              >
                Выгрузить CSV
              </button>
              <button
                onClick={exportAudienceTxt}
                disabled={!audienceDir}
                className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
              >
                Выгрузить TXT аудиторию
              </button>
            </div>
            <div className="max-h-56 overflow-auto space-y-1">
              {liveRows.slice(0, 50).map((r, i) => (
                <div key={`${r.id || i}-${i}`} className="text-gray-300 bg-gray-800/50 border border-gray-800 rounded px-2 py-1 text-xs">
                  {(r.username || "(без username)")} • id: {r.id}
                </div>
              ))}
              {!liveRows.length && <div className="text-xs text-gray-500">Пока пусто.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BotAdminParsingModule;
