import fs from "fs";
import path from "path";

const resolveParserDir = (rootDir) => {
  const env = process.env.SOFTPROG_PARSER_DIR?.trim();
  if (env) {
    return path.isAbsolute(env) ? env : path.join(rootDir, env);
  }
  const obfMain = path.join(rootDir, "parser_obf", "telethon_parser.py");
  if (fs.existsSync(obfMain)) {
    return path.join(rootDir, "parser_obf");
  }
  return path.join(rootDir, "parser");
};

export const getTelegramScripts = (rootDir) => {
  const d = resolveParserDir(rootDir);
  const fallback = path.join(rootDir, "parser");
  const pick = (name) => {
    const preferred = path.join(d, name);
    if (fs.existsSync(preferred)) return preferred;
    return path.join(fallback, name);
  };
  return {
    parserScript: pick("telethon_parser.py"),
    botParserScript: pick("telethon_bot_parser.py"),
    authScript: pick("telethon_auth.py"),
    mailingScript: pick("telethon_mailing.py"),
    profileScript: pick("telethon_profile.py"),
    spambotScript: pick("telethon_spambot.py"),
    reactionsScript: pick("telethon_reactions.py"),
    messagesScript: pick("telethon_messages.py"),
    exitIpScript: pick("check_exit_ip.py"),
    proxyExitIpScript: pick("proxy_exit_ip.py"),
  };
};
