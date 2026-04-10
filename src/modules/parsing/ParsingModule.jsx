import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import ParsingControls from "./ParsingControls";
import ParsingLiveView from "./ParsingLiveView";
import { mapAccountsToOptions } from "../../utils/accountOptions";

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const ParsingModule = () => {
  const [sourceLink, setSourceLink] = useState(""); const [activeLastDays, setActiveLastDays] = useState(30); const [premiumFilter, setPremiumFilter] = useState("all");
  const [variant, setVariant] = useState("smart"); const [sessionName, setSessionName] = useState("sessions/main"); const [sessionOptions, setSessionOptions] = useState([]);
  const [joinWaitSeconds, setJoinWaitSeconds] = useState(20);
  const [isParsing, setIsParsing] = useState(false); const [progress, setProgress] = useState(0); const [liveCount, setLiveCount] = useState(0);
  const [logs, setLogs] = useState(["Система готова. Укажите источник и нажмите 'Запустить'."]); const [results, setResults] = useState([]); const [runInfo, setRunInfo] = useState(null);
  const [audienceDir, setAudienceDir] = useState("");
  const canStart = sourceLink.trim().length > 0;

  useEffect(() => {
    api
      .getAccounts()
      .then((a) => {
        const o = mapAccountsToOptions(a);
        setSessionOptions(o);
        if (o.length) setSessionName(o[0].value);
      })
      .catch(() => setSessionOptions([]));
  }, []);
  const mapRows = (data) => data.results.map((r) => ({ username: r.username || "-", id: r.id, source: r.source, isPremium: r.isPremium, lastSeenDays: Math.max(0, Math.floor((Date.now() - new Date(r.lastActivityAt).getTime()) / 86400000)) }));

  const startParsing = async () => {
    if (!canStart || isParsing) return; setProgress(3); setIsParsing(true); setLogs((p) => [`Старт Telethon: ${sourceLink}`, ...p]);
    const safeDays = clamp(activeLastDays, 1, 365, 30);
    const safeJoinWait = clamp(joinWaitSeconds, 5, 600, 20);
    setActiveLastDays(safeDays);
    setJoinWaitSeconds(safeJoinWait);
    try { await api.startTelethonParsing({ sessionName, sourceLink, variant, periodDays: safeDays, premiumFilter, joinWaitSeconds: safeJoinWait }); setLogs((p) => [`Telethon job запущен. Лимиты: ${safeDays}д, ожидание ${safeJoinWait}с.`, ...p]); }
    catch (err) { setLogs((p) => [`Ошибка парсинга: ${err.message}`, ...p]); setProgress(0); setIsParsing(false); }
  };
  const stopParsing = async () => { await api.stopTelethonParsing(); setIsParsing(false); setProgress(0); setLogs((p) => ["Остановлено пользователем.", ...p]); };

  useEffect(() => {
    if (!isParsing) return undefined;
    const t = setInterval(async () => {
      try {
        const s = await api.getTelethonParsingStatus(); setProgress(s.progress || 0); setLiveCount(s.liveCount || 0); if (s.logs?.length) setLogs(s.logs); if (s.audienceDir) setAudienceDir(s.audienceDir);
        const live = await api.getParsingLiveResults(); if (live.results?.length) setResults(mapRows(live));
        if (!s.running) { setIsParsing(false); if (s.status === "done") { const finalData = await api.getParsingResults({ sourceLink, periodDays: activeLastDays, premiumFilter }); const m = mapRows(finalData); setResults(m); setLogs((p) => [`Готово: найдено ${m.length} уникальных пользователей.`, ...p]); } else if (s.status === "error") setLogs((p) => [`Ошибка Telethon: ${s.error || "unknown"}`, ...p]); }
      } catch (err) { setLogs((p) => [`Ошибка статуса: ${err.message}`, ...p]); }
    }, 1000);
    return () => clearInterval(t);
  }, [isParsing, sourceLink, activeLastDays, premiumFilter]);

  const filteredResults = useMemo(() => { let n = results.filter((r) => r.lastSeenDays <= activeLastDays); if (premiumFilter === "premium") n = n.filter((r) => r.isPremium); if (premiumFilter === "non_premium") n = n.filter((r) => !r.isPremium); const s = new Set(); return n.filter((r) => (s.has(r.id) ? false : (s.add(r.id), true))); }, [results, activeLastDays, premiumFilter]);
  const uniqueCount = useMemo(() => new Set(filteredResults.map((r) => r.id)).size, [filteredResults]);
  const exportCsv = () => { const header = "username,id,source,last_seen_days,premium\n"; const rows = filteredResults.map((r) => `${r.username},${r.id},${r.source},${r.lastSeenDays},${r.isPremium ? "premium" : "non-premium"}`).join("\n"); const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "parsing-results.csv"; a.click(); URL.revokeObjectURL(url); };

  return <div className="space-y-6 animate-in fade-in duration-500"><div className="grid grid-cols-1 xl:grid-cols-3 gap-6"><ParsingControls sessionName={sessionName} setSessionName={setSessionName} sessionOptions={sessionOptions} sourceLink={sourceLink} setSourceLink={setSourceLink} activeLastDays={activeLastDays} setActiveLastDays={setActiveLastDays} premiumFilter={premiumFilter} setPremiumFilter={setPremiumFilter} variant={variant} setVariant={setVariant} joinWaitSeconds={joinWaitSeconds} setJoinWaitSeconds={setJoinWaitSeconds} startParsing={startParsing} stopParsing={stopParsing} canStart={canStart} isParsing={isParsing} /><ParsingLiveView progress={progress} runInfo={runInfo} filteredResults={filteredResults} uniqueCount={uniqueCount} exportCsv={exportCsv} logs={logs} liveCount={liveCount} audienceDir={audienceDir} /></div></div>;
};

export default ParsingModule;
