import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

let cachedPython = null;

const TELETHON_PROBE = "import sys; import telethon; print(sys.executable)";

function readPyarmorPythonTarget(cwd) {
  const paths = [
    path.join(cwd, "parser_obf", ".softprog_pyarmor_python"),
    path.join(cwd, ".softprog_pyarmor_python"),
  ];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const t = fs.readFileSync(p, "utf8").trim();
      const m = /^(\d+)\.(\d+)$/.exec(t);
      if (!m) continue;
      return { major: Number(m[1]), minor: Number(m[2]) };
    } catch {
      continue;
    }
  }
  return null;
}

function unixPythonCommandForTarget(target) {
  if (target.major === 3) return `python3.${target.minor}`;
  return `python${target.major}.${target.minor}`;
}

function probePython(cmd, prefixArgs = []) {
  const args = [...prefixArgs, "-c", TELETHON_PROBE];
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 8000,
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  if (r.error || r.signal || r.status !== 0) return null;
  const lines = String(r.stdout || "")
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const exe = lines.length ? lines[lines.length - 1] : "";
  if (exe && fs.existsSync(exe)) return exe;
  return null;
}

export function resolvePythonExecutable() {
  if (cachedPython) return cachedPython;

  const fromEnv = process.env.TELETHON_PYTHON || process.env.PYTHON;
  if (fromEnv) {
    cachedPython = fromEnv;
    console.log(`[softprog] Python для Telethon (TELETHON_PYTHON/PYTHON): ${cachedPython}`);
    return cachedPython;
  }

  const win32 = process.platform === "win32";
  const cwd = process.cwd();
  const obfMain = path.join(cwd, "parser_obf", "telethon_parser.py");
  const pyarmorTarget = !win32 && fs.existsSync(obfMain) ? readPyarmorPythonTarget(cwd) : null;

  if (pyarmorTarget) {
    const cmd = unixPythonCommandForTarget(pyarmorTarget);
    const exe = probePython(cmd);
    if (exe) {
      cachedPython = exe;
      console.log(
        `[softprog] Python для Telethon (как при сборке PyArmor ${pyarmorTarget.major}.${pyarmorTarget.minor}): ${cachedPython}`,
      );
      return cachedPython;
    }
    console.warn(
      `[softprog] parser_obf собран под Python ${pyarmorTarget.major}.${pyarmorTarget.minor}, но "${cmd}" с Telethon недоступен. ` +
        `Установите Telethon: ${cmd} -m pip install -r parser/requirements.txt (или задайте TELETHON_PYTHON). ` +
        `Либо исходники без PyArmor: SOFTPROG_PARSER_DIR=parser`,
    );
    cachedPython = cmd;
    return cachedPython;
  } else if (!win32 && fs.existsSync(obfMain)) {
    console.warn(
      "[softprog] В parser_obf нет .softprog_pyarmor_python — пересоберите: npm run obfuscate:parser:docker (или obfuscate:parser), иначе возможен ImportError в pyarmor_runtime.",
    );
  }

  const tries = [];

  if (win32) {
    tries.push(() => probePython("python"));
    tries.push(() => probePython("python3"));
    tries.push(() => probePython("py", ["-3"]));
    tries.push(() => probePython("py"));
  } else {
    for (const cmd of ["python3.10", "python3.11", "python3.12", "python3.13", "python3", "python"]) {
      tries.push(() => probePython(cmd));
    }
  }

  for (const run of tries) {
    const exe = run();
    if (exe) {
      cachedPython = exe;
      console.log(`[softprog] Python для Telethon (автовыбор): ${cachedPython}`);
      return cachedPython;
    }
  }

  const candidatesLabel = win32 ? "python, python3, py -3, py" : "python3.x … python3, python";
  cachedPython = win32 ? "python" : "python3";
  console.warn(`[softprog] Telethon не найден (${candidatesLabel}) — fallback: ${cachedPython}`);
  return cachedPython;
}

const parseStdoutJson = (stdout) => {
  const raw = String(stdout || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line.startsWith("{") && !line.startsWith("[")) continue;
      try {
        return JSON.parse(line);
      } catch {}
    }
  }
  throw new Error(`invalid json output: ${raw.slice(0, 500)}`);
};

export const runPythonJson = (rootDir, scriptPath, args) =>
  new Promise((resolve, reject) => {
    const py = resolvePythonExecutable();
    const proc = spawn(py, ["-u", scriptPath, ...args], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => {
      stdout += String(c);
    });
    proc.stderr.on("data", (c) => {
      stderr += String(c);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `python exited with code ${code}`));
        return;
      }
      try {
        resolve(parseStdoutJson(stdout));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
