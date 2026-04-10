import React, { useEffect, useState } from "react";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../api/client";

const DatabaseModule = () => {
  const [audiences, setAudiences] = useState([]);
  const [profileTemplates, setProfileTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedAudience, setSelectedAudience] = useState("");
  const [qProfiles, setQProfiles] = useState("");
  const [qLogs, setQLogs] = useState("");
  const [selectedAudienceRows, setSelectedAudienceRows] = useState([]);
  const [selectedTemplateRows, setSelectedTemplateRows] = useState([]);
  const [selectedLogRows, setSelectedLogRows] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAudiences = async () => {
    const res = await api.getDatabaseAudiences();
    setAudiences(Array.isArray(res?.audiences) ? res.audiences : []);
  };

  const loadProfileTemplates = async () => {
    const res = await api.getProfileStyleTemplates();
    const rows = Array.isArray(res?.templates) ? res.templates : [];
    const q = String(qProfiles || "").trim().toLowerCase();
    if (!q) {
      setProfileTemplates(rows);
      return;
    }
    setProfileTemplates(
      rows.filter((t) =>
        [t.name, t.firstName, t.lastName, t.username, t.bio].map((x) => String(x || "").toLowerCase()).join(" ").includes(q),
      ),
    );
  };

  const loadLogs = async () => {
    const res = await api.getDatabaseLogs({ q: qLogs, limit: 500 });
    setLogs(Array.isArray(res?.logs) ? res.logs : []);
  };

  const loadAll = async () => {
    await Promise.all([loadAudiences(), loadProfileTemplates(), loadLogs()]);
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadProfileTemplates();
  }, [qProfiles]);

  useEffect(() => {
    loadLogs();
  }, [qLogs]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Database size={18} className="text-blue-400" />
          Управление данными
        </h3>
        <button
          onClick={loadAll}
          className="text-xs px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-200 hover:border-blue-500 flex items-center gap-2"
        >
          <RefreshCw size={14} />
          Обновить
        </button>
      </div>
      {status && <div className="text-xs text-cyan-300">{status}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-base font-bold text-white">Аудитории</h4>
            <button
              type="button"
              onClick={async () => {
                if (!selectedAudienceRows.length) return;
                if (!window.confirm(`Удалить выбранные аудитории (${selectedAudienceRows.length})?`)) return;
                setBusy(true);
                try {
                  const r = await api.deleteDatabaseAudiences({ sourceLinks: selectedAudienceRows });
                  setStatus(`Удалено аудиторий: профили ${Number(r?.profiles) || 0}, запуски ${Number(r?.runs) || 0}`);
                  setSelectedAudienceRows([]);
                  await loadAll();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={!selectedAudienceRows.length || busy}
              className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
            >
              <Trash2 size={12} className="inline mr-1" /> Удалить выбранные
            </button>
          </div>
          <button
            type="button"
            disabled={!audiences.length || busy}
            onClick={async () => {
              if (!window.confirm("Удалить ВСЕ аудитории и все профили?")) return;
              setBusy(true);
              try {
                const r = await api.deleteDatabaseAudiences({ all: true });
                setStatus(`Удалено все аудитории: профили ${Number(r?.profiles) || 0}, запуски ${Number(r?.runs) || 0}`);
                setSelectedAudience("");
                setSelectedAudienceRows([]);
                await loadAll();
              } finally {
                setBusy(false);
              }
            }}
            className="mb-3 text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
          >
            <Trash2 size={12} className="inline mr-1" /> Удалить все аудитории
          </button>
          <div className="max-h-80 overflow-auto space-y-2">
            {audiences.map((a) => (
              <div key={a.source_link} className={`border rounded p-2 ${selectedAudience === a.source_link ? "border-cyan-500" : "border-gray-800"}`}>
                <div className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={selectedAudienceRows.includes(a.source_link)}
                    onChange={(e) =>
                      setSelectedAudienceRows((prev) =>
                        e.target.checked ? [...new Set([...prev, a.source_link])] : prev.filter((x) => x !== a.source_link),
                      )
                    }
                  />
                  <button type="button" onClick={() => setSelectedAudience(a.source_link)} className="text-left">
                    <div className="text-sm text-white break-all">{a.source_link}</div>
                    <div className="text-xs text-gray-400">профилей {a.profiles_count} • username {a.with_username} • запусков {a.runs_count}</div>
                  </button>
                </div>
              </div>
            ))}
            {!audiences.length && <div className="text-xs text-gray-500">Аудиторий пока нет.</div>}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-base font-bold text-white">Шаблоны профилей (редактирование)</h4>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!selectedTemplateRows.length || busy}
                onClick={async () => {
                  if (!window.confirm(`Удалить выбранные шаблоны (${selectedTemplateRows.length})?`)) return;
                  setBusy(true);
                  try {
                    for (const id of selectedTemplateRows) {
                      // eslint-disable-next-line no-await-in-loop
                      await api.deleteProfileStyleTemplate(id);
                    }
                    setStatus(`Удалено шаблонов: ${selectedTemplateRows.length}`);
                    setSelectedTemplateRows([]);
                    await loadProfileTemplates();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
              >
                <Trash2 size={12} className="inline mr-1" /> Удалить выбранные
              </button>
              <button
                type="button"
                disabled={!profileTemplates.length || busy}
                onClick={async () => {
                  if (!window.confirm("Удалить ВСЕ шаблоны профилей?")) return;
                  setBusy(true);
                  try {
                    for (const t of profileTemplates) {
                      // eslint-disable-next-line no-await-in-loop
                      await api.deleteProfileStyleTemplate(t.id);
                    }
                    setStatus(`Удалено шаблонов: ${profileTemplates.length}`);
                    setSelectedTemplateRows([]);
                    await loadProfileTemplates();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
              >
                <Trash2 size={12} className="inline mr-1" /> Удалить все
              </button>
            </div>
          </div>
          <input
            value={qProfiles}
            onChange={(e) => setQProfiles(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm text-white mb-3"
            placeholder="Поиск по названию/имени/фамилии/username..."
          />
          <div className="max-h-96 overflow-auto border border-gray-800 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 text-gray-400">
                <tr>
                  <th className="text-left px-2 py-2">#</th>
                  <th className="text-left px-2 py-2">Шаблон</th>
                  <th className="text-left px-2 py-2">Имя</th>
                  <th className="text-left px-2 py-2">Фамилия</th>
                  <th className="text-left px-2 py-2">Username</th>
                  <th className="text-left px-2 py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {profileTemplates.map((p) => (
                  <tr key={p.id} className="border-t border-gray-800">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selectedTemplateRows.includes(p.id)}
                        onChange={(e) =>
                          setSelectedTemplateRows((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, p.id])]
                              : prev.filter((x) => x !== p.id),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2 text-gray-200 font-mono">{p.name}</td>
                    <td className="px-2 py-2">
                      <input
                        defaultValue={p.firstName || ""}
                        onBlur={async (e) => {
                          const v = String(e.target.value || "").trim();
                          if (v === String(p.firstName || "")) return;
                          await api.updateProfileStyleTemplate(p.id, { ...p, firstName: v });
                          setStatus(`Шаблон #${p.id} обновлен`);
                          await loadProfileTemplates();
                        }}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white w-36"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        defaultValue={p.lastName || ""}
                        onBlur={async (e) => {
                          const v = String(e.target.value || "").trim();
                          if (v === String(p.lastName || "")) return;
                          await api.updateProfileStyleTemplate(p.id, { ...p, lastName: v });
                          setStatus(`Шаблон #${p.id} обновлен`);
                          await loadProfileTemplates();
                        }}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white w-32"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        defaultValue={p.username || ""}
                        onBlur={async (e) => {
                          const v = String(e.target.value || "").trim();
                          if (v === String(p.username || "")) return;
                          await api.updateProfileStyleTemplate(p.id, { ...p, username: v });
                          setStatus(`Шаблон #${p.id} обновлен`);
                          await loadProfileTemplates();
                        }}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white w-32"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-red-300 border border-red-800 rounded px-2 py-1"
                        onClick={async () => {
                          if (!window.confirm(`Удалить шаблон ${p.name}?`)) return;
                          await api.deleteProfileStyleTemplate(p.id);
                          setStatus(`Шаблон ${p.name} удален`);
                          await loadProfileTemplates();
                        }}
                      >
                        <Trash2 size={12} className="inline mr-1" /> Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!profileTemplates.length && <div className="text-xs text-gray-500 p-3">Шаблонов профилей нет.</div>}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-base font-bold text-white">Логи (system_events)</h4>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!selectedLogRows.length || busy}
              onClick={async () => {
                if (!window.confirm(`Удалить выбранные логи (${selectedLogRows.length})?`)) return;
                setBusy(true);
                try {
                  const r = await api.deleteDatabaseLogs({ ids: selectedLogRows });
                  setStatus(`Удалено логов: ${Number(r?.removed) || 0}`);
                  setSelectedLogRows([]);
                  await loadLogs();
                } finally {
                  setBusy(false);
                }
              }}
              className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
            >
              <Trash2 size={12} className="inline mr-1" /> Удалить выбранные
            </button>
            <button
              type="button"
              disabled={!logs.length || busy}
              onClick={async () => {
                if (!window.confirm("Удалить все логи?")) return;
                setBusy(true);
                try {
                  const r = await api.deleteDatabaseLogs({ all: true });
                  setStatus(`Удалено логов: ${Number(r?.removed) || 0}`);
                  setSelectedLogRows([]);
                  await loadLogs();
                } finally {
                  setBusy(false);
                }
              }}
              className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-50"
            >
              <Trash2 size={12} className="inline mr-1" /> Удалить все логи
            </button>
          </div>
        </div>
        <input
          value={qLogs}
          onChange={(e) => setQLogs(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm text-white mb-3"
          placeholder="Поиск по логам..."
        />
        <div className="space-y-2 max-h-72 overflow-auto">
          {logs.map((ev) => (
            <div key={ev.id} className="text-sm text-gray-300 border border-gray-800 bg-gray-800/30 rounded-md px-3 py-2 flex gap-2">
              <input
                type="checkbox"
                checked={selectedLogRows.includes(ev.id)}
                onChange={(e) =>
                  setSelectedLogRows((prev) => (e.target.checked ? [...new Set([...prev, ev.id])] : prev.filter((x) => x !== ev.id)))
                }
              />
              <div className="flex-1">
                {new Date(ev.created_at).toLocaleString()} • {ev.message}
              </div>
            </div>
          ))}
          {!logs.length && <div className="text-sm text-gray-500">Логов нет</div>}
        </div>
      </div>
    </div>
  );
};

export default DatabaseModule;
