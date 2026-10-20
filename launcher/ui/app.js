"use strict";

const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core.invoke;
let state = null;
let busy = false;
let pendingRemoval = null;
let launcherVersion = "0.2.0";
let availableLauncher = null;

function confirmAddon(item, kind) {
  if (busy) return;
  pendingRemoval = {item, kind};
  $("remove-title").textContent = kind === "restore" ? `Restore ${item.addon.title}?` : `Remove ${item.addon.title}?`;
  $("remove-description").textContent = kind === "restore" ? "Replace the current addon with its most recent backup. Your current version is backed up and saved WoW settings are kept." : "Your saved WoW settings are kept. You can install the addon again anytime.";
  $("confirm-remove").textContent = kind === "restore" ? "Restore" : "Remove";
  $("remove-dialog").returnValue = "cancel";
  $("remove-dialog").showModal();
}

function message(text, kind = "") {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
  $("message").setAttribute("role", kind === "error" ? "alert" : "status");
}

function statusMessage(next, fallback) {
  const warning = next.warning || (next.addons.some(item => item.issue) ? "An addon needs attention. See its details below." : "");
  message(warning || fallback, warning ? "warning" : "");
}

function setBusy(value) {
  busy = value;
  $("choose-folder").disabled = value || !invoke;
  $("refresh").disabled = value || !invoke;
  $("launcher-update").disabled = value || !invoke;
  $("addons").setAttribute("aria-busy", String(value));
  document.querySelectorAll("[data-operation]").forEach((button) => {
    button.disabled = value || !state?.game_path || !invoke;
  });
}

