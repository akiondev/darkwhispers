"use strict";
const $ = id => document.getElementById(id);
const invoke = window.__TAURI__?.core.invoke;
let state = null, busy = false, pendingRemoval = null;
let launcherVersion = "0.3.4", availableLauncher = null, reportsLoaded = false, lastAddonCheck = 0;
function updateMotion() {
  document.documentElement.classList.toggle("motion-paused", document.hidden || !document.hasFocus());
}
document.addEventListener("visibilitychange", updateMotion);
window.addEventListener("focus", updateMotion); window.addEventListener("blur", updateMotion); updateMotion();
function message(text, kind = "") {
  $("message").textContent = text; $("message").className = "message " + kind;
  $("message").setAttribute("role", kind === "error" ? "alert" : "status");
}
function setBusy(value) {
  busy = value;
  for (const id of ["choose-folder","refresh","launcher-update","auto-update"]) $(id).disabled = value || !invoke;
  $("auto-update").disabled = value || !invoke || !state?.game_path;
  $("addons").setAttribute("aria-busy", String(value));
  document.querySelectorAll("[data-operation]").forEach(button => button.disabled = value || !state?.game_path || !invoke);
  document.querySelectorAll("[data-check-updates]").forEach(button => button.disabled = value || !invoke);
}
function statusMessage(next, fallback) {
  const warning = next.warning || (next.addons.some(item => item.issue) ? "An addon needs attention. See its details above." : "");
  message(warning || fallback, warning ? "warning" : "");
}
async function operation(text, task) {
  if (busy || !invoke) return;
  setBusy(true); message(text, "busy");
  try { await task(); }
  catch (error) {
    if (!state) {
      $("game-path").textContent = "Choose your WoW Retail folder.";
      $("addons").textContent = "Could not load your addons. Choose your folder or check again.";
    }
    message(String(error), "error");
  }
  finally { setBusy(false); }
}
function releaseDate(seconds, includeTime = false) {
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {day:"numeric",month:"short",year:"numeric", ...(includeTime ? {hour:"2-digit",minute:"2-digit"} : {})}).format(date);
}
function render(next) {
  state = next;
  const path = next.game_path?.replace(/^\\\\\?\\/, "") || "Choose your WoW Retail folder to get started.";
  $("game-path").textContent = path; $("game-path").title = path;
  $("auto-update").checked = !!next.auto_update;
  $("auto-detail").textContent = next.auto_update ? "On" : "Off";
  $("addons").replaceChildren();
  const columns = document.createElement("div"); columns.className = "addon-list-head"; columns.setAttribute("aria-hidden","true");
  for (const text of ["ADDON","INSTALLED","LATEST","ACTIONS"]) { const label = document.createElement("span"); label.textContent = text; columns.append(label); }
  $("addons").append(columns);
  const checked = releaseDate(next.catalog_checked_at, true);
  $("catalog-status").textContent = next.catalog_online ? "Last checked · " + (checked || "just now") : (checked ? "Cached release list · last checked " + checked : "Latest release not checked online yet");
  $("catalog-status").classList.toggle("cached", !next.catalog_online);
  $("nav-library").querySelector(".nav-count").textContent = next.addons.length;
  for (const item of next.addons) {
    const card = document.createElement("article"); card.className = "addon-row";
    card.innerHTML = '<div class="addon-row-main"><div class="addon-identity"><div class="addon-icon" aria-hidden="true"><img src="raid-tools.svg" alt=""></div><div class="addon-name"><h2></h2><p class="addon-state"></p><p class="addon-updated"></p></div></div><div class="version-col installed-version"></div><div class="version-col latest-version"></div><div class="addon-row-actions"></div></div><div class="addon-details" hidden><p class="release-heading"></p><p class="release-notes"></p><p class="addon-issue" hidden></p><div class="maintenance"></div></div>';
    card.querySelector("h2").textContent = item.addon.title;
    card.querySelector("h2").title = item.addon.description;
    const known = /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(item.installed_version || "");
    card.querySelector(".installed-version").textContent = item.installed ? (known ? item.installed_version : "Unknown") : "—";
    card.querySelector(".latest-version").textContent = item.addon.version;
    card.querySelector(".latest-version").title = next.catalog_online ? "Latest available addon version" : "Latest known addon version · check updates to confirm";
    const status = card.querySelector(".addon-state");
    status.textContent = item.issue ? "Needs attention" : item.update_available ? "Update available" : !item.installed ? "Not installed" : !known ? "Version unknown" : item.installed_version === item.addon.version ? (next.catalog_online ? "Up to date" : "Installed · check updates") : "Installed";
    card.classList.toggle("has-update",!!item.update_available); card.classList.toggle("needs-attention",!!item.issue);
    const released = releaseDate(item.addon.released_at);
    card.querySelector(".addon-updated").textContent = released ? "Updated " + released : "Release date unavailable";
    card.querySelector(".release-heading").textContent = "Latest update · " + item.addon.version + (released ? " · " + releaseDate(item.addon.released_at,true) : "");
    card.querySelector(".release-notes").textContent = item.addon.release_notes || "Check updates for the latest release information.";
    const details = card.querySelector(".addon-details");
    details.id = "details-" + item.addon.id;
    if (item.issue) { const detail = card.querySelector(".addon-issue"); detail.textContent = item.issue; detail.hidden = false; details.hidden = false; }
    const actions = card.querySelector(".addon-row-actions");
    if (!item.issue && (!item.installed || item.update_available)) {
      const install = document.createElement("button"); install.className = "button primary"; install.dataset.operation = "install";
      install.textContent = item.installed ? "Update" : "Install"; install.title = (item.installed ? "Update to " : "Install ") + item.addon.version;
      install.addEventListener("click", () => installAddon(item)); actions.append(install);
    }
    const check = document.createElement("button"); check.className = "row-check"; check.dataset.checkUpdates = "true"; check.type = "button"; check.textContent = "Check updates";
    check.setAttribute("aria-label","Check updates for " + item.addon.title); check.addEventListener("click",refresh); actions.append(check);
    const toggle = document.createElement("button"); toggle.className = "row-details"; toggle.type = "button"; toggle.textContent = "⌄"; toggle.setAttribute("aria-label","Release notes and options for " + item.addon.title); toggle.setAttribute("aria-controls",details.id); toggle.setAttribute("aria-expanded",String(!details.hidden));
    toggle.addEventListener("click",()=>{ details.hidden = !details.hidden; toggle.setAttribute("aria-expanded",String(!details.hidden)); }); actions.append(toggle);
    if (item.installed && !item.issue) {
      const maintenance = card.querySelector(".maintenance");
      const reinstall = document.createElement("button"); reinstall.className = "remove"; reinstall.dataset.operation = "reinstall"; reinstall.textContent = "Reinstall";
      reinstall.addEventListener("click", () => installAddon(item, true));
      const remove = document.createElement("button"); remove.className = "remove destructive"; remove.dataset.operation = "remove"; remove.textContent = "Remove";
      remove.addEventListener("click", () => { if (busy) return; pendingRemoval = item; $("remove-title").textContent = "Remove " + item.addon.title + "?"; $("remove-dialog").returnValue = "cancel"; $("remove-dialog").showModal(); });
      maintenance.append(reinstall,remove);
    }
    $("addons").append(card);
  }
  setBusy(busy);
}
async function refresh() {
  await operation("Checking signed releases…", async () => {
    lastAddonCheck = Date.now();
    const next = await invoke("get_status", {checkUpdates:true}); render(next);
    const count = next.addons.filter(item=>item.update_available).length;
    statusMessage(next, count ? count + (count === 1 ? " addon update available. Click Update to install it." : " addon updates available. Click Update to install them.") : next.game_path ? "Addon check complete. No updates available." : "Choose your WoW Retail folder to install addons.");
  });
}
function checkOnReturn() {
  if (invoke && state && !busy && !document.hidden && Date.now() - lastAddonCheck >= 60000) refresh();
}
window.addEventListener("focus",checkOnReturn);
document.addEventListener("visibilitychange",checkOnReturn);
async function installAddon(item, reinstall = false) {
  await operation((reinstall ? "Reinstalling " : item.installed ? "Updating " : "Installing ") + item.addon.title + "…", async () => {
    await invoke("install_addon",{id:item.addon.id});
    const next = await invoke("get_status",{checkUpdates:true}); render(next);
    statusMessage(next,item.addon.title + (reinstall ? " reinstalled." : item.installed ? " updated." : " installed.") + " Start WoW to load it.");
  });
}
$("refresh").addEventListener("click", refresh);
$("choose-folder").addEventListener("click", () => operation("Choose your WoW folder…", async () => {
  if (await invoke("choose_game")) {
    const next = await invoke("get_status",{checkUpdates:true}); render(next); statusMessage(next,"WoW Retail folder selected.");
  } else message("");
}));
$("remove-dialog").addEventListener("close", () => {
  const item = pendingRemoval; pendingRemoval = null;
  if ($("remove-dialog").returnValue !== "remove" || !item) return;
  operation("Removing " + item.addon.title + "…", async () => {
    await invoke("remove_addon",{id:item.addon.id}); render(await invoke("get_status",{checkUpdates:false}));
    message("Addon removed. Your saved WoW settings are kept.");
  });
});
$("auto-update").addEventListener("change", () => {
  const enabled = $("auto-update").checked;
  operation("Saving automatic update preference…", async () => {
    try { await invoke("set_auto_update",{enabled}); render(await invoke("get_status",{checkUpdates:false})); message(enabled ? "Automatic updates enabled. Only installed addons are updated, while WoW is closed." : "Automatic updates off. No background checks."); }
    catch (error) { $("auto-update").checked = !!state?.auto_update; throw error; }
  });
});
async function openResource(resource) {
  if (!invoke) return message("Open the desktop launcher to follow this link.");
  try { await invoke("open_resource",{resource}); }
  catch (error) { message(String(error),"error"); }
}
document.querySelectorAll("[data-resource]").forEach(button => button.addEventListener("click", () => openResource(button.dataset.resource)));
document.querySelectorAll("[data-window]").forEach(button => button.addEventListener("click", () => invoke?.("window_action",{action:button.dataset.window}).catch(error => message(String(error),"error"))));
$("window-drag").addEventListener("mousedown", event => { if (event.button === 0 && event.detail === 1) invoke?.("window_action",{action:"drag"}).catch(()=>{}); });
$("window-drag").addEventListener("dblclick", () => invoke?.("window_action",{action:"maximize"}).catch(()=>{}));
async function showView(name) {
  const library = name === "library";
  $("library-panel").hidden = !library; $("reports-panel").hidden = library;
  for (const key of ["library","reports"]) { $("nav-" + key).classList.toggle("active",key === name); if (key === name) $("nav-" + key).setAttribute("aria-current","page"); else $("nav-" + key).removeAttribute("aria-current"); }
  if (!library && !reportsLoaded) await loadReports();
}
$("nav-library").addEventListener("click", () => showView("library"));
$("nav-reports").addEventListener("click", () => showView("reports"));
async function loadReports() {
  if (!invoke) return;
  try {
    const checks = await invoke("get_release_checks");
    $("report-version").textContent = "Public release v" + checks.version;
    const findings = checks.static_analysis?.findings, audit = checks.dependencies;
    const cards = [
      ["defender","Microsoft Defender",checks.malware?.status === "passed" && checks.malware?.detections === 0 ? "0 detections · release packages" : "See full results",checks.malware?.status !== "passed"],
      ["clamav","ClamAV",checks.scanners?.clamav?.status === "passed" && checks.scanners?.clamav?.detections === 0 ? "0 detections · release packages" : "See full results",checks.scanners?.clamav?.status !== "passed"],
      ["semgrep","Semgrep",Number.isInteger(findings) ? findings + (findings === 1 ? " finding · source analysis" : " findings · source analysis") : "See source analysis",findings !== 0],
      ["rustsec","RustSec",Number.isInteger(audit?.vulnerabilities) ? audit.vulnerabilities + " vulnerabilities · " + audit.warnings + " notes" : "See dependency audit",audit?.vulnerabilities !== 0 || audit?.warnings > 0],
      ["codeql","CodeQL",Number.isInteger(checks.codeql?.findings) ? checks.codeql.findings + " findings · JavaScript & Python" : "See code analysis",checks.codeql?.findings !== 0],
      ["evidence","Signed provenance",checks.provenance?.immutable ? "Immutable GitHub release" : "See release evidence",!checks.provenance?.immutable]
    ];
    $("report-grid").replaceChildren();
    for (let index=0;index<cards.length;index++) {
      const [id,title,status,note] = cards[index], card = document.createElement("article"); card.className = "report-card" + (note ? " note" : "");
      const number = document.createElement("span"); number.className = "report-number"; number.textContent = "0" + (index+1) + " / RELEASE CHECK";
      const heading = document.createElement("h2"); heading.textContent = title;
      const detail = document.createElement("p"); detail.textContent = status;
      const button = document.createElement("button"); button.textContent = "Read report in browser ↗"; button.addEventListener("click",()=>openResource("report:" + id));
      card.append(number,heading,detail,button); $("report-grid").append(card);
    }
    reportsLoaded = true;
  } catch {
    $("report-grid").replaceChildren();
    const detail = document.createElement("p"); detail.className = "loading-card"; detail.textContent = "Live reports are unavailable. Read the original build and scan reports on GitHub.";
    const retry = document.createElement("button"); retry.className = "button quiet"; retry.textContent = "Retry reports"; retry.addEventListener("click",loadReports);
    $("report-grid").append(detail,retry);
  }
}
async function checkLauncher() {
  const info = await invoke("check_launcher_update"); launcherVersion = info.current; availableLauncher = info.available;
  $("launcher-version").textContent = "v" + info.current; $("launcher-update").hidden = !info.supported;
  $("launcher-update").textContent = info.available ? "Update launcher · " + info.available : "Check launcher updates";
  $("launcher-update").classList.toggle("update-ready",!!info.available); return info;
}
$("launcher-update").addEventListener("click", () => operation(availableLauncher ? "Downloading signed launcher update…" : "Checking launcher updates…",async () => {
  if (availableLauncher) await invoke("install_launcher_update");
  else { const info = await checkLauncher(); message(info.available ? "A new launcher is ready. Click Update launcher to install and restart." : "Your launcher is up to date."); }
}));
$("copy-status").addEventListener("click",async () => {
  const lines = ["DarkWhispers Addons " + launcherVersion,"WoW folder selected: " + !!state?.game_path,"Automatic updates: " + !!state?.auto_update,"Catalog checked online: " + !!state?.catalog_online,"Last check: " + (releaseDate(state?.catalog_checked_at,true) || "not checked")];
  for (const item of state?.addons || []) lines.push(item.addon.id + ": " + (item.installed_version || "not installed") + "; available " + item.addon.version + "; issue " + !!item.issue);
  try { await navigator.clipboard.writeText(lines.join("\n")); message("Status copied. No personal paths or WoW saved settings included."); }
  catch { message("Could not copy status. Launcher version: " + launcherVersion + ".","warning"); }
});
if (invoke) {
  refresh().then(()=>checkLauncher().catch(()=>{$("launcher-update").title = "Update check unavailable. Click to retry.";}));
  window.__TAURI__.event?.listen("launcher-download",({payload})=>{if(busy)message(payload.total ? "Downloading launcher… " + Math.min(100,Math.round(payload.downloaded/payload.total*100)) + "%" : "Downloading launcher…","busy");});
  window.__TAURI__.event?.listen("launcher-installing",()=>message("Signature verified. Installing launcher update and restarting…","busy"));
  window.__TAURI__.event?.listen("addon-auto-update",async ({payload})=>{
    if (busy) return;
    try { render(await invoke("get_status",{checkUpdates:false})); message(String(payload)); } catch {}
  });
} else {
  render({game_path:null,auto_update:false,warning:null,catalog_online:false,catalog_checked_at:null,addons:[{addon:{id:"DarkWhisperRaidTools",title:"DarkWhispers Raid Tool",description:"Your raid markers. Your north. A standalone compass with custom layouts.",version:"1.0.2",released_at:1792525213},installed:false,installed_version:null,update_available:false}]});
  message("Design preview. Open the desktop launcher to manage addons.");
}
