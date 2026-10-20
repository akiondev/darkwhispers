// The trusted key is public. The signing key never leaves the release workstation.
export const TRUSTED_KEY = "18/LVOx44yCr8bQL6loummNIxhbmwvQTuQy/VfAgNM0=";
const SITE = "https://darkwhispers.akion.se";
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const ALLOWED = new Set(["lua", "toc", "xml", "tga", "blp", "ogg", "wav", "mp3", "ttf", "otf"]);
const VERSION = /^\d{1,8}\.\d{1,8}\.\d{1,8}$/;

function decode64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function safePath(path) {
  if (typeof path !== "string" || path.length > 240) throw new Error("Unsafe addon path.");
  const parts = path.split("/");
  if (parts.length > 12 || parts.some((part) => !/^[a-zA-Z0-9 _.-]+$/.test(part)
      || part === "." || part === ".." || /[. ]$/.test(part)
      || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("Unsafe addon path.");
  }
  return parts;
}
export function validateCatalog(catalog) {
  if (catalog.schema !== 1 || !Array.isArray(catalog.addons) || catalog.addons.length > 100) throw new Error("Unsupported catalog.");
  const ids = new Set();
  for (const addon of catalog.addons) {
    if (!/^[a-zA-Z0-9_]{1,80}$/.test(addon.id) || !VERSION.test(addon.version) || ids.has(addon.id.toLowerCase())) throw new Error("Invalid addon metadata.");
    safePath(addon.id);
    ids.add(addon.id.toLowerCase());
    if (addon.download_url !== SITE + "/downloads/" + addon.id + "-" + addon.version + ".zip" || !/^[a-f0-9]{64}$/i.test(addon.sha256)) throw new Error("Invalid addon download.");
    if (addon.files_schema !== 1 || !Array.isArray(addon.files) || !addon.files.length || addon.files.length > 1024) throw new Error("This addon has no browser installation manifest.");
    let size = 0;
    const paths = new Set();
    for (const file of addon.files) {
      const parts = safePath(file.path);
      const extension = parts.at(-1).split(".").at(-1).toLowerCase();
      if (!ALLOWED.has(extension) || paths.has(file.path.toLowerCase())) throw new Error("Invalid or duplicate addon file.");
      paths.add(file.path.toLowerCase());
      const expected = SITE + "/addons/" + addon.id + "/" + addon.version + "/" + parts.map(encodeURIComponent).join("/");
      if (file.url !== expected || !/^[a-f0-9]{64}$/i.test(file.sha256)
          || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE) throw new Error("Invalid addon file metadata.");
      size += file.bytes;
      if (size > MAX_TOTAL) throw new Error("Addon exceeds installation limits.");
    }
    if (!paths.has((addon.id + ".toc").toLowerCase())) throw new Error("Addon manifest missing.");
  }
  return catalog;
}
export async function verifyCatalog(envelope) {
  if (typeof envelope.payload !== "string" || envelope.payload.length > 350000 || typeof envelope.signature !== "string") throw new Error("Invalid signed catalog.");
  const payload = decode64(envelope.payload);
  let key;
  try {
    key = await crypto.subtle.importKey("raw", decode64(TRUSTED_KEY), {name:"Ed25519"}, false, ["verify"]);
  } catch {
    throw new Error("Your browser cannot verify Ed25519 signatures. Update Chrome/Edge, or use the launcher.");
  }
  if (!(await crypto.subtle.verify({name:"Ed25519"}, key, decode64(envelope.signature), payload))) throw new Error("Catalog signature verification failed. Nothing was installed.");
  return validateCatalog(JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(payload)));
}
export async function fetchBytes(path, limit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(path, {cache:"no-cache", redirect:"error", credentials:"omit", signal:controller.signal});
    if (!response.ok) throw new Error("Download failed (" + response.status + ").");
    if (Number(response.headers.get("content-length")) > limit) throw new Error("Download exceeds its size limit.");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error("Download exceeds its size limit."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { clearTimeout(timeout); }
}
export async function loadCatalog() {
  const bytes = await fetchBytes("/api/v1/catalog.json", 256 * 1024);
  return verifyCatalog(JSON.parse(new TextDecoder().decode(bytes)));
}
export async function verifyAddonFiles(addon, progress = () => {}) {
  validateCatalog({schema:1, addons:[addon]});
  const files = new Map();
  for (const file of addon.files) {
    progress("Verifying files " + (files.size + 1) + "/" + addon.files.length + "…");
    const bytes = await fetchBytes(new URL(file.url).pathname, Math.min(MAX_FILE, file.bytes));
    if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256.toLowerCase()) throw new Error("A file failed its SHA-256 check. Nothing was installed.");
    files.set(file.path, bytes);
  }
  const toc = new TextDecoder().decode(files.get(addon.id + ".toc"));
  if (toc.match(/^## Version:\s*(.*?)\s*$/m)?.[1] !== addon.version) throw new Error("Addon version mismatch. Nothing was installed.");
  return files;
}
async function maybeDirectory(parent, name) {
  try { return await parent.getDirectoryHandle(name); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
}
export async function resolveRetail(selected) {
  const retail = selected.name === "_retail_" ? selected : await maybeDirectory(selected, "_retail_");
  if (!retail || retail.name !== "_retail_") throw new Error("Choose World of Warcraft or its _retail_ folder.");
  let executable = false;
  try { await retail.getFileHandle("Wow.exe"); executable = true; } catch (e) { if (e.name !== "NotFoundError") throw e; }
  if (!executable) throw new Error("This folder is not a WoW Retail installation.");
  return retail;
}
async function directoryAt(root, parts) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, {create:true});
  return dir;
}
export async function snapshotTree(root) {
  const files = new Map();
  files.directories = new Set();
  let total = 0;
  let entries = 0;
  async function walk(dir, prefix, depth) {
    if (depth > 12) throw new Error("Existing addon folder is too deep to back up.");
    for await (const [name, handle] of dir.entries()) {
      if (++entries > 2048) throw new Error("Existing addon folder has too many entries.");
      const path = prefix ? prefix + "/" + name : name;
      safePath(path);
      if (handle.kind === "directory") { files.directories.add(path); await walk(handle, path, depth + 1); }
      else {
        const file = await handle.getFile();
        total += file.size;
        if (files.size >= 1024 || file.size > MAX_FILE || total > MAX_TOTAL) throw new Error("Existing addon is too large to back up in the browser. Use the launcher.");
        files.set(path, new Uint8Array(await file.arrayBuffer()));
      }
    }
  }
  await walk(root, "", 0);
  return files;
}
async function writeTree(root, files, progress = () => {}) {
  let count = 0;
  for (const path of files.directories || []) await directoryAt(root, safePath(path));
  for (const [path, bytes] of files) {
    const parts = safePath(path);
    const filename = parts.pop();
    const parent = await directoryAt(root, parts);
    const handle = await parent.getFileHandle(filename, {create:true});
    const writer = await handle.createWritable();
    try { await writer.write(bytes); await writer.close(); }
    catch (error) { try { await writer.abort(); } catch {} throw error; }
    const written = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (written.length !== bytes.length || await sha256(written) !== await sha256(bytes)) throw new Error("Disk verification failed.");
    progress(++count, files.size);
  }
}
function isNewer(installed, available) {
  if (!VERSION.test(installed)) return false;
  const a = installed.split(".").map(Number), b = available.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
export async function installVerified(retail, addon, files, progress = () => {}) {
  validateCatalog({schema:1, addons:[addon]});
  // Re-check every buffer at the file-write boundary, including test/API callers.
  if (files.size !== addon.files.length) throw new Error("Incomplete verified download.");
  for (const file of addon.files) {
    const bytes = files.get(file.path);
    if (!(bytes instanceof Uint8Array) || bytes.length !== file.bytes || await sha256(bytes) !== file.sha256.toLowerCase()) throw new Error("File integrity check failed.");
  }
  if (new TextDecoder().decode(files.get(addon.id + ".toc")).match(/^## Version:\s*(.*?)\s*$/m)?.[1] !== addon.version) throw new Error("Addon version mismatch.");
  retail = await resolveRetail(retail);
  const addons = await directoryAt(retail, ["Interface", "AddOns"]);
  const previous = await maybeDirectory(addons, addon.id);
  let original = null, backupPath = null;
  if (previous) {
    progress("Reading the existing addon…");
    original = await snapshotTree(previous);
    const toc = original.get(addon.id + ".toc");
    if (!toc || toc.length > 65536) throw new Error("An unrecognized folder already uses this addon name. It was not changed.");
    const installed = new TextDecoder().decode(toc).match(/^## Version:\s*(.*?)\s*$/m)?.[1] || "";
    if (isNewer(installed, addon.version)) throw new Error("A newer addon version is already installed. Downgrade blocked.");
  }
  const token = Date.now() + "-" + crypto.randomUUID().slice(0,8);
  const stagingName = ".darkwhispers-web-stage-" + token;
  let touched = false;
  try {
    const staging = await addons.getDirectoryHandle(stagingName, {create:true});
    progress("Preparing the installation…");
    await writeTree(staging, files);
    if (original) {
      const backupName = addon.id + "-" + token;
      const backup = await directoryAt(addons, [".darkwhispers-web-backups", backupName]);
      progress("Backing up the current addon…");
      await writeTree(backup, original);
      backupPath = "Interface/AddOns/.darkwhispers-web-backups/" + backupName;
    }
    touched = true;
    if (previous) await addons.removeEntry(addon.id, {recursive:true});
    const target = await addons.getDirectoryHandle(addon.id, {create:true});
    await writeTree(target, files, (count,total) => progress("Installing " + count + "/" + total + "…"));
    return {version:addon.version, backupPath, files:files.size};
  } catch (error) {
    if (touched) {
      try {
        if (await maybeDirectory(addons, addon.id)) await addons.removeEntry(addon.id, {recursive:true});
        if (original) await writeTree(await addons.getDirectoryHandle(addon.id, {create:true}), original);
      } catch {
        throw new Error("Installation was interrupted. Restore the previous addon from " + (backupPath || "your backup") + ".");
      }
    }
    throw new Error((error.message || String(error)) + (touched && original ? " The previous addon was restored." : ""));
  } finally {
    try { await addons.removeEntry(stagingName, {recursive:true}); } catch {}
  }
}
export async function installAddon(retail, addon, progress) {
  const files = await verifyAddonFiles(addon, progress);
  return installVerified(retail, addon, files, progress);
}
