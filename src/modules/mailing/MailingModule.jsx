import React, { useEffect, useMemo, useState } from "react";
import { AtSign, Bot, FolderOpen, Image as ImageIcon, Layers, MessageSquare, Power, Send, ShieldCheck, Users } from "lucide-react";
import { api } from "../../api/client";
import { mapAccountsToOptions } from "../../utils/accountOptions";

const MailingModule = ({
  mailingType,
  setMailingType,
  campaignText,
  setCampaignText,
  withMedia,
  setWithMedia,
  recipientsText,
  setRecipientsText,
  recipientsCount,
  isMailing,
  setIsMailing,
  canStartCampaign,
  aiRewriteEnabled,
  setActiveTab,
}) => {
  const [sessionOptions, setSessionOptions] = useState([]);
  const [sessionName, setSessionName] = useState("sessions/main");
  const [accountMode, setAccountMode] = useState("single");
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [delayMinSec, setDelayMinSec] = useState(2);
  const [delayMaxSec, setDelayMaxSec] = useState(5);
  const [tacticsPreset, setTacticsPreset] = useState("careful_dm");
  const [joinRequestBehavior, setJoinRequestBehavior] = useState("skip");
  const [joinWaitSeconds, setJoinWaitSeconds] = useState(180);
  const [mailLogs, setMailLogs] = useState([]);
  const [mailStats, setMailStats] = useState({
    audienceTotal: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    dayTotal: 0,
    daySent: 0,
    dayFailed: 0,
  });
  const [mailProgressPct, setMailProgressPct] = useState(0);
  const [mailingError, setMailingError] = useState("");
  const [mailingStatusText, setMailingStatusText] = useState("");
  const [mediaBase64, setMediaBase64] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [audienceFolders, setAudienceFolders] = useState([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState("");
  const [audienceLoadError, setAudienceLoadError] = useState("");

  const recipients = useMemo(
    () => recipientsText.split("\n").map((s) => s.trim()).filter(Boolean),
    [recipientsText]
  );

  useEffect(() => {
    api.getAccounts().then((accounts) => {
      const opts = mapAccountsToOptions(accounts);
      setSessionOptions(opts);
      if (opts.length) {
        setSessionName(opts[0].value);
        setSelectedSessions([opts[0].value]);
      }
    });
  }, []);

  const refreshAudienceFolders = () => {
    api
      .getParsingAudiences()
      .then((data) => setAudienceFolders(data.audiences || []))
      .catch(() => setAudienceFolders([]));
  };

  useEffect(() => {
    refreshAudienceFolders();
  }, []);

  const applyAudienceFolder = async (id) => {
    setSelectedAudienceId(id);
    if (!id) return;
    setAudienceLoadError("");
    try {
      const data = await api.getAudienceRecipients(id);
      const lines = (data.recipients || []).join("\n");
      setRecipientsText(lines);
    } catch (err) {
      setAudienceLoadError(String(err?.message || err));
    }
  };

  useEffect(() => {
    if (accountMode === "all") setSelectedSessions(sessionOptions.map((o) => o.value));
    if (accountMode === "single" && sessionName) setSelectedSessions([sessionName]);
  }, [accountMode, sessionOptions, sessionName]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const s = await api.getTelethonMailingStatus();
        setIsMailing(Boolean(s.running));
        if (s.logs?.length) setMailLogs(s.logs);
        if (typeof s.progress === "number" && !Number.isNaN(s.progress)) {
          setMailProgressPct(Math.min(100, Math.max(0, s.progress)));
        }
        if (s.stats) {
          setMailStats({
            audienceTotal: Number(s.stats.audienceTotal) || 0,
            processed: Number(s.stats.processed) || 0,
            sent: Number(s.stats.sent) || 0,
            failed: Number(s.stats.failed) || 0,
            dayTotal: Number(s.stats.dayTotal) || 0,
            daySent: Number(s.stats.daySent) || 0,
            dayFailed: Number(s.stats.dayFailed) || 0,
          });
        }
        if (s.status === "done") {
          const failed = Number(s.stats?.failed) || 0;
          if (failed > 0) {
            setMailingStatusText(
              `Рассылка завершена. Не доставлено сообщений: ${failed}. Если в логах «слишком много запросов» — сделайте паузу, увеличьте задержки между отправками и проверьте аккаунт через @SpamBot (вкладка «Аккаунты»).`
            );
          } else {
            setMailingStatusText("Рассылка завершена, все сообщения в списке обработаны.");
          }
        } else if (s.status === "stopped") {
          setMailingStatusText("Рассылка остановлена пользователем.");
        } else if (s.running) {
          setMailingStatusText("Рассылка выполняется…");
        }
        if (s.error) setMailingError(humanizeError(s.error));
      } catch (err) {
        setMailingError("Не удалось получить статус рассылки. Проверь API сервер.");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [setIsMailing]);

  const humanizeError = (raw) => {
    const text = String(raw || "");
    if (!text) return "";
    if (
      text.includes("Too many requests") ||
      text.includes("FloodWait") ||
      text.includes("SendMessageRequest")
    ) {
      return "Telegram отклонил отправку: слишком много запросов подряд (лимит сервера). Сделайте паузу 20–60 минут, сильно увеличьте задержки в настройках рассылки, используйте несколько аккаунтов. Проверьте ограничения через @SpamBot во вкладке «Аккаунты».";
    }
    if (text.includes("Session is not authorized")) {
      return "Сессия не авторизована. Авторизуйте аккаунт во вкладке Настройки/Аккаунты.";
    }
    if (text.includes("Username not occupied") || text.includes("PeerIdInvalid")) {
      return "Некорректный получатель: username/ссылка не найдены или недоступны.";
    }
    return `Ошибка рассылки: ${text}`;
  };

  const startMailing = async () => {
    if (!canStartCampaign || isMailing) return;
    const minDelaySec = Math.max(1, Number(delayMinSec) || 2);
    const maxDelaySec = Math.max(minDelaySec, Number(delayMaxSec) || 5);
    const allValues = sessionOptions.map((o) => o.value);
    const sessionsToUse = accountMode === "single" ? [sessionName] : accountMode === "all" ? allValues : selectedSessions;
    if (!sessionsToUse.length) {
      setMailingError("Выберите хотя бы один аккаунт для рассылки.");
      return;
    }
    if (withMedia && !mediaBase64) {
      setMailingError("Включено медиа, но файл не выбран.");
      return;
    }
    setMailingError("");
    setMailingStatusText("Запускаем рассылку...");
    try {
      await api.startTelethonMailing({
        sessionName,
        sessionNames: sessionsToUse,
        mailingType,
        message: campaignText,
        aiRewriteEnabled,
        recipients,
        delayMinMs: Math.round(minDelaySec * 1000),
        delayMaxMs: Math.round(maxDelaySec * 1000),
        tacticsPreset,
        joinRequestBehavior,
        joinWaitSeconds: Math.max(30, Number(joinWaitSeconds) || 180),
        withMedia,
        mediaBase64: withMedia ? mediaBase64 : "",
        mediaName: withMedia ? mediaName : "",
      });
      setIsMailing(true);
      setMailProgressPct(0);
    } catch (err) {
      setMailingError(humanizeError(err?.message || err));
      setMailingStatusText("Запуск не выполнен.");
    }
  };

  const stopMailing = async () => {
    try {
      await api.stopTelethonMailing();
      setIsMailing(false);
      setMailingStatusText("Рассылка остановлена.");
    } catch (err) {
      setMailingError("Не удалось остановить рассылку. Проверь API сервер.");
    }
  };

  const onPickMedia = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setMediaBase64(dataUrl);
    setMediaName(file.name || "media.bin");
  };

  return (
  <div className="space-y-6 animate-in fade-in duration-500">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center">
            <MessageSquare className="mr-2 text-blue-500" size={20} />
            Настройка рассылки
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => setMailingType("direct")}
              className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                mailingType === "direct"
                  ? "bg-blue-600/10 border-blue-500 text-blue-400"
                  : "bg-gray-800/50 border-gray-700 text-gray-500 hover:border-gray-600"
              }`}
            >
              <Users size={24} className="mb-2" />
              <span className="font-bold">По личным сообщениям</span>
            </button>
            <button
              onClick={() => setMailingType("groups")}
              className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                mailingType === "groups"
                  ? "bg-purple-600/10 border-purple-500 text-purple-400"
                  : "bg-gray-800/50 border-gray-700 text-gray-500 hover:border-gray-600"
              }`}
            >
              <Layers size={24} className="mb-2" />
              <span className="font-bold">По группам / чатам</span>
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Аккаунты рассылки</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button onClick={() => setAccountMode("single")} className={`py-2 text-xs rounded-lg border ${accountMode === "single" ? "border-blue-500 text-blue-300 bg-blue-500/10" : "border-gray-700 text-gray-400 bg-gray-800"}`}>Один</button>
              <button onClick={() => setAccountMode("multi")} className={`py-2 text-xs rounded-lg border ${accountMode === "multi" ? "border-blue-500 text-blue-300 bg-blue-500/10" : "border-gray-700 text-gray-400 bg-gray-800"}`}>Несколько</button>
              <button onClick={() => setAccountMode("all")} className={`py-2 text-xs rounded-lg border ${accountMode === "all" ? "border-blue-500 text-blue-300 bg-blue-500/10" : "border-gray-700 text-gray-400 bg-gray-800"}`}>Все</button>
            </div>
            <select
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className={`w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm ${accountMode !== "single" ? "opacity-60" : ""}`}
              disabled={accountMode !== "single"}
            >
              {!sessionOptions.length && <option value="sessions/main">sessions/main</option>}
              {sessionOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {accountMode === "multi" && (
              <div className="mt-2 max-h-24 overflow-auto space-y-1 border border-gray-800 rounded-md p-2 bg-gray-800/30">
                {sessionOptions.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedSessions.includes(s.value)}
                      onChange={(e) => {
                        setSelectedSessions((prev) =>
                          e.target.checked ? [...prev, s.value] : prev.filter((x) => x !== s.value)
                        );
                      }}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 h-40 focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Привет, {как дела|рад тебя видеть}!"
            value={campaignText}
            onChange={(e) => setCampaignText(e.target.value)}
          />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Задержка от (сек)</label>
              <input
                type="number"
                min={1}
                value={delayMinSec}
                onChange={(e) => setDelayMinSec(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Задержка до (сек)</label>
              <input
                type="number"
                min={1}
                value={delayMaxSec}
                onChange={(e) => setDelayMaxSec(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Тактика отправки (ЛС / чаты)</label>
            <select
              value={tacticsPreset}
              onChange={(e) => setTacticsPreset(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
            >
              <option value="careful_dm">Бережная (рекомендуется для ЛС): паузы «как человек», набор текста, ≥12 с на аккаунт, перерыв каждые ~18 отправок</option>
              <option value="balanced">Сбалансированная: «человеческие» паузы и набор (для ЛС), без длинных перерывов</option>
              <option value="fast">Быстрая: равномерная задержка из полей выше, без имитации набора</option>
            </select>
            <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
              Для личных сообщений при возможности используйте несколько аккаунтов и задержку не ниже 2–5 с. Массовые рассылки нарушают правила Telegram — риск ограничений аккаунта.
            </p>
          </div>
          {mailingType === "groups" && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Заявка на вступление</label>
                <select
                  value={joinRequestBehavior}
                  onChange={(e) => setJoinRequestBehavior(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
                >
                  <option value="skip">Пропустить чат</option>
                  <option value="wait">Дождаться одобрения</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Ожидание (сек)</label>
                <input
                  type="number"
                  min={30}
                  value={joinWaitSeconds}
                  onChange={(e) => setJoinWaitSeconds(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
                  disabled={joinRequestBehavior !== "wait"}
                />
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${withMedia ? "bg-blue-500 text-white" : "bg-gray-700 text-gray-400"}`}>
                <ImageIcon size={20} />
              </div>
              <span className="text-sm font-medium text-white">Использовать медиа</span>
            </div>
            <div className="relative inline-flex items-center cursor-pointer" onClick={() => setWithMedia(!withMedia)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${withMedia ? "bg-blue-600" : "bg-gray-700"}`}>
                <div
                  className={`absolute top-[2px] left-[2px] bg-white w-5 h-5 rounded-full transition-all ${
                    withMedia ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </div>
          </div>
          {withMedia && (
            <div className="mt-3">
              <label className="inline-flex items-center gap-2 cursor-pointer bg-gray-800 border border-gray-700 hover:border-blue-500 text-gray-200 rounded-lg text-sm px-3 py-2">
                <ImageIcon size={14} />
                Загрузить медиа
                <input type="file" className="hidden" onChange={onPickMedia} />
              </label>
              <div className="mt-2 text-xs text-gray-400">
                {mediaName ? `Файл: ${mediaName}` : "Файл не выбран"}
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center">
            <AtSign className="mr-2 text-green-500" size={20} />
            Список получателей
          </h3>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider flex items-center gap-1">
                <FolderOpen size={12} className="text-amber-500" />
                Папка парсинга
              </label>
              <select
                value={selectedAudienceId}
                onChange={(e) => applyAudienceFolder(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              >
                <option value="">— вручную / вставить список —</option>
                {audienceFolders.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.sourceLink} · {a.periodDays}д · {a.userCount ?? 0} чел. · {a.status || "?"}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={refreshAudienceFolders}
              className="text-xs px-3 py-2.5 rounded-md bg-gray-800 border border-gray-700 text-gray-200 hover:border-amber-500"
            >
              Обновить список папок
            </button>
          </div>
          {audienceLoadError && <p className="text-xs text-red-400 mb-2">{audienceLoadError}</p>}
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 h-32 focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder={mailingType === "direct" ? "@username или ID (по одному в строке)" : "https://t.me/chat_link"}
            value={recipientsText}
            onChange={(e) => {
              setRecipientsText(e.target.value);
              setSelectedAudienceId("");
            }}
          />
          <div className="mt-2 flex justify-between">
            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Всего в списке: {recipientsCount}</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl shadow-black/40 text-center">
          <button
            onClick={isMailing ? stopMailing : startMailing}
            disabled={!isMailing && !canStartCampaign}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center space-x-2 active:scale-[0.98] ${
              isMailing
                ? "bg-red-600/20 text-red-500 border border-red-500/50 hover:bg-red-600/30"
                : canStartCampaign
                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20"
                  : "bg-gray-700 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isMailing ? <Power size={20} className="animate-pulse" /> : <Send size={20} />}
            <span>{isMailing ? "Остановить рассылку" : "Запустить кампанию"}</span>
          </button>
          {!isMailing && !canStartCampaign && (
            <p className="mt-3 text-xs text-amber-400">Для запуска заполните текст сообщения и добавьте хотя бы одного получателя.</p>
          )}
          {mailingStatusText && <p className="mt-3 text-xs text-gray-400">{mailingStatusText}</p>}
          {mailingError && <p className="mt-2 text-xs text-red-400">{mailingError}</p>}
          {(isMailing || mailStats.audienceTotal > 0) && (
            <div className="mt-4 text-left space-y-2">
              <div className="flex justify-between items-baseline gap-2 text-xs text-gray-400">
                <span className="text-gray-500 uppercase tracking-wider font-bold">Прогресс аудитории</span>
                <span className="text-gray-300 tabular-nums shrink-0">
                  {mailStats.processed} / {mailStats.audienceTotal || "—"} ·{" "}
                  <span className="text-blue-400 font-semibold">{mailProgressPct}%</span>
                </span>
              </div>
              <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden border border-gray-700/80">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full transition-[width] duration-300 ease-out"
                  style={{ width: `${mailProgressPct}%` }}
                />
              </div>
              {mailStats.audienceTotal > 0 && (
                <p className="text-[10px] text-gray-500">
                  Успешно: {mailStats.sent} · ошибки: {mailStats.failed}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-gradient-to-br from-indigo-900/20 to-blue-900/10 border border-blue-500/20 rounded-xl p-5">
          <div className="flex items-center space-x-2 mb-3">
            <Bot className="text-blue-400" size={18} />
            <span className="text-sm font-bold text-white">AI-Уникализация</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-300 font-medium">
              Статус: <span className={aiRewriteEnabled ? "text-green-400" : "text-gray-500"}>{aiRewriteEnabled ? "Включено" : "Отключено"}</span>
            </span>
            <button onClick={() => setActiveTab("settings")} className="text-[10px] text-white bg-blue-600 px-3 py-1 rounded-md hover:bg-blue-500 transition-colors">
              Настроить
            </button>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center space-x-2 text-xs text-yellow-500 bg-yellow-500/5 p-3 rounded-lg border border-yellow-500/10">
            <ShieldCheck size={14} />
            <span>Используется безопасный режим (Safe Mode)</span>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            <div className="text-gray-400">
              За сутки (все исходящие): {mailStats.dayTotal} · доставлено {mailStats.daySent} · сбой{" "}
              {mailStats.dayFailed}
            </div>
            <div className="max-h-28 overflow-auto space-y-1">
              {mailLogs.slice(0, 10).map((l, i) => (
                <div key={`${l}-${i}`} className="text-gray-400 bg-gray-800/50 border border-gray-800 rounded px-2 py-1">{l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

export default MailingModule;
