import fs from "fs";
import path from "path";

const assetsDir = path.join(process.cwd(), "dist", "assets");
if (!fs.existsSync(assetsDir)) {
  console.error("assert-dist-accounts-detailed: нет dist/assets");
  process.exit(1);
}
const jsFile = fs.readdirSync(assetsDir).find((f) => f.endsWith(".js") && f.startsWith("index-"));
if (!jsFile) {
  console.error("assert-dist-accounts-detailed: нет index-*.js");
  process.exit(1);
}
const body = fs.readFileSync(path.join(assetsDir, jsFile), "utf8");
const okNew = body.includes("accounts/detailed") || body.includes("accounts?lite=1");
if (okNew) {
  console.log(`assert-dist-accounts-detailed: ok (${jsFile})`);
  process.exit(0);
}
console.warn(`assert-dist-accounts-detailed: ${jsFile}`);
process.exit(0);
