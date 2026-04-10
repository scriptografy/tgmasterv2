export const createTelegramState = () => {
  const parsingJob = {
    running: false,
    pid: null,
    startedAt: null,
    finishedAt: null,
    status: "idle",
    progress: 0,
    logs: [],
    error: null,
    sourceLink: null,
    liveFile: null,
    audienceDir: null,
    audiencePath: null,
    stopRequested: false,
    lastAudienceDir: null,
  };
  const botParsingJob = {
    running: false,
    pid: null,
    startedAt: null,
    finishedAt: null,
    status: "idle",
    progress: 0,
    logs: [],
    error: null,
    sourceLink: null,
    liveFile: null,
    audienceDir: null,
    audiencePath: null,
    stopRequested: false,
    lastAudienceDir: null,
  };
  const mailingJob = {
    running: false,
    pid: null,
    status: "idle",
    progress: 0,
    logs: [],
    liveFile: null,
    error: null,
    audienceTotal: 0,
  };
  const reactionsJob = { running: false, pid: null, status: "idle", progress: 0, logs: [], error: null };
  const pendingAuth = new Map();

  const pushJobLog = (line) => {
    parsingJob.logs.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (parsingJob.logs.length > 200) parsingJob.logs = parsingJob.logs.slice(0, 200);
  };
  const pushMailLog = (line) => {
    mailingJob.logs.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (mailingJob.logs.length > 200) mailingJob.logs = mailingJob.logs.slice(0, 200);
  };
  const pushBotParsingLog = (line) => {
    botParsingJob.logs.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (botParsingJob.logs.length > 200) botParsingJob.logs = botParsingJob.logs.slice(0, 200);
  };
  const pushReactionsLog = (line) => {
    reactionsJob.logs.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (reactionsJob.logs.length > 200) reactionsJob.logs = reactionsJob.logs.slice(0, 200);
  };

  return {
    parsingJob,
    botParsingJob,
    mailingJob,
    reactionsJob,
    pendingAuth,
    pushJobLog,
    pushBotParsingLog,
    pushMailLog,
    pushReactionsLog,
  };
};
