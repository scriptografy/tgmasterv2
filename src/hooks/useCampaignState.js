import { useMemo, useState } from "react";

export const useCampaignState = () => {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem("softprog_active_tab") || "mailing";
    } catch {
      return "mailing";
    }
  });
  const [isMailing, setIsMailing] = useState(false);
  const [mailingType, setMailingType] = useState("direct");
  const [withMedia, setWithMedia] = useState(false);
  const [aiProvider, setAiProvider] = useState("gemini");
  const [campaignText, setCampaignText] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [aiRewriteEnabled, setAiRewriteEnabled] = useState(false);

  const setActiveTabPersisted = (tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem("softprog_active_tab", String(tab || "mailing"));
    } catch {}
  };

  const recipientsCount = useMemo(
    () =>
      recipientsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean).length,
    [recipientsText]
  );

  const canStartCampaign = campaignText.trim().length > 0 && recipientsCount > 0;

  const toggleMailing = () => {
    if (!isMailing && !canStartCampaign) return;
    setIsMailing((prev) => !prev);
  };

  return {
    activeTab,
    setActiveTab: setActiveTabPersisted,
    isMailing,
    mailingType,
    setMailingType,
    withMedia,
    setWithMedia,
    aiProvider,
    setAiProvider,
    campaignText,
    setCampaignText,
    recipientsText,
    setRecipientsText,
    aiRewriteEnabled,
    setAiRewriteEnabled,
    recipientsCount,
    canStartCampaign,
    toggleMailing,
    setIsMailing,
  };
};
