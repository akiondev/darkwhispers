import {loadCatalog, resolveRetail, installAddon, fetchBytes} from "/browser-install.a9433300899c3ec7.mjs";

const $ = (id) => document.getElementById(id);
const icons = {
  windows:'<svg viewBox="0 0 24 24"><path d="M2 4.6 10.5 3.4v8H2zm10-1.4L22 1.8v9.6H12zM2 12.8h8.5v8L2 19.6zm10 0h10v9.5l-10-1.4z"/></svg>',
  linux:'<svg viewBox="0 0 24 24"><path d="m7 5 6 7-6 7-1.6-1.4L10.2 12 5.4 6.4L7 5Zm6 13h8v2h-8z"/></svg>',
  unknown:'<svg viewBox="0 0 24 24"><path d="M3 3h18v13H3zm7 15h4v2h5v2H5v-2h5z"/></svg>'
};
const names = {windows:"Windows",linux:"Linux",unknown:"Choose a platform"};
function detectedPlatform() {
  const agent = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1)) return "unknown";
  const platform = navigator.userAgentData?.platform || navigator.platform || agent;
  if (/Win/i.test(platform)) return "windows";
  if (/Mac/i.test(platform)) return "unknown";
  if (/Linux/i.test(platform)) return "linux";
  return "unknown";
}
let selectedPlatform = detectedPlatform();
let release = null, catalog = null, retail = null, installing = false;
const directSupported = typeof window.showDirectoryPicker === "function" && !!crypto.subtle;

function selectPlatform(platform) {
  selectedPlatform = platform;
  $("platforms").open = false;
  const item = release?.platforms?.[platform];
  const main = $("launcher-download");
  $("platform-icon").innerHTML = icons[platform] || icons.unknown;
  $("download-title").textContent = platform === "unknown" ? "Choose your platform" : "Download Launcher for " + names[platform];
  $("download-detail").textContent = item?.label || (release ? "Windows and Linux · choose a platform" : "Loading the latest release…");
  main.removeAttribute("href");
  main.classList.add("unavailable");
  main.setAttribute("aria-disabled", "true");
  if (item) {
    const url = new URL(item.url, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/launcher/downloads/") && /^[a-f0-9]{64}$/i.test(item.sha256)) {
      main.href = url.href;
      main.setAttribute("download", "");
      main.classList.remove("unavailable");
      main.removeAttribute("aria-disabled");
    }
  }
}
document.querySelectorAll("[data-platform]").forEach((button) => button.addEventListener("click", () => selectPlatform(button.dataset.platform)));
$("launcher-download").addEventListener("click", (event) => {
  if (!$("launcher-download").hasAttribute("href")) { event.preventDefault(); $("platforms").open = true; }
});
document.addEventListener("click", (event) => {
  if (!$("platforms").contains(event.target)) $("platforms").open = false;
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") $("platforms").open = false; });
for (const kind of ["addons"]) $("open-" + kind).addEventListener("click", () => $(kind + "-dialog").showModal());
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.close === "addons-dialog" && installing) return;
  $(button.dataset.close).close();
}));
$("addons-dialog").addEventListener("cancel", (event) => { if (installing) event.preventDefault(); });

