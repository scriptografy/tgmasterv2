import React from "react";
import { Download, Users } from "lucide-react";

const ParsingLiveView = ({ progress, runInfo, filteredResults, uniqueCount, exportCsv, logs, liveCount, audienceDir }) => (
  <div className="xl:col-span-2 space-y-6">
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-bold text-white">Прогресс</h3>
        <span className="text-sm text-blue-300 font-mono">{progress}%</span>
      </div>
      <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-2">Live режим: результаты и лог идут в реальном времени. Сейчас найдено: {liveCount}</p>
      {audienceDir ? (
        <p className="text-xs text-amber-400/90 mt-1 font-mono break-all">
          Папка аудитории (рассылка): data/parsed_audiences/{audienceDir}
        </p>
      ) : null}
      {runInfo && <p className="text-xs text-gray-500 mt-1">Последний запуск #{runInfo.id}: {new Date(runInfo.created_at).toLocaleString()}</p>}
    </div>
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white flex items-center"><Users className="mr-2 text-green-400" size={18} />Результаты ({filteredResults.length}) • Уникальных: {uniqueCount}</h3>
        <button onClick={exportCsv} className="text-xs px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-200 hover:border-blue-500 flex items-center gap-2"><Download size={14} />Экспорт CSV</button>
      </div>
      <div className="max-h-64 overflow-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/80 text-gray-400 uppercase text-[11px]"><tr><th className="text-left px-3 py-2">Username</th><th className="text-left px-3 py-2">ID</th><th className="text-left px-3 py-2">Источник</th><th className="text-left px-3 py-2">Активность</th></tr></thead>
          <tbody>
            {filteredResults.map((row, idx) => <tr key={`${row.id}-${idx}`} className="border-t border-gray-800"><td className="px-3 py-2 text-white">{row.username}</td><td className="px-3 py-2 text-gray-300 font-mono">{row.id}</td><td className="px-3 py-2 text-gray-300">{row.source}</td><td className="px-3 py-2 text-gray-400">{row.lastSeenDays} дн • {row.isPremium ? "Premium" : "Non-Premium"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Лог</h3>
      <div className="max-h-40 overflow-auto space-y-2">
        {logs.map((entry, idx) => <div key={`${entry}-${idx}`} className="text-xs text-gray-400 bg-gray-800/50 border border-gray-800 rounded-md px-3 py-2">{entry}</div>)}
      </div>
    </div>
  </div>
);

export default ParsingLiveView;
