import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw, Plus } from "lucide-react";
import { api } from "../../api/client";

const normInviteUrl = (u) => String(u || "").trim().replace(/^http:\/\//i, "https://");
const buildAutoLinkName = (chatTitle, index) => {
  const base = String(chatTitle || "channel")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "channel";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${base}-${stamp}-${String(index + 1).padStart(2, "0")}`;
};

const BotInvitesModule = () => {
  const [botUsername, setBotUsername] = useState("");
  const [channelInput, setChannelInput] = useState("");
  const [batchCount, setBatchCount] = useState(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [invites, setInvites] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedInviteLink, setSelectedInviteLink] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [joins, setJoins] = useState([]);
  const [totals, setTotals] = useState({ byChannel: [], byInvite: [] });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .getBotMe()
      .then((r) => setBotUsername(r?.username ? `@${r.username}` : ""))
      .catch(() => setBotUsername(""));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.getBotInviteLinks({ chatId: "", botName: "" });
      setInvites(Array.isArray(r?.invites) ? r.invites : []);
      const j = await api.getBotInviteJoins({
        chatId: selectedChatId || "",
        inviteLink: "",
      });
      setJoins(Array.isArray(j?.joins) ? j.joins : []);
      setTotals({
        byChannel: Array.isArray(j?.totals?.byChannel) ? j.totals.byChannel : [],
        byInvite: Array.isArray(j?.totals?.byInvite) ? j.totals.byInvite : [],
      });
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [selectedChatId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const onCreate = async () => {
    if (!channelInput.trim()) return;
    setBusy(true);
    setError("");
    const count = Math.max(1, Math.min(50, Number(batchCount) || 1));
    setStatus(`Создаем ${count} ссылок...`);
    try {
      let created = 0;
      let resolved = null;
      for (let i = 0; i < count; i += 1) {
        const autoName = buildAutoLinkName(resolved?.chat_title || channelInput.trim(), i);
        const res = await api.createBotInviteLink({
          chatId: resolved?.chat_id || channelInput.trim(),
          knownChatTitle: resolved?.chat_title || "",
          name: autoName,
          index: i + 1,
        });
        if (res?.resolved?.chat_id) resolved = res.resolved;
        created += 1;
      }
      setStatus(`Создано ссылок: ${created}`);
      setSelectedChatId(resolved?.chat_id || "");
      setSelectedInviteLink("");
      await load();
    } catch (e) {
      setError(String(e?.message || e));
      setStatus("Создание не выполнено.");
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    setError("");
    setStatus("Синхронизируем вступления...");
    try {
      const r = await api.syncBotInviteLinks({ limit: 100 });
      const m = await api.refreshBotInviteMeta({ profileLimit: 300, titleLimit: 150 });
      setStatus(
        `Синхронизация завершена. Новых вступлений: ${Number(r?.joinsAdded) || 0}. ` +
          `Профили обновлено: ${Number(m?.profilesUpdated) || 0}, названия каналов: ${Number(m?.titlesUpdated) || 0}.`,
      );
      await load();
    } catch (e) {
      setError(String(e?.message || e));
      setStatus("Синхронизация не выполнена.");
    } finally {
      setBusy(false);
    }
  };

  const channels = Array.from(
    invites.reduce((acc, row) => {
      const key = String(row.chat_id || "");
      if (!key) return acc;
      const item = acc.get(key) || { chatId: key, chatTitle: "", links: 0, joins: 0 };
      item.links += 1;
      item.joins += Number(row.join_count) || 0;
      const t = String(row.chat_title || "").trim();
      if (t) item.chatTitle = t;
      acc.set(key, item);
      return acc;
    }, new Map())
      .values(),
  ).sort((a, b) =>
    String(a.chatTitle || a.chatId).localeCompare(String(b.chatTitle || b.chatId), "ru", { sensitivity: "base" }),
  );

  const visibleInvites = selectedChatId
    ? invites.filter((x) => String(x.chat_id || "") === String(selectedChatId))
    : invites;

  const selectedChannelTotal = selectedChatId
    ? Number((totals.byChannel.find((x) => String(x.chat_id) === String(selectedChatId)) || {}).total || 0)
    : 0;
  const selectedInviteTotal = selectedInviteLink
    ? Number((totals.byInvite.find((x) => String(x.invite_link) === String(selectedInviteLink)) || {}).total || 0)
    : 0;

  const selectedChannelLabel =
    selectedChatId &&
    (channels.find((c) => c.chatId === selectedChatId)?.chatTitle ||
      String(
        (totals.byChannel.find((x) => String(x.chat_id) === String(selectedChatId)) || {}).chat_title || ""
      ).trim() ||
      selectedChatId);

  const panelJoins = useMemo(() => {
    if (!selectedInviteLink) return joins;
    const n = normInviteUrl(selectedInviteLink);
    return joins.filter((j) => normInviteUrl(j.invite_link) === n);
  }, [joins, selectedInviteLink]);

  const panelJoinsSorted = useMemo(
    () =>
      [...panelJoins].sort((a, b) => {
        const au = String(a.username || "");
        const bu = String(b.username || "");
        if (au && !bu) return -1;
        if (!au && bu) return 1;
        return String(b.joined_at || "").localeCompare(String(a.joined_at || ""));
      }),
    [panelJoins],
  );

  const panelJoinsFiltered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return panelJoinsSorted;
    return panelJoinsSorted.filter((j) => {
      const parts = [
        j.username,
        j.first_name,
        j.last_name,
        j.user_id,
        j.invite_link,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return parts.includes(q);
    });
  }, [panelJoinsSorted, search]);

  const exportRows = useMemo(
    () =>
      visibleInvites.map((row, idx) => {
        const title = String(row.chat_title || "").trim() || String(row.chat_id || "");
        return `${idx + 1}. ${row.invite_link} | channel: ${title} | id: ${row.name || "auto"} | joins: ${Number(row.join_count) || 0}`;
      }),
    [visibleInvites],
  );

  const onCopyLinks = async () => {
    if (!exportRows.length) return;
    try {
      await navigator.clipboard.writeText(exportRows.join("\n"));
      setStatus(`Скопировано ссылок: ${exportRows.length}`);
    } catch (e) {
      setError(`Не удалось скопировать: ${String(e?.message || e)}`);
    }
  };

  const onDownloadTxt = () => {
    if (!exportRows.length) return;
    const title = selectedChannelLabel ? String(selectedChannelLabel).replace(/[^\wа-яё-]+/gi, "_") : "all_channels";
    const text = exportRows.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invite_links_${title}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`TXT выгружен: ${exportRows.length} ссылок`);
  };

  const onCopySingleLink = async (link) => {
    const value = String(link || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Ссылка скопирована");
    } catch (e) {
      setError(`Не удалось скопировать ссылку: ${String(e?.message || e)}`);
    }
  };

  const onDownloadSelectedUsersTxt = () => {
    if (!selectedInviteLink) return;
    const rows = panelJoinsFiltered.map((u, idx) => {
      const username = u.username ? `@${u.username}` : "без_username";
      const firstName = u.first_name || "";
      const lastName = u.last_name || "";
      return `${idx + 1}. ${username} | ${firstName} ${lastName}`.trim() + ` | id:${u.user_id} | joined:${u.joined_at}`;
    });
    const content = [
      `invite_link: ${selectedInviteLink}`,
      `total_users: ${rows.length}`,
      "",
      ...rows,
    ].join("\n");
    const safe = normInviteUrl(selectedInviteLink)
      .replace(/^https?:\/\//, "")
      .replace(/[^\wа-яё.-]+/gi, "_")
      .slice(0, 60) || "selected_link";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invite_users_${safe}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Выгружено пользователей: ${rows.length}`);
  };

  const onDeleteSingleLink = async (row) => {
    const link = String(row?.invite_link || "").trim();
    if (!link) return;
    if (!window.confirm("Удалить эту ссылку? Она будет отозвана в канале и станет невалидной.")) return;
    try {
      setBusy(true);
      setError("");
      const r = await api.deleteBotInviteLink({ inviteLink: link });
      setStatus(`Ссылка удалена. Отозвано: ${Number(r?.revoked) || 0}, удалено: ${Number(r?.removed) || 0}`);
      if (selectedInviteLink === link) setSelectedInviteLink("");
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteChannels = async (mode) => {
    const isAll = mode === "all";
    const ids = isAll ? [] : selectedChannelIds;
    if (!isAll && !ids.length) return;
    const q = isAll
      ? "Удалить ВСЕ каналы и все их ссылки? Ссылки будут отозваны и станут невалидными."
      : `Удалить выбранные каналы (${ids.length}) и все их ссылки?`;
    if (!window.confirm(q)) return;
    try {
      setBusy(true);
      setError("");
      const r = await api.deleteBotInviteChannels({ mode: isAll ? "all" : "selected", chatIds: ids });
      setStatus(
        `Готово. Найдено ссылок: ${Number(r?.linksFound) || 0}, отозвано: ${Number(r?.revoked) || 0}, удалено: ${Number(r?.removed) || 0}.`,
      );
      setSelectedInviteLink("");
      setSelectedChatId("");
      setSelectedChannelIds([]);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Link2 size={18} className="text-cyan-400" />
            Генерация ссылок канала
          </h3>
          <div className="text-xs text-gray-400">
            Бот из настроек: <span className="text-cyan-300 font-semibold">{botUsername || "не настроен"}</span>.
            Почти в один клик: укажите канал и количество ссылок, затем нажмите «Сгенерировать».
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
            <input
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              placeholder="Chat ID канала: только формат -100... (например, -1001234567890)"
            />
            <input
              value={batchCount}
              onChange={(e) => setBatchCount(e.target.value)}
              type="number"
              min={1}
              max={50}
              className="bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm"
              placeholder="Кол-во ссылок"
            />
          </div>
          <div className="text-[11px] text-gray-500">
            Для этого блока используйте только ID канала, который начинается с <span className="text-cyan-300 font-semibold">-100</span>.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCreate}
              disabled={busy || !channelInput.trim()}
              className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-3 py-2 rounded text-sm flex items-center gap-2"
            >
              <Plus size={14} /> Сгенерировать ссылки
            </button>
            <button
              onClick={onSync}
              disabled={busy}
              className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-2 rounded text-sm flex items-center gap-2"
            >
              <RefreshCw size={14} /> Обновить счетчики
            </button>
          </div>
          {status && <div className="text-xs text-gray-400">{status}</div>}
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-xs text-cyan-400 mb-3">Ссылки и вступления</div>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={onCopyLinks}
              disabled={!visibleInvites.length}
              className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
            >
              Скопировать ссылки
            </button>
            <button
              type="button"
              onClick={onDownloadTxt}
              disabled={!visibleInvites.length}
              className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
            >
              Скачать TXT
            </button>
          </div>
          <div className="max-h-[28rem] overflow-auto space-y-2">
            {visibleInvites.map((row) => {
              const isSel = normInviteUrl(selectedInviteLink) === normInviteUrl(row.invite_link);
              return (
                <div
                  key={row.invite_link}
                  className={`rounded-lg border overflow-hidden ${
                    isSel ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-gray-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedInviteLink(isSel ? "" : row.invite_link)}
                    className="w-full text-left bg-gray-800/50 hover:bg-gray-800/80 p-2 transition-colors"
                  >
                    <div className="text-[11px] text-gray-300 break-all">{row.invite_link}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      канал: {String(row.chat_title || "").trim() || row.chat_id}
                    </div>
                    <div className="text-[11px] text-cyan-300 mt-1">
                      ID: {row.name || "auto"} • вступило:{" "}
                      <span className="font-bold">{Number(row.join_count) || 0}</span>
                    </div>
                  </button>
                  <div className="border-t border-gray-800 bg-black/20 px-2 py-1.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onDeleteSingleLink(row)}
                      disabled={busy}
                      className="text-[11px] px-2 py-1 rounded border border-red-800 text-red-300 hover:border-red-500 mr-2 disabled:opacity-50"
                    >
                      Удалить ссылку
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopySingleLink(row.invite_link)}
                      className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-200 hover:border-cyan-500"
                    >
                      Скопировать 1 ссылку
                    </button>
                  </div>
                </div>
              );
            })}
            {!visibleInvites.length && <div className="text-xs text-gray-500">Ссылок пока нет.</div>}
          </div>
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="text-xs text-cyan-400 mb-3">Каналы со сгенерированными ссылками</div>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => onDeleteChannels("selected")}
            disabled={!selectedChannelIds.length || busy}
            className="bg-gray-800 border border-red-900 hover:border-red-500 disabled:opacity-50 text-red-300 px-3 py-1.5 rounded text-xs"
          >
            Удалить выбранные каналы
          </button>
          <button
            type="button"
            onClick={() => onDeleteChannels("all")}
            disabled={!channels.length || busy}
            className="bg-gray-800 border border-red-900 hover:border-red-500 disabled:opacity-50 text-red-300 px-3 py-1.5 rounded text-xs"
          >
            Удалить все каналы
          </button>
        </div>
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
          <button
            onClick={() => {
              setSelectedChatId("");
              setSelectedInviteLink("");
            }}
            className={`text-left px-3 py-2 rounded text-xs border shrink-0 ${
              !selectedChatId ? "bg-cyan-600/20 border-cyan-500 text-cyan-300" : "bg-gray-800 border-gray-700 text-gray-300"
            }`}
          >
            Все каналы
          </button>
          {channels.map((c) => (
            <div
              key={c.chatId}
              className={`text-left px-3 py-2 rounded text-xs border shrink-0 ${
                selectedChatId === c.chatId
                  ? "bg-cyan-600/20 border-cyan-500 text-cyan-300"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-cyan-500"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedChannelIds.includes(c.chatId)}
                  onChange={(e) =>
                    setSelectedChannelIds((prev) =>
                      e.target.checked ? [...new Set([...prev, c.chatId])] : prev.filter((x) => x !== c.chatId),
                    )
                  }
                  className="mt-0.5"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChatId(c.chatId);
                    setSelectedInviteLink("");
                  }}
                  className="text-left flex-1"
                >
                  <div className="font-semibold text-white/90">{c.chatTitle || c.chatId}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    id {c.chatId} • ссылок {c.links} • вступило {c.joins}
                  </div>
                </button>
              </div>
            </div>
          ))}
          {!channels.length && <div className="text-xs text-gray-500">Пока нет каналов со ссылками.</div>}
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="text-xs text-cyan-400">
          Детальная статистика вступивших
          {selectedChatId ? ` • канал ${selectedChannelLabel}: ${selectedChannelTotal}` : ""}
          {selectedInviteLink ? ` • ссылка: ${selectedInviteTotal}` : ""}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDownloadSelectedUsersTxt}
            disabled={!selectedInviteLink}
            className="bg-gray-800 border border-gray-700 hover:border-cyan-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
          >
            Выгрузить пользователей выбранной ссылки (TXT)
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm text-white"
          placeholder="Поиск: username, имя, фамилия, id, ссылка"
        />
        <div className="text-[11px] text-gray-500">
          Telegram не у всех пользователей отдает `username` — тогда будет показано "без username", но имя/фамилия сохраняются ниже.
        </div>
        <div className="max-h-[26rem] overflow-auto border border-gray-800 rounded-lg">
          <div className="sticky top-0 z-10 grid grid-cols-12 gap-2 bg-gray-900/95 border-b border-gray-800 px-2 py-2 text-[11px] text-gray-400">
            <div className="col-span-3">Username</div>
            <div className="col-span-2">Имя</div>
            <div className="col-span-2">Фамилия</div>
            <div className="col-span-2">User ID</div>
            <div className="col-span-3">Время вступления</div>
          </div>
          <div className="divide-y divide-gray-800">
            {panelJoinsFiltered.map((j, i) => (
              <div key={`${j.user_id}-${j.invite_link}-${i}`} className="grid grid-cols-12 gap-2 px-2 py-2 text-xs text-gray-200">
                <div className="col-span-3 text-cyan-300 truncate">@{j.username || "без username"}</div>
                <div className="col-span-2 truncate">{j.first_name || "—"}</div>
                <div className="col-span-2 truncate">{j.last_name || "—"}</div>
                <div className="col-span-2 text-gray-300 truncate">{j.user_id}</div>
                <div className="col-span-3 text-gray-500 truncate">{j.joined_at}</div>
                {!selectedInviteLink && (
                  <div className="col-span-12 text-[10px] text-cyan-400/80 break-all pt-0.5">
                    {j.invite_link}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!panelJoinsFiltered.length && <div className="text-xs text-gray-500 p-3">Нет данных по вступившим.</div>}
        </div>
      </div>
    </div>
  );
};

export default BotInvitesModule;