function installStatus(text, error = false) {
  $("install-status").textContent = text;
  $("install-status").classList.toggle("error", error);
  $("install-status").setAttribute("role", error ? "alert" : "status");
}
function setInstalling(value) {
  installing = value;
  $("choose-wow").disabled = value || !directSupported;
  $("addons-dialog").querySelector("[data-close]").disabled = value;
  document.querySelectorAll("[data-install]").forEach((button) => button.disabled = value || !retail || !directSupported);
}
function renderAddons() {
  $("addon-list").replaceChildren();
  for (const addon of catalog.addons) {
    const row = document.createElement("article");
    row.className = "addon-row";
    const title = document.createElement("h3");
    title.textContent = addon.title;
    const version = document.createElement("p");
    version.className = "version";
    version.textContent = "Version " + addon.version + " · WoW Retail";
    const buttons = document.createElement("div");
    buttons.className = "addon-buttons";
    const install = document.createElement("button");
    install.type = "button";
    install.className = "button";
    install.dataset.install = addon.id;
    install.textContent = "Install to WoW";
    install.addEventListener("click", () => runInstall(addon));
    const zip = document.createElement("a");
    zip.className = "button github-inline";
    zip.textContent = "Manual ZIP Download";
    zip.href = new URL(addon.download_url).pathname;
    zip.setAttribute("download","");
    buttons.append(install, zip);
    const identity = document.createElement("div"); identity.className = "addon-title";
    const mark = document.createElement("img"); mark.src = "/assets/raid-tools.svg"; mark.alt = ""; mark.width = 36; mark.height = 36;
    identity.append(mark,title); row.append(identity, version, buttons);
    $("addon-list").append(row);
  }
  setInstalling(false);
}
function renderZipDownload() {
  const addon = catalog.addons.find(item=>item.id === "DarkWhisperRaidTools");
  if (!addon) return;
  $("addon-zip").href = new URL(addon.download_url).pathname;
  $("zip-detail").textContent = addon.title + " · v" + addon.version;
}
$("choose-wow").disabled = !directSupported;
if (!directSupported) $("browser-support").textContent = "Direct installation needs desktop Chrome or Edge with folder-write support. Use Manual ZIP Download in this browser.";
$("choose-wow").addEventListener("click", async () => {
  if (installing) return;
  setInstalling(true);
  try {
    // The picker must be called immediately from the click, before any network wait.
    const selected = await window.showDirectoryPicker({id:"darkwhispers-wow",mode:"readwrite"});
    retail = await resolveRetail(selected);
    $("folder-name").textContent = (selected.name === "_retail_" ? "" : selected.name + "/") + "_retail_/Interface/AddOns";
    installStatus("Folder selected. Ready to install.");
  } catch (error) {
    installStatus((error.name === "AbortError" ? "Folder selection cancelled." : error.message) + (retail ? " Your previous folder is still selected." : ""), error.name !== "AbortError");
  } finally { setInstalling(false); }
});
async function runInstall(addon) {
  if (installing || !retail) return;
  setInstalling(true);
  installStatus("Checking the signed release…");
  const install = async () => {
    // Refresh the signature and metadata for this action, rather than using an old tab.
    const latest = await loadCatalog();
    const current = latest.addons.find((item) => item.id === addon.id);
    if (!current) throw new Error("This addon is no longer in the verified catalog.");
    return installAddon(retail, current, installStatus);
  };
  try {
    let result;
    if (navigator.locks) {
      result = await navigator.locks.request("darkwhispers-addon-install", {ifAvailable:true}, async (lock) => {
        if (!lock) throw new Error("Another DarkWhispers tab is installing an addon.");
        return install();
      });
    } else { result = await install(); }
    installStatus("Installed " + addon.title + " " + result.version + ". Start WoW or reload its UI.");
  } catch (error) {
    installStatus(error.name === "NotAllowedError" ? "Folder access was denied. Re-select your folder or use the launcher." : error.message, true);
  } finally { setInstalling(false); }
}
async function loadChangelog() {
  try {
    const feed = JSON.parse(new TextDecoder().decode(await fetchBytes("/changelog.json",65536)));
    if (!Array.isArray(feed.entries)) throw new Error("Invalid changelog");
    const host = $("changelog-feed"); host.replaceChildren();
    for (const entry of feed.entries.slice(0,3)) {
      const article = document.createElement("article"); article.className = "changelog-entry";
      const stamp = document.createElement("p"); stamp.className = "change-stamp"; stamp.textContent = "v" + entry.version + " · " + entry.date;
      const title = document.createElement("h3"); title.textContent = entry.title;
      const list = document.createElement("ul");
      for (const value of (entry.changes || []).slice(0,5)) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
      article.append(stamp,title,list); host.append(article);
    }
  } catch { $("changelog-feed").textContent = "Read the latest changes in GitHub Releases."; }
}
async function initialize() {
  selectPlatform(selectedPlatform);
  await Promise.allSettled([
    loadChangelog(),
    (async () => {
      release = JSON.parse(new TextDecoder().decode(await fetchBytes("/launcher/releases.json", 65536)));
      for (const button of document.querySelectorAll("[data-platform]")) button.querySelector(".availability").textContent = release.platforms?.[button.dataset.platform] ? "Available" : "Coming soon";
      selectPlatform(selectedPlatform);
    })().catch(() => { $("download-detail").textContent = "Downloads unavailable. Please reload."; }),
    (async () => {
      catalog = await loadCatalog(); renderAddons(); renderZipDownload();
    })().catch((error) => { $("addon-list").textContent = error.message; installStatus("The addon catalog could not be verified.", true); })
  ]);
}

// Small 2D particles: capped resolution, 24 fps, no work while the page is hidden.
function startWinter() {
  const canvas = $("snow"), context = canvas.getContext("2d", {alpha:true});
  if (!context) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0, height = 0, frame = 0, last = 0;
  const particles = Array.from({length:72}, () => ({x:Math.random(),y:Math.random(),r:Math.random()*1.4+.35,v:Math.random()*.014+.008,a:Math.random()*.55+.15,phase:Math.random()*6.28}));
  function resize() {
    width = innerWidth; height = innerHeight;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); context.setTransform(scale,0,0,scale,0,0);
    if (reduced.matches) draw(performance.now(), 0);
  }
  function draw(time, delta) {
    context.clearRect(0,0,width,height);
    const count = width < 600 ? 38 : particles.length;
    for (const p of particles.slice(0,count)) {
      p.y = (p.y + p.v * delta) % 1;
      const x = (p.x + Math.sin(time*.00012+p.phase)*.032) * width, y = p.y * height;
      context.fillStyle = "rgba(235,126,146," + p.a + ")";
      context.beginPath(); context.arc(x,y,p.r,0,Math.PI*2); context.fill();
      if (p.r > 1.5) {
        context.strokeStyle = "rgba(210,66,96," + p.a*.45 + ")"; context.lineWidth = .6;
        context.beginPath(); context.moveTo(x-3,y); context.lineTo(x+3,y); context.moveTo(x,y-3); context.lineTo(x,y+3); context.stroke();
      }
    }
  }
  function tick(time) {
    frame = requestAnimationFrame(tick);
    if (time - last < 1000/24) return;
    const delta = last ? Math.min((time-last)/1000,.1) : 0;
    last = time; draw(time,delta);
  }
  function resume() {
    cancelAnimationFrame(frame); last = 0;
    if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    else if (reduced.matches) draw(performance.now(),0);
  }
  addEventListener("resize",resize,{passive:true}); document.addEventListener("visibilitychange",resume); reduced.addEventListener("change",resume);
  resize(); resume();
}
startWinter();
initialize();
