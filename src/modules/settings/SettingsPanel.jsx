import React, { useEffect, useState } from "react";
import { BrainCircuit, Settings, Zap } from "lucide-react";
import { api } from "../../api/client";

const SettingsPanel = ({ aiRewriteEnabled, setAiRewriteEnabled, aiProvider, setAiProvider }) => {
  const [telegramApiId, setTelegramApiId] = useState("");
  const [telegramApiHash, setTelegramApiHash] = useState("");
  const [botToken, setBotToken] = useState("");
  const [sessionName, setSessionName] = useState("sessions/main");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password2fa, setPassword2fa] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [aiApiToken, setAiApiToken] = useState("");

  useEffect(() => {
    api
      .getAppSettings()
      .then((s) => {
        setTelegramApiId(s.telegramApiId || "");
        setTelegramApiHash(s.telegramApiHash || "");
        setBotToken(s.botToken || "");
        setAiRewriteEnabled(Boolean(s.aiRewriteEnabled));
        setAiProvider(s.aiProvider || "gemini");
        setAiApiToken(s.aiApiToken || "");
      })
      .catch(() => setSaveMsg("Не удалось загрузить настройки Telegram."));
  }, []);

  const saveTelegramSettings = async () => {
    await api.updateAppSettings({
      telegramApiId,
      telegramApiHash,
      botToken,
      aiRewriteEnabled,
      aiProvider,
      aiApiToken,
    });
    setSaveMsg("Telegram API настройки сохранены.");
  };

  const requestCode = async () => {
    await api.telegramSendCode({ phone, sessionName });
    setSaveMsg("Код отправлен в Telegram.");
  };

  const verifyCode = async () => {
    try {
      await api.telegramVerifyCode({ sessionName, code, password: password2fa });
      setSaveMsg("Сессия успешно авторизована.");
    } catch (err) {
      setSaveMsg(`Ошибка авторизации: ${err.message}`);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-500">
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-6 flex items-center">
        <BrainCircuit className="mr-2 text-pink-500" size={20} />
        Интеграция ИИ (AI rewrite)
      </h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 mb-4">
          <div className="flex flex-col">
            <span className="text-sm text-white font-medium">Уникализация текста</span>
            <span className="text-[10px] text-gray-500 italic">Переписывать сообщение перед каждой отправкой</span>
          </div>
          <input
            type="checkbox"
            checked={aiRewriteEnabled}
            onChange={(e) => setAiRewriteEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">Провайдер ИИ</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAiProvider("gemini")}
              className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                aiProvider === "gemini"
                  ? "bg-blue-600/10 border-blue-500 text-blue-400"
                  : "bg-gray-800 border-gray-700 text-gray-500"
              }`}
            >
              Google Gemini
            </button>
            <button
              onClick={() => setAiProvider("openai")}
              className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                aiProvider === "openai"
                  ? "bg-green-600/10 border-green-500 text-green-400"
                  : "bg-gray-800 border-gray-700 text-gray-500"
              }`}
            >
              OpenAI (GPT)
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 uppercase font-bold tracking-wider">API Токен</label>
          <div className="relative">
            <input
              type="password"
              value={aiApiToken}
              onChange={(e) => setAiApiToken(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500 pr-10"
              placeholder="sk-..."
            />
            <Settings size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600" />
          </div>
        </div>
      </div>
    </div>

    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center">
          <Settings className="mr-2 text-cyan-500" size={20} />
          Telegram API
        </h3>
        <div className="space-y-3">
          <input
            value={telegramApiId}
            onChange={(e) => setTelegramApiId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
            placeholder="API ID"
          />
          <input
            type="password"
            value={telegramApiHash}
            onChange={(e) => setTelegramApiHash(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
            placeholder="API HASH"
          />
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
            placeholder="Bot Token (для разделов бота)"
          />
          <button onClick={saveTelegramSettings} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold">
            Сохранить
          </button>
          <div className="pt-3 border-t border-gray-800 space-y-2">
            <input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
              placeholder="sessions/main"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
              placeholder="+79990000000"
            />
            <button onClick={requestCode} className="w-full bg-gray-800 border border-gray-700 hover:border-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
              Запросить код
            </button>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
              placeholder="Код из Telegram"
            />
            <input
              type="password"
              value={password2fa}
              onChange={(e) => setPassword2fa(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md p-2.5 text-white text-sm outline-none focus:border-blue-500"
              placeholder="2FA пароль (если включен)"
            />
            <button onClick={verifyCode} className="w-full bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold">
              Подтвердить и создать сессию
            </button>
          </div>
          {saveMsg && <p className="text-xs text-gray-400">{saveMsg}</p>}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center">
          <Zap className="mr-2 text-yellow-500" size={20} />
          Лимиты
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm outline-none"
            defaultValue="30-60"
          />
          <input
            type="number"
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white text-sm outline-none"
            defaultValue="5"
          />
        </div>
      </div>
    </div>
  </div>
  );
};

export default SettingsPanel;
