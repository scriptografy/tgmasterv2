import React, { useEffect, useState } from "react";
import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import AccountsManager from "./modules/accounts/AccountsManager";
import DashboardStats from "./modules/dashboard/DashboardStats";
import DatabaseModule from "./modules/database/DatabaseModule";
import MailingModule from "./modules/mailing/MailingModule";
import ParsingModule from "./modules/parsing/ParsingModule";
import BotAdminParsingModule from "./modules/parsing/BotAdminParsingModule";
import BotInvitesModule from "./modules/bot-invites/BotInvitesModule";
import ProxyManager from "./modules/proxy/ProxyManager";
import ReactionsModule from "./modules/reactions/ReactionsModule";
import SettingsPanel from "./modules/settings/SettingsPanel";
import { useCampaignState } from "./hooks/useCampaignState";
import { api } from "./api/client";
import "./styles/animations.css";

const App = () => {
  const state = useCampaignState();
  const [licenseLoading, setLicenseLoading] = useState(true);
  const [licenseUnlocked, setLicenseUnlocked] = useState(false);
  const [licensePassword, setLicensePassword] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [licenseSubmitting, setLicenseSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .getLicenseStatus()
      .then((r) => {
        if (!mounted) return;
        setLicenseUnlocked(Boolean(r?.unlocked));
      })
      .catch(() => {
        if (!mounted) return;
        setLicenseUnlocked(false);
        setLicenseError("Не удалось проверить лицензию. Проверьте API-сервер.");
      })
      .finally(() => {
        if (!mounted) return;
        setLicenseLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const submitLicense = async (e) => {
    e.preventDefault();
    if (!licensePassword.trim()) {
      setLicenseError("Введите лицензионный ключ.");
      return;
    }
    setLicenseSubmitting(true);
    setLicenseError("");
    try {
      const r = await api.unlockLicense(licensePassword.trim());
      if (r?.unlocked) {
        setLicenseUnlocked(true);
        setLicensePassword("");
        return;
      }
      setLicenseError("Неверный ключ.");
    } catch (err) {
      let msg = String(err?.message || err || "Ошибка активации");
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = String(parsed.error);
      } catch {}
      setLicenseError(msg);
    } finally {
      setLicenseSubmitting(false);
    }
  };

  if (licenseLoading) {
    return (
      <div className="min-h-screen bg-black text-gray-200 grid place-items-center">
        <div className="text-sm text-gray-400">Проверка лицензии...</div>
      </div>
    );
  }

  if (!licenseUnlocked) {
    return (
      <div className="min-h-screen bg-black text-gray-200 grid place-items-center p-4">
        <form
          onSubmit={submitLicense}
          className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-lg font-bold text-white">Активация лицензии</h2>
          <p className="text-xs text-gray-500">Для запуска программы введите лицензию.</p>
          <input
            type="password"
            value={licensePassword}
            onChange={(e) => setLicensePassword(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
            placeholder="Введите ключ"
            autoFocus
          />
          <button
            type="submit"
            disabled={licenseSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-bold"
          >
            {licenseSubmitting ? "Проверка..." : "Активировать"}
          </button>
          {licenseError && <div className="text-xs text-red-400">{licenseError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-200 flex font-sans selection:bg-blue-500/30">
      <Sidebar activeTab={state.activeTab} setActiveTab={state.setActiveTab} />
      <main className="ml-64 flex-1 p-8">
        <Header activeTab={state.activeTab} />

        <div className="transition-all duration-300">
          {state.activeTab === "mailing" && (
            <MailingModule
              mailingType={state.mailingType}
              setMailingType={state.setMailingType}
              campaignText={state.campaignText}
              setCampaignText={state.setCampaignText}
              withMedia={state.withMedia}
              setWithMedia={state.setWithMedia}
              recipientsText={state.recipientsText}
              setRecipientsText={state.setRecipientsText}
              recipientsCount={state.recipientsCount}
              isMailing={state.isMailing}
              setIsMailing={state.setIsMailing}
              canStartCampaign={state.canStartCampaign}
              toggleMailing={state.toggleMailing}
              aiRewriteEnabled={state.aiRewriteEnabled}
              setActiveTab={state.setActiveTab}
            />
          )}
          {state.activeTab === "settings" && (
            <SettingsPanel
              aiRewriteEnabled={state.aiRewriteEnabled}
              setAiRewriteEnabled={state.setAiRewriteEnabled}
              aiProvider={state.aiProvider}
              setAiProvider={state.setAiProvider}
            />
          )}
          {state.activeTab === "dashboard" && <DashboardStats />}
          {state.activeTab === "accounts" && <AccountsManager />}
          {state.activeTab === "parsing" && <ParsingModule />}
          {state.activeTab === "bot_parsing" && <BotAdminParsingModule />}
          {state.activeTab === "bot_invites" && <BotInvitesModule />}
          {state.activeTab === "reactions" && <ReactionsModule />}
          {state.activeTab === "proxy" && <ProxyManager />}
          {state.activeTab === "database" && <DatabaseModule />}
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-800/80 max-w-5xl">
          <p className="text-sm leading-relaxed text-gray-500">
            <span className="font-semibold text-gray-400">DISCLAIMER:</span> Это ПО предоставляется «как есть» для автоматизации и
            аналитики. Используя программу, вы берете на себя полную ответственность за соблюдение правил Telegram и законов вашей
            страны. Разработчик не несет ответственности за блокировки аккаунтов или любые нарушения, совершенные с помощью данного
            софта.
          </p>
        </footer>
      </main>
    </div>
  );
};

export default App;
