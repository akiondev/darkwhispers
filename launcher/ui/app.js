"use strict";

const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core.invoke;
let state = null;
let busy = false;
let pendingRemoval = null;

function message(text, kind = "") {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
  $("message").setAttribute("role", kind === "error" ? "alert" : "status");
}

function setBusy(value) {
  busy = value;
  $("choose-folder").disabled = value || !invoke;
  $("refresh").disabled = value || !invoke;
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
    version.textContent = item.installed ? `Installed ${item.installed_version}` : `Version ${item.addon.version}`;
    if (item.update_available) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${item.addon.version} available`;
      version.append(badge);
    }
    const actions = card.querySelector(".addon-actions");
    if (!item.installed || item.update_available) {
      const install = document.createElement("button");
      install.className = "button primary";
      install.dataset.operation = "install";
      install.textContent = item.installed ? "Update" : "Install";
      install.addEventListener("click", () => installAddon(item));
      actions.append(install);
    } else {
      const installed = document.createElement("span");
      installed.className = "installed";
      installed.textContent = "Up to date";
      actions.append(installed);
    }
    if (item.installed) {
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.dataset.operation = "remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        if (busy) return;
        pendingRemoval = item;
        $("remove-title").textContent = `Remove ${item.addon.title}?`;
        $("remove-dialog").returnValue = "cancel";
        $("remove-dialog").showModal();
      });
      actions.append(remove);
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
  catch (error) { message(String(error), "error"); }
  finally { setBusy(false); }
}

async function refresh() {
  await operation("Checking for updates…", async () => {
    const next = await invoke("get_status", {checkUpdates: true});
    render(next);
    message(next.warning || "Everything is ready.", next.warning ? "warning" : "");
  });
}

async function installAddon(item) {
  await operation(`${item.installed ? "Updating" : "Installing"} ${item.addon.title}…`, async () => {
    await invoke("install_addon", {id: item.addon.id});
    const next = await invoke("get_status", {checkUpdates: false});
    render(next);
    message(`${item.addon.title} ${item.installed ? "updated" : "installed"}. Restart WoW or reload your UI.`);
  });
}

$("refresh").addEventListener("click", refresh);
$("choose-folder").addEventListener("click", () => operation("Choose your WoW folder…", async () => {
  const chosen = await invoke("choose_game");
  if (chosen) {
    const next = await invoke("get_status", {checkUpdates: false});
    render(next);
    message(next.warning || "WoW Retail folder selected.", next.warning ? "warning" : "");
  } else {
    message("");
  }
}));
$("remove-dialog").addEventListener("close", () => {
  const item = pendingRemoval;
  pendingRemoval = null;
  if ($("remove-dialog").returnValue !== "remove" || !item) return;
  operation(`Removing ${item.addon.title}…`, async () => {
    await invoke("remove_addon", {id: item.addon.id});
    render(await invoke("get_status", {checkUpdates: false}));
    message(`${item.addon.title} removed. Your saved WoW settings are kept.`);
  });
});

if (invoke) {
  refresh();
} else {
  render({game_path: null, warning: null, addons: [{
    addon: {id: "DarkWhisperRaidTools", title: "DarkWhisper Raid Tools", description: "Your raid markers. Your north. A standalone compass with custom layouts.", version: "1.0.0"},
    installed: false, installed_version: null, update_available: false
  }]});
  message("Design preview. Open the desktop launcher to manage addons.");
}
