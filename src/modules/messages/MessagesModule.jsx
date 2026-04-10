import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { api } from "../../api/client";
import { mapAccountsToOptions } from "../../utils/accountOptions";

const MessagesModule = () => {
  const HISTORY_POLL_MS = 2500;
  const DIALOGS_POLL_MS = 8000;
  const [sessionOptions, setSessionOptions] = useState([]);
  const [sessionName, setSessionName] = useState("sessions/main");
  const [dialogs, setDialogs] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState("");
  const [messages, setMessages] = useState([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const latestHistoryRequestRef = useRef(0);

  const hasRealSessions = sessionOptions.length > 0;
  const sessionValues = sessionOptions.map((o) => o.value);
  const effectiveSessionName = hasRealSessions
    ? (sessionValues.includes(sessionName) ? sessionName : sessionOptions[0].value)
    : sessionName;

  const loadSessions = async () => {
    try {
      const accounts = await api.getAccounts();
      const options = mapAccountsToOptions(accounts);
      setSessionOptions(options);
      if (options.length && !options.some((o) => o.value === sessionName)) setSessionName(options[0].value);
    } catch {
      setSessionOptions([]);
    }
  };

  const loadDialogs = async (silent = false) => {
    if (!effectiveSessionName || effectiveSessionName === "sessions/main") return;
    if (!silent) {
      setLoadingDialogs(true);
      setStatusText("");
    }
    try {
      const result = await api.getMessagesDialogs({ sessionName: effectiveSessionName, limit: 300 });
      const next = result.dialogs || [];
      setDialogs(next);
      let nextSelectedPeer = selectedPeer;
      if (next.length && !next.some((d) => d.peer === selectedPeer)) {
        nextSelectedPeer = next[0].peer;
        setSelectedPeer(nextSelectedPeer);
      }
      if (!next.length) {
        nextSelectedPeer = "";
        setSelectedPeer("");
        setMessages([]);
      }
      setLastSyncAt(new Date());
      if (silent) setStatusText("");
      if (nextSelectedPeer) {
        await loadHistory(true, nextSelectedPeer);
      }
    } catch (err) {
      setStatusText(`Ошибка загрузки диалогов: ${err.message}`);
    } finally {
      if (!silent) setLoadingDialogs(false);
    }
  };

  const loadHistory = async (silent = false, peerOverride = "") => {
    const peerToLoad = String(peerOverride || selectedPeer || "");
    if (!effectiveSessionName || effectiveSessionName === "sessions/main" || !peerToLoad) return;
    const requestId = Date.now();
    latestHistoryRequestRef.current = requestId;
    if (!silent) setLoadingHistory(true);
    try {
      const result = await api.getMessagesHistory({ sessionName: effectiveSessionName, peer: peerToLoad, limit: 100 });
      const next = result.messages || [];
      if (requestId < latestHistoryRequestRef.current) return;
      setMessages((prev) => {
        if (silent && next.length === 0 && prev.length > 0) {
          return prev;
        }
        return next;
      });
      setLastSyncAt(new Date());
      if (!silent && next.length === 0) {
        setStatusText(`История пуста для ${peerToLoad}`);
      } else if (silent) {
        setStatusText("");
      }
    } catch (err) {
      setStatusText(`Ошибка загрузки истории: ${err.message}`);
    } finally {
      if (!silent) setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    loadDialogs();
  }, [effectiveSessionName]);

  useEffect(() => {
    loadHistory();
  }, [selectedPeer, effectiveSessionName]);

  useEffect(() => {
    if (!effectiveSessionName || !selectedPeer) return undefined;
    const timer = setInterval(() => {
      loadHistory(true);
    }, HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [effectiveSessionName, selectedPeer]);

  useEffect(() => {
    if (!effectiveSessionName) return undefined;
    const timer = setInterval(() => {
      loadDialogs(true);
    }, DIALOGS_POLL_MS);
    return () => clearInterval(timer);
  }, [effectiveSessionName]);

  const selectedDialog = useMemo(
    () => dialogs.find((d) => d.peer === selectedPeer) || null,
    [dialogs, selectedPeer]
  );
  const filteredDialogs = useMemo(() => {
    if (typeFilter === "all") return dialogs;
    return dialogs.filter((d) => {
      if (typeFilter === "service") return d.isService;
      if (typeFilter === "channel") return d.dialogType === "channel";
      if (typeFilter === "group") return d.dialogType === "group";
      if (typeFilter === "user") return d.dialogType === "user";
      return true;
    });
  }, [dialogs, typeFilter]);

  const dialogTypeLabel = (d) => {
    if (d.isService) return "Сервис";
    if (d.dialogType === "channel") return d.isPublic ? "Канал • публичный" : "Канал • приватный";
    if (d.dialogType === "group") return d.isPublic ? "Группа • публичная" : "Группа • приватная";
    if (d.dialogType === "user") return "Личные";
    return d.isPublic ? "Публичный" : "Приватный";
  };

  const sendReply = async () => {
    const text = replyText.trim();
    if (!effectiveSessionName || !selectedPeer || !text) return;
    setStatusText("");
    try {
      const result = await api.sendMessageReply({ sessionName: effectiveSessionName, peer: selectedPeer, message: text });
      if (result?.message) setMessages((prev) => [...prev, result.message]);
      setReplyText("");
      await Promise.all([loadDialogs(true), loadHistory(true)]);
    } catch (err) {
      setStatusText(`Ошибка отправки: ${err.message}`);
    }
  };

  const selectDialog = async (peer) => {
    if (!peer) return;
    setSelectedPeer(peer);
    await loadHistory(false, peer);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <select
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
          >
            {!sessionOptions.length && <option value="sessions/main">sessions/main</option>}
            {sessionOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => loadDialogs(false)}
            className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-gray-200 rounded-md px-3 py-2 text-sm flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Обновить
          </button>
          {selectedDialog && <div className="text-sm text-gray-400">Чат: {selectedDialog.title}</div>}
          {lastSyncAt && <div className="text-xs text-gray-500">Realtime: {lastSyncAt.toLocaleTimeString()}</div>}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md p-2 text-xs text-white"
          >
            <option value="all">Все</option>
            <option value="user">Личные</option>
            <option value="group">Группы</option>
            <option value="channel">Каналы</option>
            <option value="service">Сервис Telegram</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-gray-900 border border-gray-800 rounded-xl p-4 h-[540px] overflow-y-auto">
          <div className="text-sm font-bold text-white mb-3">Диалоги</div>
          {loadingDialogs && <div className="text-xs text-gray-500">Загрузка...</div>}
          <div className="space-y-2">
            {filteredDialogs.map((d) => (
              <button
                key={d.peer}
                onClick={() => selectDialog(d.peer)}
                className={`w-full text-left p-3 rounded-lg border ${
                  selectedPeer === d.peer
                    ? "bg-blue-600/20 border-blue-500/50 text-white"
                    : "bg-gray-800/60 border-gray-700 text-gray-200 hover:border-gray-500"
                }`}
              >
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                  <MessageCircle size={12} />
                  <span>{dialogTypeLabel(d)}</span>
                  {!!d.unreadCount && <span>• {d.unreadCount} непроч.</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4 h-[540px] flex flex-col">
          <div className="text-sm font-bold text-white mb-3">Переписка</div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loadingHistory && <div className="text-xs text-gray-500">Загрузка сообщений...</div>}
            {!selectedPeer && !loadingHistory && <div className="text-xs text-gray-500">Выберите диалог.</div>}
            {selectedPeer && !messages.length && !loadingHistory && (
              <div className="text-xs text-gray-500">Сообщений пока нет или история не доступна.</div>
            )}
            {messages.map((m) => (
              <div key={`${m.id}-${m.date || ""}`} className={`p-2 rounded-lg ${m.isSelf ? "bg-blue-600/20" : "bg-gray-800/60"}`}>
                <div className="text-[11px] text-gray-400">{m.isSelf ? "Вы" : (m.senderName || "Собеседник")}</div>
                <div className="text-sm text-gray-100 whitespace-pre-wrap break-words">{m.text || "(пустое сообщение)"}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Введите ответ..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm h-20"
            />
            <button
              onClick={sendReply}
              disabled={!selectedPeer || !replyText.trim()}
              className={`px-4 rounded-md text-sm font-bold flex items-center gap-2 ${
                !selectedPeer || !replyText.trim()
                  ? "bg-gray-700 text-gray-400"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <Send size={14} />
              Ответить
            </button>
          </div>
          {statusText && <div className="mt-2 text-xs text-red-400">{statusText}</div>}
        </div>
      </div>
    </div>
  );
};

export default MessagesModule;
