// Browser-only QA adapter. This directory is outside Tauri's frontendDist.
// It performs no downloads and no filesystem operations.
let installed = false;
let autoUpdate = false;
let availableUpdate = false;
let selectedFolder = null;
let failNext = false;
let folderIssue = false;
let unknownVersion = false;
const addon = {
  id: "DarkWhisperRaidTools", title: "DarkWhispers Raid Tool",
  description: "Your raid markers. Your north. A standalone compass with custom layouts.",
  version: "1.0.2"
};
window.__TAURI__ = {core: {invoke: async (command, args = {}) => {
  await new Promise(resolve => setTimeout(resolve, 150));
  if (failNext) { failNext = false; throw "Test download failed. Nothing was installed."; }
  if (command === "check_launcher_update") return {current:"0.3.1",available:null,supported:true};
  if (command === "set_auto_update") { autoUpdate = args.enabled; return; }
  if (command === "window_action" || command === "open_resource") return;
  if (command === "get_release_checks") return (await fetch("/build/release-checks.json")).json();
  if (command === "get_status") return {
    game_path: selectedFolder, warning: null, auto_update: autoUpdate,
    addons: [{addon, installed: folderIssue ? false : installed, installed_version: installed ? (unknownVersion ? "Unknown" : availableUpdate ? "0.9.0" : "1.0.2") : null, update_available: availableUpdate,
      issue: folderIssue ? "DarkWhisperRaidTools already exists but is not a recognized addon. It was not changed." : null}]
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
    ["QA: unknown version", () => { installed = true; unknownVersion = true; folderIssue = false; availableUpdate = false; document.getElementById("refresh").click(); }],
    ["QA: folder conflict", () => { folderIssue = true; document.getElementById("refresh").click(); }],
  ]) {
    const button = document.createElement("button");
    button.textContent = text;
    button.onclick = action;
    controls.append(button);
  }
  document.body.append(controls);
});
