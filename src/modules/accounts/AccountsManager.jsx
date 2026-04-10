import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  HelpCircle,
  KeyRound,
  LayoutTemplate,
  Loader2,
  Pencil,
  Power,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "../../api/client";

const accountDisplayPhone = (a) => {
  const p = String(a.phone || "")
    .replace(/^\++/, "")
    .trim();
  if (p) return `+${p}`;
  for (const src of [a.sessionName, a.name]) {
    const digits = String(src || "").replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  }
  return "";
};

const SpambotSpamBadge = ({ spambot }) => {
  const s = spambot || {};
  const title = [s.summary, s.stale ? "Кэш устарел — автоматически обновляем." : ""].filter(Boolean).join(" ");
  if (s.status === "na") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 mt-1" title={s.summary || ""}>
        <span className="text-gray-600">@SpamBot:</span> —
      </span>
    );
  }
  if (s.status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-sky-300 mt-1" title={s.summary || ""}>
        <Loader2 size={12} className="animate-spin shrink-0" />
        проверка лимитов…
      </span>
    );
  }
  if (s.status === "ok") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded border ${
          s.stale
            ? "text-emerald-200/85 border-emerald-500/25 bg-emerald-500/5"
            : "text-emerald-300 border-emerald-500/35 bg-emerald-500/10"
        }`}
        title={title || s.summary}
      >
        <ShieldCheck size={12} className="shrink-0" />
        спам-блок: нет
      </span>
    );
  }
  if (s.status === "limited") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded border text-amber-300 border-amber-500/35 bg-amber-500/10"
        title={title || s.summary}
      >
        <ShieldAlert size={12} className="shrink-0" />
        спам-блок: риск
      </span>
    );
  }
  if (s.status === "blocked") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded border text-red-300 border-red-500/35 bg-red-500/10"
        title={title || s.summary}
      >
        <ShieldAlert size={12} className="shrink-0" />
        заблокирован
      </span>
    );
  }
  if (s.status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded border text-red-300 border-red-500/30 bg-red-500/10"
        title={s.summary || ""}
      >
        <AlertCircle size={12} className="shrink-0" />
        @SpamBot: ошибка
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 mt-1" title={title || s.summary}>
      <HelpCircle size={12} className="shrink-0" />
      неясно
    </span>
  );
};

const AccountsManager = () => {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingSession, setEditingSession] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [photoBase64, setPhotoBase64] = useState("");
  const [clearPhoto, setClearPhoto] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileMessageType, setProfileMessageType] = useState("info");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [importingArchive, setImportingArchive] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [codeLoadingSession, setCodeLoadingSession] = useState("");
  const [serviceCodeBySession, setServiceCodeBySession] = useState({});
  const [ipLoadingSession, setIpLoadingSession] = useState("");
  const [exitIpBySession, setExitIpBySession] = useState({});
  const [spambotLoadingSession, setSpambotLoadingSession] = useState("");
  const [profileTemplates, setProfileTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSaveName, setTemplateSaveName] = useState("");
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const [newTplFirstName, setNewTplFirstName] = useState("");
  const [newTplLastName, setNewTplLastName] = useState("");
  const [newTplUsername, setNewTplUsername] = useState("");
  const [newTplBio, setNewTplBio] = useState("");
  const [newTplPhotoBase64, setNewTplPhotoBase64] = useState("");
  const [newTplClearPhoto, setNewTplClearPhoto] = useState(false);
  const [newTplPhotoFileKey, setNewTplPhotoFileKey] = useState(0);
  const [editProfilePhotoFileKey, setEditProfilePhotoFileKey] = useState(0);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadAccounts = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await api.getAccountsDetailed();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        setProfileMessageType("error");
        setProfileMessage(String(err?.message || err || "Не удалось загрузить аккаунты"));
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts(false);
  }, [loadAccounts]);

  useEffect(() => {
    const needPoll = accounts.some(
      (a) => a.spambot?.status === "pending",
    );
    if (!needPoll) return undefined;
    const t = setInterval(() => {
      loadAccounts(true);
    }, 4500);
    return () => clearInterval(t);
  }, [accounts, loadAccounts]);

  const loadProfileTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await api.getProfileStyleTemplates();
      setProfileTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch {
      setProfileTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    loadProfileTemplates();
  }, []);

  const payloadFromEditForm = () => ({
    firstName: editFirstName,
    lastName: editLastName,
    username: editUsername,
    bio: editBio,
    photoBase64,
    clearPhoto,
  });

  const saveCurrentAsTemplate = async () => {
    const name = templateSaveName.trim();
    if (!name) {
      setProfileMessageType("error");
      setProfileMessage("Введите название шаблона (поле под кнопками).");
      return;
    }
    setSavingTemplate(true);
    setProfileMessage("");
    try {
      await api.createProfileStyleTemplate({ name, ...payloadFromEditForm() });
      setTemplateSaveName("");
      setProfileMessageType("success");
      setProfileMessage(`Шаблон «${name}» сохранён`);
      await loadProfileTemplates();
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Не удалось сохранить шаблон"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const loadTemplateIntoForm = (t) => {
    setEditFirstName(t.firstName || "");
    setEditLastName(t.lastName || "");
    setEditUsername(t.username || "");
    setEditBio(t.bio || "");
    setPhotoBase64(t.photoBase64 || "");
    setClearPhoto(Boolean(t.clearPhoto));
    setProfileMessageType("info");
    setProfileMessage(
      editingSession
        ? `Шаблон «${t.name}» подставлен в форму. При необходимости нажмите «Сохранить профиль» или «Применить к выбранным».`
        : `Шаблон «${t.name}» подставлен в форму. Откройте редактирование аккаунта (карандаш) или примените к выбранным чекбоксами.`
    );
  };

  const applyTemplateToSelected = async (t) => {
    if (!selectedSessions.length) {
      setProfileMessageType("error");
      setProfileMessage("Отметьте аккаунты чекбоксами «Выбрать».");
      return;
    }
    setSavingProfile(true);
    setProfileMessage("");
    let okCount = 0;
    let failCount = 0;
    const body = {
      firstName: t.firstName || "",
      lastName: t.lastName || "",
      username: t.username || "",
      bio: t.bio || "",
      photoBase64: t.photoBase64 || "",
      clearPhoto: Boolean(t.clearPhoto),
    };
    for (const sessionName of selectedSessions) {
      try {
        await api.updateAccountProfile(sessionName, body);
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setSavingProfile(false);
    setProfileMessageType(failCount ? "error" : "success");
    setProfileMessage(
      failCount
        ? `Шаблон «${t.name}»: применено ${okCount}, ошибок ${failCount}`
        : `Шаблон «${t.name}» применён к ${okCount} аккаунтам`
    );
    await loadAccounts();
  };

  const deleteProfileTemplate = async (t) => {
    const ok = window.confirm(`Удалить шаблон «${t.name}»?`);
    if (!ok) return;
    try {
      await api.deleteProfileStyleTemplate(t.id);
      await loadProfileTemplates();
      setProfileMessageType("success");
      setProfileMessage(`Шаблон «${t.name}» удалён`);
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка удаления"));
    }
  };

  const saveNewStandaloneTemplate = async () => {
    const name = newTplName.trim();
    if (!name) {
      setProfileMessageType("error");
      setProfileMessage("Укажите название нового шаблона.");
      return;
    }
    setSavingTemplate(true);
    setProfileMessage("");
    try {
      await api.createProfileStyleTemplate({
        name,
        firstName: newTplFirstName,
        lastName: newTplLastName,
        username: newTplUsername,
        bio: newTplBio,
        photoBase64: newTplPhotoBase64,
        clearPhoto: newTplClearPhoto,
      });
      setNewTplName("");
      setNewTplFirstName("");
      setNewTplLastName("");
      setNewTplUsername("");
      setNewTplBio("");
      setNewTplPhotoBase64("");
      setNewTplClearPhoto(false);
      setNewTemplateOpen(false);
      setProfileMessageType("success");
      setProfileMessage(`Шаблон «${name}» создан`);
      await loadProfileTemplates();
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Не удалось создать шаблон"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleNewTemplatePhoto = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setNewTplPhotoBase64(dataUrl);
      setNewTplClearPhoto(false);
    } finally {
      input.value = "";
    }
  };

  const filtered = useMemo(
    () =>
      accounts.filter((a) =>
        `${a.name} ${a.sessionName} ${a.firstName || ""} ${a.lastName || ""} ${a.username || ""} ${a.phone || ""} ${accountDisplayPhone(a)}`
          .toLowerCase()
          .includes(search.toLowerCase().trim())
      ),
    [accounts, search]
  );

  const stats = useMemo(() => {
    const active = accounts.filter((a) => a.enabled).length;
    const disabled = accounts.length - active;
    return { total: accounts.length, active, disabled };
  }, [accounts]);

  const handleArchiveUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lower = String(file.name || "").toLowerCase();
    if (!lower.endsWith(".zip")) {
      setProfileMessageType("error");
      setProfileMessage("Поддерживается только ZIP-архив с файлами *.session");
      return;
    }
    setImportingArchive(true);
    setProfileMessage("");
    try {
      const result = await api.importAccountsArchiveFile({
        file,
        fileName: file.name || "sessions.zip",
      });
      setProfileMessageType("success");
      setProfileMessage(
        `Импорт завершен: добавлено ${result.imported || 0}, перезаписано ${result.overwritten || 0}, пропущено ${result.skipped || 0}`
      );
      await loadAccounts(false);
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка импорта архива"));
    } finally {
      setImportingArchive(false);
    }
  };

  const toggleAccount = (id) => {
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    api.toggleAccount(account.sessionName).then(() => loadAccounts(false));
  };

  const startEdit = (account) => {
    setEditingSession(account.sessionName);
    setEditFirstName(account.firstName || "");
    setEditLastName(account.lastName || "");
    setEditUsername(account.username || "");
    setEditBio(account.bio || "");
    setPhotoBase64("");
    setClearPhoto(false);
    setEditProfilePhotoFileKey((k) => k + 1);
    setProfileMessage("");
    setSelectedSessions((prev) => (prev.includes(account.sessionName) ? prev : [...prev, account.sessionName]));
  };

  const toggleSessionSelection = (sessionName) => {
    setSelectedSessions((prev) =>
      prev.includes(sessionName) ? prev.filter((x) => x !== sessionName) : [...prev, sessionName]
    );
  };

  const toggleSelectAllFiltered = () => {
    const allFiltered = filtered.map((a) => a.sessionName);
    const allSelected = allFiltered.length > 0 && allFiltered.every((s) => selectedSessions.includes(s));
    if (allSelected) {
      setSelectedSessions((prev) => prev.filter((s) => !allFiltered.includes(s)));
    } else {
      setSelectedSessions((prev) => Array.from(new Set([...prev, ...allFiltered])));
    }
  };

  const handlePhotoChange = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setPhotoBase64(dataUrl);
      setClearPhoto(false);
    } finally {
      input.value = "";
    }
  };

  const saveProfile = async () => {
    if (!editingSession) return;
    setSavingProfile(true);
    setProfileMessage("");
    try {
      const result = await api.updateAccountProfile(editingSession, {
        firstName: editFirstName,
        lastName: editLastName,
        username: editUsername,
        bio: editBio,
        photoBase64,
        clearPhoto,
      });
      if (result?.profile) {
        setEditFirstName(result.profile.firstName || "");
        setEditLastName(result.profile.lastName || "");
        setEditUsername(result.profile.username || "");
        setEditBio(result.profile.bio || "");
      }
      setProfileMessageType("success");
      setProfileMessage("Профиль успешно сохранен (показаны фактические данные Telegram)");
      await loadAccounts();
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка сохранения профиля"));
    } finally {
      setSavingProfile(false);
    }
  };

  const applyProfileToSelected = async () => {
    if (!selectedSessions.length) {
      setProfileMessageType("error");
      setProfileMessage("Выберите хотя бы один аккаунт для применения.");
      return;
    }
    setSavingProfile(true);
    setProfileMessage("");
    let okCount = 0;
    let failCount = 0;
    for (const sessionName of selectedSessions) {
      try {
        await api.updateAccountProfile(sessionName, {
          firstName: editFirstName,
          lastName: editLastName,
          username: editUsername,
          bio: editBio,
          photoBase64,
          clearPhoto,
        });
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setSavingProfile(false);
    setProfileMessageType(failCount ? "error" : "success");
    setProfileMessage(
      failCount
        ? `Применено: ${okCount}, с ошибкой: ${failCount}`
        : `Профиль применен к ${okCount} аккаунтам`
    );
    await loadAccounts();
  };

  const verifySessions = async () => {
    setVerifyLoading(true);
    setProfileMessage("");
    try {
      const result = await api.verifyAccounts();
      await loadAccounts();
      setProfileMessageType("success");
      setProfileMessage(
        `Проверка завершена: ${result.authorized}/${result.total} авторизованы, ${result.failed} с ошибкой`
      );
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка проверки сессий"));
    } finally {
      setVerifyLoading(false);
    }
  };

  const deleteAccount = async (account) => {
    if (!account?.sessionName) return;
    const ok = window.confirm(`Удалить аккаунт ${account.sessionName}?\nБудет удален файл сессии из папки sessions.`);
    if (!ok) return;
    try {
      await api.deleteAccount(account.sessionName);
      if (editingSession === account.sessionName) setEditingSession("");
      setProfileMessageType("success");
      setProfileMessage(`Аккаунт удален: ${account.sessionName}`);
      await loadAccounts();
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка удаления аккаунта"));
    }
  };

  const deleteSelectedAccounts = async () => {
    if (!selectedSessions.length) return;
    const ok = window.confirm(
      `Удалить выбранные аккаунты (${selectedSessions.length})?\nБудут удалены файлы сессий из папки sessions.`,
    );
    if (!ok) return;
    let deleted = 0;
    let failed = 0;
    for (const sessionName of selectedSessions) {
      try {
        await api.deleteAccount(sessionName);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    if (editingSession && selectedSessions.includes(editingSession)) {
      setEditingSession("");
    }
    setSelectedSessions([]);
    setProfileMessageType(failed ? "error" : "success");
    setProfileMessage(
      failed
        ? `Удалено: ${deleted}, с ошибкой: ${failed}`
        : `Удалено выбранных аккаунтов: ${deleted}`,
    );
    await loadAccounts(false);
  };

  const fetchExitIp = async (account) => {
    if (!account?.sessionName) return;
    setIpLoadingSession(account.sessionName);
    setProfileMessage("");
    try {
      const result = await api.getAccountExitIp(account.sessionName);
      if (result?.ip) {
        setExitIpBySession((prev) => ({
          ...prev,
          [account.sessionName]: {
            ip: result.ip,
            country: result.country || "",
            source: result.source || "telegram",
            error: "",
          },
        }));
        setProfileMessageType("success");
        const cc = result.country ? ` (${result.country})` : "";
        const src =
          result.source === "http_exit"
            ? "запасной проверкой HTTPS (ipify) через ваш прокси"
            : "данным Telegram (account.getAuthorizations)";
        setProfileMessage(`IP: ${result.ip}${cc} — источник: ${src}`);
      } else {
        setExitIpBySession((prev) => ({ ...prev, [account.sessionName]: { ip: "", error: "пусто" } }));
        setProfileMessageType("error");
        setProfileMessage("IP не получен");
      }
    } catch (err) {
      const msg = String(err?.message || err || "Ошибка");
      setExitIpBySession((prev) => ({ ...prev, [account.sessionName]: { ip: "", error: msg } }));
      setProfileMessageType("error");
      setProfileMessage(msg);
    } finally {
      setIpLoadingSession("");
    }
  };

  const fetchSpambotCheck = async (account) => {
    if (!account?.sessionName) return;
    setSpambotLoadingSession(account.sessionName);
    setProfileMessage("");
    try {
      const r = await api.getAccountSpambotCheck(account.sessionName);
      setProfileMessageType("success");
      const excerpt = r.botReply ? `\n\nОтвет @SpamBot:\n${String(r.botReply).slice(0, 800)}` : "";
      setProfileMessage(`${r.summary || "Готово."}${excerpt}`);
      await loadAccounts(true);
    } catch (err) {
      let msg = String(err?.message || err || "Ошибка");
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = String(parsed.error);
      } catch {
        const m = msg.match(/\{[\s\S]*"error"\s*:\s*"([^"]+)"/);
        if (m) msg = m[1];
      }
      setProfileMessageType("error");
      setProfileMessage(msg);
    } finally {
      setSpambotLoadingSession("");
    }
  };

  const fetchServiceCode = async (account) => {
    if (!account?.sessionName) return;
    setCodeLoadingSession(account.sessionName);
    setProfileMessage("");
    try {
      const result = await api.getAccountServiceCode(account.sessionName);
      if (result?.code) {
        setServiceCodeBySession((prev) => ({
          ...prev,
          [account.sessionName]: {
            code: String(result.code || ""),
            date: String(result.date || ""),
          },
        }));
        setProfileMessageType("success");
        setProfileMessage(`Код Telegram SMS для ${account.sessionName}: ${result.code}`);
      } else {
        setProfileMessageType("error");
        setProfileMessage(result?.message || "Код не найден в последних сообщениях 777000");
      }
    } catch (err) {
      setProfileMessageType("error");
      setProfileMessage(String(err?.message || err || "Ошибка получения кода"));
    } finally {
      setCodeLoadingSession("");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Всего аккаунтов</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="bg-gray-900 border border-green-500/20 rounded-xl p-4">
          <p className="text-xs text-green-400 uppercase">Активные</p>
          <p className="text-2xl font-bold text-green-300">{stats.active}</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase">Отключенные</p>
          <p className="text-2xl font-bold text-gray-300">{stats.disabled}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center">Загрузка аккаунтов</h3>
          <p className="text-xs text-gray-500 mb-3">
            Источник: папка `sessions` в корне проекта. Лимиты @SpamBot обновляются после кнопки
            «Проверить сессии» (кэш ~6 ч).
          </p>
          <div className="mt-3 flex gap-2">
            <label className="flex-1 cursor-pointer bg-indigo-700/20 border border-indigo-500/40 hover:border-indigo-400 text-indigo-200 rounded-lg text-sm px-3 py-2 text-center inline-flex items-center justify-center gap-2">
              <Users size={14} />
              {importingArchive ? "Импорт..." : "Импорт ZIP сессий"}
              <input
                type="file"
                className="hidden"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={handleArchiveUpload}
                disabled={importingArchive}
              />
            </label>
            <button
              onClick={() => loadAccounts(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg text-sm font-bold"
            >
              Обновить
            </button>
            <button
              onClick={verifySessions}
              disabled={verifyLoading}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white px-4 rounded-lg text-sm font-bold"
            >
              {verifyLoading ? "Проверка..." : "Проверить сессии"}
            </button>
          </div>
        </div>

        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-lg font-bold text-white flex items-center">
              <Users className="mr-2 text-blue-400" size={18} />
              Управление аккаунтами
            </h3>
            <div className="flex items-center gap-2 w-full justify-end">
              <button
                onClick={toggleSelectAllFiltered}
                className="text-[11px] px-2 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-300 hover:border-blue-500"
              >
                Выбрать все
              </button>
              <button
                onClick={deleteSelectedAccounts}
                disabled={!selectedSessions.length}
                className="text-[11px] px-2 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 disabled:opacity-40"
              >
                Удалить выбранные
              </button>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  placeholder="Поиск по имени/номеру"
                />
              </div>
            </div>
          </div>

          <div className="max-h-[460px] overflow-auto space-y-2 pr-1">
            {filtered.map((account) => (
              <React.Fragment key={account.id}>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label className="inline-flex items-center gap-2 text-xs text-gray-400 mb-1">
                    <input
                      type="checkbox"
                      checked={selectedSessions.includes(account.sessionName)}
                      onChange={() => toggleSessionSelection(account.sessionName)}
                    />
                    Выбрать
                  </label>
                  <p className="text-sm text-white font-semibold truncate">{account.name}</p>
                  <p className="text-xs text-blue-300 truncate">
                    {(account.firstName || account.lastName)
                      ? `${account.firstName || ""} ${account.lastName || ""}`.trim()
                      : "Имя не задано"}
                    {account.username ? ` • @${account.username}` : ""}
                  </p>
                  <p className="text-xs text-gray-400">
                    session: {account.sessionName}
                  </p>
                  <p className="text-xs text-gray-400">
                    номер: {accountDisplayPhone(account) || "не указан"}
                  </p>
                  <SpambotSpamBadge spambot={account.spambot} />
                  {account.authorized === false && (
                    <p className="text-[11px] text-amber-400 mt-1">Сессия не авторизована или профиль недоступен</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      account.enabled
                        ? "text-green-300 border-green-500/30 bg-green-500/10"
                        : "text-gray-300 border-gray-600 bg-gray-700/40"
                    }`}
                  >
                    {account.enabled ? "ACTIVE" : "DISABLED"}
                  </span>

                  <button
                    onClick={() => toggleAccount(account.id)}
                    className={`p-2 rounded-md border ${
                      account.enabled
                        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                        : "text-green-300 border-green-500/30 bg-green-500/10"
                    }`}
                    title="Вкл/выкл аккаунт"
                  >
                    <Power size={14} />
                  </button>
                  <button
                    onClick={() => fetchExitIp(account)}
                    disabled={ipLoadingSession === account.sessionName}
                    className="p-1.5 rounded-md border text-slate-300 border-slate-500/40 bg-slate-500/10 disabled:opacity-40"
                    title="IP: сначала из Telegram (getAuthorizations), если пусто — HTTPS через прокси"
                  >
                    <Globe size={13} />
                  </button>
                  <button
                    onClick={() => fetchServiceCode(account)}
                    disabled={codeLoadingSession === account.sessionName}
                    className="p-2 rounded-md border text-cyan-300 border-cyan-500/30 bg-cyan-500/10 disabled:opacity-60"
                    title="Получить код из Telegram SMS (777000)"
                  >
                    <KeyRound size={14} />
                  </button>
                  <button
                    onClick={() => fetchServiceCode(account)}
                    disabled={codeLoadingSession === account.sessionName}
                    className="px-2.5 py-2 rounded-md border text-cyan-300 border-cyan-500/30 bg-cyan-500/10 text-xs font-semibold disabled:opacity-60"
                    title="Получить код из Telegram SMS (777000)"
                  >
                    {codeLoadingSession === account.sessionName ? "Ищем..." : "Получить SMS код"}
                  </button>
                  <button
                    onClick={() => fetchSpambotCheck(account)}
                    disabled={spambotLoadingSession === account.sessionName}
                    className="px-2 py-2 rounded-md border text-emerald-300 border-emerald-500/35 bg-emerald-500/10 text-[10px] font-semibold disabled:opacity-60 max-w-[100px] leading-tight"
                    title="Проверка через @SpamBot"
                  >
                    {spambotLoadingSession === account.sessionName ? "SpamBot…" : "@SpamBot"}
                  </button>
                  <button
                    onClick={() => startEdit(account)}
                    className="p-2 rounded-md border text-blue-300 border-blue-500/30 bg-blue-500/10"
                    title="Редактировать профиль"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteAccount(account)}
                    className="p-2 rounded-md border text-red-300 border-red-500/30 bg-red-500/10"
                    title="Удалить аккаунт"
                  >
                    <Trash2 size={14} />
                  </button>

                </div>
                </div>
                {exitIpBySession[account.sessionName]?.ip && (
                  <div className="mt-2 text-[11px] text-slate-300">
                    <span className="font-mono font-semibold">{exitIpBySession[account.sessionName].ip}</span>
                    {exitIpBySession[account.sessionName].country
                      ? ` • ${exitIpBySession[account.sessionName].country}`
                      : ""}
                    {exitIpBySession[account.sessionName].source === "http_exit" ? (
                      <span className="text-slate-500"> (HTTPS)</span>
                    ) : (
                      <span className="text-slate-500"> (TG)</span>
                    )}
                  </div>
                )}
                {serviceCodeBySession[account.sessionName]?.code && (
                  <div className="mt-2 text-xs text-cyan-300">
                    SMS код: <span className="font-bold">{serviceCodeBySession[account.sessionName].code}</span>
                  </div>
                )}
              </React.Fragment>
            ))}
            {isLoading && <div className="text-sm text-gray-500 py-3">Загрузка...</div>}
            {!filtered.length && (
              <div className="text-center py-10 text-gray-500 border border-dashed border-gray-700 rounded-lg">
                По заданному фильтру аккаунтов нет
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-white font-semibold flex items-center gap-2">
              <LayoutTemplate className="text-violet-400 shrink-0" size={18} />
              Шаблоны оформления профиля
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              Сохраняйте имя, фамилию, username, био и фото как шаблон. Подставляйте в форму редактирования или применяйте сразу к аккаунтам, отмеченным «Выбрать».
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewTemplateOpen((o) => !o)}
            className="text-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:border-violet-500/50 inline-flex items-center gap-1.5 shrink-0"
          >
            {newTemplateOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Новый шаблон с нуля
          </button>
        </div>

        {templatesLoading && <p className="text-sm text-gray-500">Загрузка шаблонов…</p>}
        {!templatesLoading && profileTemplates.length === 0 && (
          <p className="text-sm text-gray-500">Пока нет сохранённых шаблонов.</p>
        )}

        <div className="flex flex-col gap-2">
          {profileTemplates.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2"
            >
              <span className="text-sm text-white font-medium truncate max-w-[220px]" title={t.name}>
                {t.name}
              </span>
              <span className="text-[11px] text-gray-500">
                {[t.firstName, t.lastName].filter(Boolean).join(" ") || "—"}
                {t.username ? ` • @${t.username}` : ""}
                {t.clearPhoto ? " • без фото" : t.photoBase64 ? " • фото" : ""}
              </span>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={() => loadTemplateIntoForm(t)}
                  className="text-[11px] px-2 py-1.5 rounded-md bg-gray-700 border border-gray-600 text-gray-200 hover:border-blue-500/50"
                >
                  В форму
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplateToSelected(t)}
                  disabled={savingProfile}
                  className="text-[11px] px-2 py-1.5 rounded-md bg-violet-600/90 border border-violet-500/40 text-white hover:bg-violet-600 disabled:opacity-50"
                >
                  На выбранные
                </button>
                <button
                  type="button"
                  onClick={() => deleteProfileTemplate(t)}
                  className="text-[11px] px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>

        {newTemplateOpen && (
          <div className="border border-violet-500/20 rounded-lg p-4 space-y-3 bg-gray-800/40">
            <p className="text-xs text-gray-400">Создание шаблона без привязки к текущему аккаунту</p>
            <input
              value={newTplName}
              onChange={(e) => setNewTplName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Название шаблона"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                value={newTplFirstName}
                onChange={(e) => setNewTplFirstName(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Имя"
              />
              <input
                value={newTplLastName}
                onChange={(e) => setNewTplLastName(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Фамилия"
              />
              <input
                value={newTplUsername}
                onChange={(e) => setNewTplUsername(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white md:col-span-2"
                placeholder="username без @"
              />
              <textarea
                value={newTplBio}
                onChange={(e) => setNewTplBio(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white md:col-span-2 h-20"
                placeholder="Био"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {!newTplClearPhoto ? (
                <label className="cursor-pointer bg-gray-800 border border-gray-700 hover:border-violet-500/50 text-gray-200 rounded-lg px-3 py-2 text-xs">
                  Выбрать фото
                  <input
                    key={newTplPhotoFileKey}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleNewTemplatePhoto}
                  />
                </label>
              ) : (
                <span className="text-xs text-gray-500 px-1 py-2">
                  Снимите «Сбросить фото», чтобы снова прикрепить изображение.
                </span>
              )}
              <label className="flex items-center gap-2 text-gray-300 text-xs">
                <input
                  type="checkbox"
                  checked={newTplClearPhoto}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setNewTplClearPhoto(on);
                    if (on) {
                      setNewTplPhotoBase64("");
                    } else {
                      setNewTplPhotoFileKey((k) => k + 1);
                    }
                  }}
                />
                Сбросить фото при применении
              </label>
              {!newTplClearPhoto && newTplPhotoBase64 ? (
                <span className="text-green-400 text-xs">Фото добавлено</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={saveNewStandaloneTemplate}
              disabled={savingTemplate}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
            >
              <BookmarkPlus size={14} />
              {savingTemplate ? "Сохранение…" : "Создать шаблон"}
            </button>
          </div>
        )}
      </div>

      {editingSession && (
        <div className="bg-gray-900 border border-blue-500/30 rounded-xl p-5 space-y-3">
          <h4 className="text-white font-semibold">Редактирование профиля: {editingSession}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={editFirstName}
              onChange={(e) => setEditFirstName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Имя"
            />
            <input
              value={editLastName}
              onChange={(e) => setEditLastName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Фамилия"
            />
            <input
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white md:col-span-2"
              placeholder="username без @"
            />
            <textarea
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white md:col-span-2 h-24"
              placeholder="Био (about)"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {!clearPhoto ? (
              <label className="cursor-pointer bg-gray-800 border border-gray-700 hover:border-blue-500 text-gray-200 rounded-lg px-3 py-2">
                Выбрать фото
                <input
                  key={editProfilePhotoFileKey}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoChange}
                />
              </label>
            ) : (
              <span className="text-xs text-gray-500 px-1 py-2">
                Снимите «Удалить текущее фото», чтобы снова выбрать изображение.
              </span>
            )}
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                checked={clearPhoto}
                onChange={(e) => {
                  const on = e.target.checked;
                  setClearPhoto(on);
                  if (on) {
                    setPhotoBase64("");
                  } else {
                    setEditProfilePhotoFileKey((k) => k + 1);
                  }
                }}
              />
              Удалить текущее фото
            </label>
            {!clearPhoto && photoBase64 ? (
              <span className="text-green-400 text-xs">Новое фото выбрано</span>
            ) : null}
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-end">
            <div className="flex flex-1 min-w-[200px] flex-col gap-1">
              <label className="text-[11px] text-gray-500">Сохранить текущие поля как шаблон</label>
              <div className="flex gap-2">
                <input
                  value={templateSaveName}
                  onChange={(e) => setTemplateSaveName(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Название шаблона"
                />
                <button
                  type="button"
                  onClick={saveCurrentAsTemplate}
                  disabled={savingTemplate}
                  className="shrink-0 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 border border-gray-600 text-white px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5"
                >
                  <BookmarkPlus size={14} />
                  {savingTemplate ? "…" : "В шаблоны"}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyProfileToSelected}
              disabled={savingProfile}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
            >
              <Users size={14} />
              {savingProfile ? "Применение..." : `Применить к выбранным (${selectedSessions.length})`}
            </button>
            <button
              onClick={() => setEditingSession("")}
              className="bg-gray-800 border border-gray-700 text-gray-200 px-4 py-2 rounded-lg text-sm"
            >
              Отмена
            </button>
          </div>
          {profileMessage && (
            <div
              className={`text-sm rounded-lg px-3 py-2 border ${
                profileMessageType === "success"
                  ? "text-green-300 border-green-500/30 bg-green-500/10"
                  : "text-red-300 border-red-500/30 bg-red-500/10"
              }`}
            >
              {profileMessage}
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
        <div className="text-xs text-gray-400">Аккаунты читаются из `sessions`. Здесь можно управлять активностью и профилем аккаунта.</div>
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="text-green-400" />
          <ShieldAlert size={14} className="text-amber-400" />
        </div>
      </div>
      {profileMessage && !editingSession && (
        <div
          className={`text-sm rounded-lg px-3 py-2 border ${
            profileMessageType === "success"
              ? "text-green-300 border-green-500/30 bg-green-500/10"
              : "text-red-300 border-red-500/30 bg-red-500/10"
          }`}
        >
          {profileMessage}
        </div>
      )}
    </div>
  );
};

export default AccountsManager;
