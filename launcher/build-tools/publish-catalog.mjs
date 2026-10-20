import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const secret = process.env.DARKWHISPERS_SIGNING_KEY || resolve(root, ".tools/launcher-build/catalog-signing-key.pem");
function readOptional(path) {
  try { return readFileSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
let privateBytes = readOptional(secret);
if (privateBytes === null) {
  if (!process.argv.includes("--init-key")) throw new Error("Signing key missing. Restore it or explicitly initialize the first key.");
  mkdirSync(dirname(secret), { recursive: true });
  const pair = generateKeyPairSync("ed25519");
  try { writeFileSync(secret, pair.privateKey.export({type:"pkcs8",format:"pem"}), {mode:0o600, flag:"wx"}); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  privateBytes = readFileSync(secret);
}
const privateKey = createPrivateKey(privateBytes);
const publicKey = createPublicKey(privateKey).export({type:"spki",format:"der"}).subarray(-32);
const source = resolve(root, "launcher/crates/addon-core/src");
mkdirSync(source, {recursive:true});
const keyFile = resolve(source, "catalog-public-key.bin");
const trustedKey = readOptional(keyFile);
if (trustedKey !== null && !trustedKey.equals(publicKey)) {
  throw new Error("Signing key differs from the launcher's trusted key. Do not rotate it accidentally.");
}
if (trustedKey === null) {
  if (!process.argv.includes("--init-key")) throw new Error("Trusted public key missing. Restore it from the repository; initialize only the first key explicitly.");
  try { writeFileSync(keyFile, publicKey, {flag:"wx"}); }
  catch (error) {
    if (error.code !== "EEXIST" || !readFileSync(keyFile).equals(publicKey)) throw error;
  }
}
const addonBase = existsSync(resolve(root, "addons")) ? resolve(root, "addons") : root;
const toc = readFileSync(resolve(addonBase,"DarkWhisperRaidTools/DarkWhisperRaidTools.toc"),"utf8");
const version = toc.match(/^## Version:\s*([0-9.]+)\s*$/m)?.[1];
if (!version) throw new Error("Missing addon version");
const archiveName = `DarkWhisperRaidTools-${version}.zip`;
const archive = readFileSync(resolve(root,"website/public/downloads",archiveName));
const runtimeRoot = resolve(addonBase, "DarkWhisperRaidTools");
const files = [];
function collectRuntime(directory, prefix = "") {
  for (const entry of readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error("Runtime links cannot be published.");
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    const sourceFile = resolve(directory, entry.name);
    if (entry.isDirectory()) { collectRuntime(sourceFile, relative); continue; }
    if (!/\.(lua|toc|tga)$/.test(entry.name)) continue;
    const content = readFileSync(sourceFile);
    const output = resolve(root, "website/public/addons/DarkWhisperRaidTools", version, relative);
    mkdirSync(dirname(output), {recursive:true});
    writeFileSync(output, content);
    writeFileSync(output + ".gz", gzipSync(content, {level:9}));
    files.push({
      path:relative,
      url:"https://darkwhispers.akion.se/addons/DarkWhisperRaidTools/" + version + "/" + relative.split("/").map(encodeURIComponent).join("/"),
      bytes:content.length,
      sha256:createHash("sha256").update(content).digest("hex")
    });
  }
}
collectRuntime(runtimeRoot);
if (files.length !== 7) throw new Error("Unexpected runtime inventory. Review the release allowlist.");
const payload = Buffer.from(JSON.stringify({
  schema:1,
  addons:[{
    id:"DarkWhisperRaidTools",
    title:"DarkWhisper Raid Tools",
    description:"Your raid markers. Your north. A standalone compass with custom layouts.",
    version,
    download_url:`https://darkwhispers.akion.se/downloads/${archiveName}`,
    sha256:createHash("sha256").update(archive).digest("hex"),
    files_schema:1,
    files
  }]
}));
const envelope = JSON.stringify({payload:payload.toString("base64"),signature:sign(null,payload,privateKey).toString("base64")});
const endpoint = resolve(root,"website/public/api/v1");
mkdirSync(endpoint,{recursive:true});
writeFileSync(resolve(endpoint,"catalog.json"),envelope+"\n");
writeFileSync(resolve(source,"bundled-catalog.json"),envelope+"\n");
console.log("Signed addon catalog written. Only the public verification key and signed catalog may be published.");