function render(next) {
  state = next;
  const path = next.game_path?.replace(/^\\\\\?\\/, "") || "Choose your World of Warcraft folder to get started.";
  $("game-path").textContent = path;
  $("game-path").title = path;
  $("addons").replaceChildren();
  for (const item of next.addons) {
    const card = document.createElement("article");
    card.className = "addon-card";
    // Only static markup is inserted as HTML. Catalog text is always textContent.
    card.innerHTML = `<div class="addon-art" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17"/><path d="m24 7 5 17-5 17-5-17zM7 24h9m16 0h9M24 2v3m0 38v3M2 24h3m38 0h3"/><circle cx="24" cy="24" r="3"/></svg></div><div class="addon-info"><h2></h2><p class="description"></p><div class="version"></div></div><div class="addon-actions"></div>`;
    card.querySelector("h2").textContent = item.addon.title;
    card.querySelector(".description").textContent = item.addon.description;
    const version = card.querySelector(".version");
    const knownVersion = /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(item.installed_version || "");
    version.textContent = item.issue ? "Needs attention" : item.installed ? (knownVersion ? `Installed ${item.installed_version}` : "Installed · version unknown") : `Version ${item.addon.version}`;
    if (item.issue) {
      const detail = document.createElement("p");
      detail.className = "addon-issue";
      detail.textContent = item.issue;
      card.querySelector(".addon-info").append(detail);
      card.classList.add("needs-attention");
    }
    if (item.update_available) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${item.addon.version} available`;
      version.append(badge);
    }
    const actions = card.querySelector(".addon-actions");
    if (!item.issue && (!item.installed || item.update_available)) {
      const install = document.createElement("button");
      install.className = "button primary";
      install.dataset.operation = "install";
      install.textContent = item.installed ? "Update" : "Install";
      install.addEventListener("click", () => installAddon(item));
      actions.append(install);
    } else if (!item.issue) {
      const installed = document.createElement("span");
      installed.className = "installed";
      installed.textContent = knownVersion ? (item.installed_version === item.addon.version ? "Up to date" : "Installed") : "Version unavailable";
      if (!knownVersion) installed.classList.add("unknown-version");
      actions.append(installed);
    }
    if (item.installed && !item.issue) {
      const repair = document.createElement("button");
      repair.className = "remove"; repair.dataset.operation = "repair";
      repair.textContent = "Repair";
      repair.addEventListener("click", () => installAddon(item, true));
      actions.append(repair);
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.dataset.operation = "remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => confirmAddon(item, "remove"));
      actions.append(remove);
    }
    if (item.can_restore && !item.issue) {
      const restore = document.createElement("button");
      restore.className = "remove"; restore.dataset.operation = "restore";
      restore.textContent = "Restore previous";
      restore.addEventListener("click", () => confirmAddon(item, "restore"));
      actions.append(restore);
    }
    $("addons").append(card);
  }
  setBusy(busy);
}

async function operation(text, task) {
  if (busy || !invoke) return;
  setBusy(true);
  message(text, "busy");
  try { await task(); }
  catch (error) {
    if (!state) {
      $("game-path").textContent = "Choose your WoW Retail folder.";
      $("addons").replaceChildren();
      const empty = document.createElement("p");
      empty.className = "loading-card";
      empty.textContent = "Could not load your addons. Choose your folder or try checking again.";
      $("addons").append(empty);
    }
    message(String(error), "error");
  }
  finally { setBusy(false); }
}

async function refresh() {
  await operation("Checking for updates…", async () => {
    const next = await invoke("get_status", {checkUpdates: true});
    render(next);
    statusMessage(next, "Everything is ready.");
  });
}

async function installAddon(item, repair = false) {
  await operation(`${repair ? "Repairing" : item.installed ? "Updating" : "Installing"} ${item.addon.title}…`, async () => {
    await invoke("install_addon", {id: item.addon.id});
    const next = await invoke("get_status", {checkUpdates: false});
    render(next);
    message(`${item.addon.title} ${repair ? "repaired" : item.installed ? "updated" : "installed"}. Start WoW to load the addon.`);
  });
}

$("refresh").addEventListener("click", refresh);
$("choose-folder").addEventListener("click", () => operation("Choose your WoW folder…", async () => {
  const chosen = await invoke("choose_game");
  if (chosen) {
    const next = await invoke("get_status", {checkUpdates: false});
    render(next);
    statusMessage(next, "WoW Retail folder selected.");
  } else {
    message("");
  }
}));
$("remove-dialog").addEventListener("close", () => {
  const pending = pendingRemoval;
  pendingRemoval = null;
  if ($("remove-dialog").returnValue !== "remove" || !pending) return;
  const {item, kind} = pending;
  operation(`${kind === "restore" ? "Restoring" : "Removing"} ${item.addon.title}…`, async () => {
    await invoke(kind === "restore" ? "restore_addon" : "remove_addon", {id: item.addon.id});
    render(await invoke("get_status", {checkUpdates: false}));
    message(`${item.addon.title} ${kind === "restore" ? "restored from backup" : "removed"}. Your saved WoW settings are kept.`);
  });
});

async function checkLauncher() {
  const info = await invoke("check_launcher_update");
  launcherVersion = info.current;
  availableLauncher = info.available;
  $("launcher-version").textContent = "v" + info.current;
  $("launcher-update").hidden = !info.supported;
  $("launcher-update").textContent = info.available ? "Update launcher · " + info.available : "Check launcher";
  $("launcher-update").classList.toggle("update-ready", !!info.available);
  return info;
}
$("launcher-update").addEventListener("click", () => operation(availableLauncher ? "Downloading signed launcher update…" : "Checking launcher updates…", async () => {
  if (availableLauncher) await invoke("install_launcher_update");
  else { const info = await checkLauncher(); message(info.available ? "A new launcher is ready. Click Update launcher to install and restart." : "Your launcher is up to date."); }
}));
$("copy-status").addEventListener("click", async () => {
  const lines = ["DarkWhispers Addons " + launcherVersion, "WoW folder selected: " + !!state?.game_path];
  for (const item of state?.addons || []) lines.push(item.addon.id + ": " + (item.installed_version || "not installed") + "; available " + item.addon.version + "; issue " + !!item.issue);
  try { await navigator.clipboard.writeText(lines.join("\n")); message("Status copied. No personal paths or WoW saved settings included."); }
  catch { message("Could not copy status. Your launcher version is " + launcherVersion + ".", "warning"); }
});

if (invoke) {
  refresh().then(() => checkLauncher().catch(() => { $("launcher-update").title = "Update check unavailable. Click to retry."; }));
  window.__TAURI__.event?.listen("launcher-download", ({payload}) => {
    if (busy) message(payload.total ? "Downloading launcher… " + Math.min(100, Math.round(payload.downloaded / payload.total * 100)) + "%" : "Downloading launcher…", "busy");
  });
  window.__TAURI__.event?.listen("launcher-installing", () => message("Signature verified. Installing launcher update and restarting…", "busy"));
} else {
  render({game_path: null, warning: null, addons: [{
    addon: {id: "DarkWhisperRaidTools", title: "DarkWhisper Raid Tools", description: "Your raid markers. Your north. A standalone compass with custom layouts.", version: "1.0.0"},
    installed: false, installed_version: null, update_available: false
  }]});
  message("Design preview. Open the desktop launcher to manage addons.");
}
