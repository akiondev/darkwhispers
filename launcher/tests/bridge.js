// Browser-only QA adapter. This directory is outside Tauri's frontendDist.
// It performs no downloads and no filesystem operations.
let installed = false;
let availableUpdate = false;
let selectedFolder = null;
let failNext = false;
const addon = {
  id: "DarkWhisperRaidTools", title: "DarkWhisper Raid Tools",
  description: "Your raid markers. Your north. A standalone compass with custom layouts.",
  version: "1.0.0"
};
window.__TAURI__ = {core: {invoke: async (command) => {
  await new Promise(resolve => setTimeout(resolve, 150));
  if (failNext) { failNext = false; throw "Test download failed. Nothing was installed."; }
  if (command === "get_status") return {
    game_path: selectedFolder, warning: null,
    addons: [{addon, installed, installed_version: installed ? (availableUpdate ? "0.9.0" : "1.0.0") : null, update_available: availableUpdate}]
  };
  if (command === "choose_game") { selectedFolder = "C:\\Games\\World of Warcraft\\_retail_"; return true; }
  if (command === "install_addon") { installed = true; availableUpdate = false; return; }
  if (command === "remove_addon") { installed = false; return; }
  throw `Unexpected command: ${command}`;
}}};
document.addEventListener("DOMContentLoaded", () => {
  const controls = document.createElement("aside");
  controls.style.cssText = "padding:10px;display:flex;gap:10px;border-top:1px solid #444";
  for (const [text, action] of [
    ["QA: update available", () => { installed = true; availableUpdate = true; document.getElementById("refresh").click(); }],
    ["QA: fail next operation", () => { failNext = true; }],
  ]) {
    const button = document.createElement("button");
    button.textContent = text;
    button.onclick = action;
    controls.append(button);
  }
  document.body.append(controls);
});
