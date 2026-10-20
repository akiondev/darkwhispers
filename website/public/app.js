import {loadCatalog, resolveRetail, installAddon, fetchBytes} from "/browser-install.9716a08aff6af6e1.mjs";

const $ = (id) => document.getElementById(id);
const icons = {
  windows:'<svg viewBox="0 0 24 24"><path d="M2 4.6 10.5 3.4v8H2zm10-1.4L22 1.8v9.6H12zM2 12.8h8.5v8L2 19.6zm10 0h10v9.5l-10-1.4z"/></svg>',
  macos:'<svg viewBox="0 0 24 24"><path d="M16.6 2c.1 1.3-.5 2.6-1.2 3.5-.8.9-2 1.5-3.1 1.4-.2-1.2.5-2.6 1.2-3.4.8-.9 2.1-1.5 3.1-1.5ZM20 17.2c-.5 1.2-.8 1.7-1.5 2.7-1 1.4-2.3 3.1-3.9 3.1-1.4 0-1.8-.9-3.7-.9s-2.4.9-3.8.9c-1.5 0-2.7-1.5-3.7-2.9C.7 16.3 1 10.7 4.8 8.6c2.7-1.4 4.2-.3 6 .2 1.5.4 3.9-1.7 6.2-.7 1 .4 1.8 1 2.5 1.8-2.8 1.6-2.6 5.6.5 7.3Z"/></svg>',
  linux:'<svg viewBox="0 0 24 24"><path d="m7 5 6 7-6 7-1.6-1.4L10.2 12 5.4 6.4L7 5Zm6 13h8v2h-8z"/></svg>',
  unknown:'<svg viewBox="0 0 24 24"><path d="M3 3h18v13H3zm7 15h4v2h5v2H5v-2h5z"/></svg>'
};
const names = {windows:"Windows",macos:"macOS",linux:"Linux",unknown:"Choose a platform"};
function detectedPlatform() {
  const agent = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1)) return "unknown";
  const platform = navigator.userAgentData?.platform || navigator.platform || agent;
  if (/Win/i.test(platform)) return "windows";
  if (/Mac/i.test(platform)) return "macos";
  if (/Linux/i.test(platform)) return "linux";
  return "unknown";
}
let selectedPlatform = detectedPlatform();
let release = null, catalog = null, checks = null, retail = null, installing = false;
const directSupported = typeof window.showDirectoryPicker === "function" && !!crypto.subtle;

