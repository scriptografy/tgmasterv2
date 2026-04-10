import React from "react";
import { Filter, Play, Square } from "lucide-react";

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const MIN_JOIN_WAIT_SECONDS = 5;
const MAX_JOIN_WAIT_SECONDS = 600;

const ParsingControls = ({
  sessionName, setSessionName, sessionOptions, sourceLink, setSourceLink, activeLastDays, setActiveLastDays,
  premiumFilter, setPremiumFilter, variant, setVariant, joinWaitSeconds, setJoinWaitSeconds, startParsing, stopParsing, canStart, isParsing,
}) => (
  <div className="xl:col-span-1 bg-gray-900 border border-gray-800 rounded-xl p-6">
    <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Filter className="mr-2 text-blue-400" size={18} />Настройки парсинга</h3>
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Session Path</label>
        <select value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm">
          {!sessionOptions.length && <option value="sessions/main">sessions/main</option>}
          {sessionOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Источник</label>
        <input value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm" placeholder="https://t.me/channel_or_chat" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Активность (дней)</label>
        <input
          type="number"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={activeLastDays}
          onChange={(e) => setActiveLastDays(Number(e.target.value))}
          className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm"
        />
        <div className="mt-1 text-[11px] text-gray-500">Лимит: {MIN_DAYS}-{MAX_DAYS} дней</div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Фильтр Premium</label>
        <select value={premiumFilter} onChange={(e) => setPremiumFilter(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm">
          <option value="all">Все</option><option value="premium">Только Premium</option><option value="non_premium">Только Non-Premium</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Вариант парсинга</label>
        <select value={variant} onChange={(e) => setVariant(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm">
          <option value="smart">Smart (рекомендуется)</option>
          <option value="chat_authors">Авторы из чата</option>
          <option value="discussion_authors">Авторы обсуждений</option>
          <option value="all_recent">Все активные (широкий)</option>
          <option value="premium_active">Только premium активные</option>
          <option value="ids_only">Только ID (без username)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Ожидание заявки (сек)</label>
        <input
          type="number"
          min={MIN_JOIN_WAIT_SECONDS}
          max={MAX_JOIN_WAIT_SECONDS}
          value={joinWaitSeconds}
          onChange={(e) => setJoinWaitSeconds(Number(e.target.value) || 20)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm"
        />
        <div className="mt-1 text-[11px] text-gray-500">Лимит: {MIN_JOIN_WAIT_SECONDS}-{MAX_JOIN_WAIT_SECONDS} сек</div>
      </div>
      <div className="flex gap-2">
        <button onClick={startParsing} disabled={!canStart || isParsing} className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 ${!canStart || isParsing ? "bg-gray-700 text-gray-400" : "bg-blue-600 hover:bg-blue-700 text-white"}`}><Play size={14} />Запустить</button>
        <button onClick={stopParsing} disabled={!isParsing} className={`px-4 rounded-lg text-sm font-bold flex items-center justify-center gap-2 ${isParsing ? "bg-red-600/20 text-red-300 border border-red-500/40" : "bg-gray-800 text-gray-500 border border-gray-700"}`}><Square size={13} />Стоп</button>
      </div>
    </div>
  </div>
);

export default ParsingControls;