function selectPlatform(platform) {
  selectedPlatform = platform;
  $("platforms").open = false;
  const item = release?.platforms?.[platform];
  const main = $("launcher-download");
  $("platform-icon").innerHTML = icons[platform] || icons.unknown;
  $("download-title").textContent = platform === "unknown" ? "Choose your platform" : "Download for " + names[platform];
  $("download-detail").textContent = item?.label || (release ? "Coming soon · select another platform" : "Loading the latest release…");
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
  renderSecurity();
}
document.querySelectorAll("[data-platform]").forEach((button) => button.addEventListener("click", () => selectPlatform(button.dataset.platform)));
$("launcher-download").addEventListener("click", (event) => {
  if (!$("launcher-download").hasAttribute("href")) { event.preventDefault(); $("platforms").open = true; }
});
document.addEventListener("click", (event) => {
  if (!$("platforms").contains(event.target)) $("platforms").open = false;
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") $("platforms").open = false; });
for (const kind of ["addons","security"]) $("open-" + kind).addEventListener("click", () => $(kind + "-dialog").showModal());
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
    zip.className = "text-link";
    zip.textContent = "Download ZIP ↓";
    zip.href = new URL(addon.download_url).pathname;
    zip.setAttribute("download", "");
    buttons.append(install, zip);
    row.append(title, version, buttons);
    $("addon-list").append(row);
  }
  setInstalling(false);
}
$("choose-wow").disabled = !directSupported;
if (!directSupported) $("browser-support").textContent = "Direct installation needs desktop Chrome or Edge with folder-write support. Download the ZIP in this browser.";
$("choose-wow").addEventListener("click", async () => {
  if (installing) return;
  try {
    // The picker must be called immediately from the click, before any network wait.
    const selected = await window.showDirectoryPicker({id:"darkwhispers-wow",mode:"readwrite"});
    retail = await resolveRetail(selected);
    $("folder-name").textContent = (selected.name === "_retail_" ? "" : selected.name + "/") + "_retail_/Interface/AddOns";
    installStatus("Folder selected. Ready to install.");
    setInstalling(false);
  } catch (error) {
    retail = null;
    $("folder-name").textContent = "No folder selected";
    setInstalling(false);
    installStatus(error.name === "AbortError" ? "Folder selection was cancelled or blocked by the browser." : error.message, error.name !== "AbortError");
  }
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
    installStatus("Installed " + addon.title + " " + result.version + ". Start WoW or reload its UI." + (result.backupPath ? " Backup: " + result.backupPath : ""));
  } catch (error) {
    installStatus(error.name === "NotAllowedError" ? "Folder access was denied. Re-select your folder or use the launcher." : error.message, true);
  } finally { setInstalling(false); }
}
function checkRow(title, status, text, passed) {
  const row = document.createElement("section");
  row.className = "check-row";
  const heading = document.createElement("strong");
  heading.append(document.createTextNode(title));
  const tag = document.createElement("span");
  tag.className = "check-tag" + (passed ? "" : " pending");
  tag.textContent = status;
  heading.append(tag);
  const detail = document.createElement("p");
  detail.textContent = text;
  row.append(heading, detail);
  return row;
}
function evidenceCard(title, result, reportUrl, passed) {
  const card = document.createElement("div");
  card.className = "evidence-item" + (passed ? "" : " pending");
  const name = document.createElement("strong"); name.textContent = title;
  const status = document.createElement("p"); status.textContent = result;
  const link = document.createElement("a");
  link.textContent = "Full report ↗"; link.href = reportUrl; link.target = "_blank"; link.rel = "noopener";
  card.append(name, status, link);
  return card;
}
function renderSecurity() {
  if (!checks || !release) return;
  const rows = $("security-details");
  rows.replaceChildren();
  const reportMatches = checks.version === release.version;
  const provenance = reportMatches && checks.provenance?.repository === "akiondev/darkwhispers" ? checks.provenance : null;
  const publicRun = provenance && /^https:\/\/github\.com\/akiondev\/darkwhispers\/actions\/runs\/[0-9]+$/.test(provenance.run_url);
  const reportLink = (name, fallback) => {
    const url = provenance?.report_links?.[name];
    const prefix = "https://github.com/akiondev/darkwhispers/releases/download/v" + release.version + "/";
    return publicRun && typeof url === "string" && url.startsWith(prefix) && !url.slice(prefix.length).includes("/") ? url : fallback;
  };
  $("public-build").href = publicRun ? provenance.run_url : "https://github.com/akiondev/darkwhispers/actions";
  $("public-build").textContent = publicRun ? "View this release's public build & scans ↗" : "View public builds & scans on GitHub ↗";
  $("release-report").href = reportLink("evidence","/security/release-checks.json");
  $("provenance-note").textContent = publicRun ? "Built from " + provenance.commit.slice(0,12) + ". Verify signed files and original reports on GitHub." : "These existing scans were run by the maintainer. A public GitHub release build is pending.";
  const required = Object.values(release.platforms).map((item) => item.sha256).concat(catalog ? catalog.addons.map((item)=>item.sha256) : []);
  const artifacts = checks.artifacts || [];
  const scanPassed = reportMatches && required.length > 0 && required.every((hash) => artifacts.some((file) => file.sha256 === hash && file.scan?.status === "passed"));
  const scanner = checks.malware?.engine || "Not available";
  rows.append(checkRow("Malware scans", scanPassed ? "Passed" : "Pending", scanner + (scanPassed ? " · no detections in the listed release files." : " · no matching completed scan for every release file."), scanPassed));
  const review = reportMatches ? checks.source_review : null;
  rows.append(checkRow("Source review", review?.status === "completed" ? "Completed" : "Pending", review?.summary || "Source review has not been published.", review?.status === "completed"));
  if (review?.report_url === "/security/source-review.md") {
    const link = document.createElement("a"); link.href = review.report_url; link.target = "_blank"; link.rel = "noopener"; link.className = "text-link"; link.textContent = "Read the source review ↗"; rows.append(link);
  }
  const audit = reportMatches ? checks.dependencies : null;
  const noVulnerabilities = ["passed","completed_with_notes"].includes(audit?.status) && audit.vulnerabilities === 0;
  rows.append(checkRow("Dependency audit", noVulnerabilities ? (audit.warnings ? audit.warnings + " advisory notes" : "Passed") : "See report", audit?.summary || "No matching dependency audit has been published.", noVulnerabilities && !audit.warnings));
  const clam = reportMatches ? checks.scanners?.clamav : null;
  const clamPassed = clam?.status === "passed" && required.length > 0 && required.every((hash) => clam.artifacts?.some((file) => file.sha256 === hash && file.status === "passed"));
  const analysis = reportMatches ? checks.static_analysis : null;
  const analysisDone = analysis?.status === "completed" && analysis.errors === 0;
  rows.append(checkRow("ClamAV antivirus", clamPassed ? "0 detections" : "Pending", clamPassed ? clam.engine + " · " + clam.signatures + " signatures. Full archive scanning; see the exact file hashes and log." : "No matching completed ClamAV scan for every release file.", clamPassed));
  rows.append(checkRow("Semgrep Community Edition", analysisDone ? analysis.findings + (analysis.findings === 1 ? " finding" : " findings") : "See report", analysis?.summary || "No automated source scan has been published.", analysisDone && analysis.findings === 0));
  rows.append(checkRow("Addon integrity", "Verified on install", "Ed25519 catalog signature and SHA-256 checks for every file before it is written.", true));
  const meta = document.createElement("p");
  meta.className = "report-meta";
  meta.textContent = "Checked: " + (checks.checked_at || "Not recorded") + ". Windows beta installers are unsigned. Source review is not an independent security certification.";
  rows.append(meta);
  const hashes = document.createElement("details");
  const summary = document.createElement("summary"); summary.className = "text-link"; summary.textContent = "Scanned file hashes"; hashes.append(summary);
  for (const item of artifacts) {
    const line = document.createElement("p"); line.className = "hash muted"; line.textContent = item.filename + " — SHA-256 " + item.sha256; hashes.append(line);
  }
  rows.append(hashes);
  const grid = $("evidence-grid");
  grid.replaceChildren(
    evidenceCard("Microsoft Defender", scanPassed ? "0 detections · " + artifacts.length + " release files" : "Scan pending", reportLink("defender","/security/defender-report.json"), scanPassed),
    evidenceCard("ClamAV", clamPassed ? "0 detections · " + artifacts.length + " release files" : "Scan pending", reportLink("clamav","/security/clamav-report.json"), clamPassed),
    evidenceCard("Semgrep · code analysis", analysisDone ? (analysis.findings && analysis.reviewed_findings === analysis.findings ? analysis.findings + " reviewed note" : analysis.findings + " findings") + " · " + analysis.scanned_files + " files scanned" : "Analysis pending", reportLink("semgrep","/security/semgrep-report.json"), analysisDone && analysis.findings === 0),
    evidenceCard("RustSec · dependencies", noVulnerabilities ? "0 vulnerabilities · " + audit.warnings + " advisory notes" : "Audit pending", reportLink("rustsec","/security/dependency-audit.json"), noVulnerabilities && !audit.warnings)
  );
  if (publicRun && checks.codeql) {
    grid.append(evidenceCard("CodeQL · code analysis", checks.codeql.findings + " findings · JavaScript & Python", reportLink("codeql","/security/codeql-report.sarif"), checks.codeql.findings === 0));
    grid.append(evidenceCard("Signed provenance", provenance.immutable ? "Immutable GitHub release" : "Verify on GitHub", provenance.release_url, !!provenance.immutable));
  }
  const stamp = checks.checked_at ? new Date(checks.checked_at) : null;
  $("evidence-version").textContent = reportMatches ? "v" + release.version + (stamp && !Number.isNaN(stamp.getTime()) ? " · " + stamp.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "") : "Reports pending";
  $("security-summary").textContent = publicRun ? "GitHub-hosted checks · Windows installer unsigned · provenance proves origin and integrity, not safety." : "Windows installer unsigned · automated checks and developer review, not an independent certification.";
}
async function initialize() {
  selectPlatform(selectedPlatform);
  await Promise.allSettled([
    (async () => {
      release = JSON.parse(new TextDecoder().decode(await fetchBytes("/launcher/releases.json", 65536)));
      for (const button of document.querySelectorAll("[data-platform]")) button.querySelector(".availability").textContent = release.platforms?.[button.dataset.platform] ? "Available" : "Coming soon";
      selectPlatform(selectedPlatform);
    })().catch(() => { $("download-detail").textContent = "Downloads unavailable. Please reload."; }),
    (async () => {
      catalog = await loadCatalog(); renderAddons(); renderSecurity();
    })().catch((error) => { $("addon-list").textContent = error.message; installStatus("The addon catalog could not be verified.", true); }),
    (async () => {
      checks = JSON.parse(new TextDecoder().decode(await fetchBytes("/security/release-checks.json", 256 * 1024))); renderSecurity();
    })().catch(() => { $("security-details").textContent = "Security reports are unavailable. No certification is claimed."; $("evidence-grid").textContent = "Security reports are currently unavailable."; })
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
      context.fillStyle = "rgba(195,231,255," + p.a + ")";
      context.beginPath(); context.arc(x,y,p.r,0,Math.PI*2); context.fill();
      if (p.r > 1.5) {
        context.strokeStyle = "rgba(170,222,255," + p.a*.45 + ")"; context.lineWidth = .6;
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
