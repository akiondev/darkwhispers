import {fetchBytes,sha256} from "/browser-install.mjs";
const $ = id => document.getElementById(id);
const reports = {
  defender:{title:"Microsoft Defender",file:"defender-report.json",original:"defender.json",description:"Antivirus results for the exact release packages. Detection counts, scanner version, signature freshness and every scanned file are included."},
  clamav:{title:"ClamAV",file:"clamav-report.json",original:"clamav.json",description:"Independent antivirus engine results, signature count, scan scope and exact package hashes."},
  semgrep:{title:"Semgrep",file:"semgrep-report.json",original:"semgrep.json",description:"Automated source analysis. All findings and analysis errors remain visible in the complete report below."},
  rustsec:{title:"RustSec",file:"dependency-audit.json",original:"cargo-audit.json",description:"Dependency vulnerability results and informational advisory notes. Notes are retained, even when no vulnerability blocks the release."},
  codeql:{title:"CodeQL",file:"codeql-report.sarif",original:"codeql-report.sarif",description:"Complete SARIF source-analysis results for JavaScript and Python, including rules and any reported findings."},
  evidence:{title:"Signed release provenance",file:"release-evidence.json",original:"release-evidence.json",description:"Release packages, exact source commit, public build, original report hashes and the command for checking GitHub's provenance attestations."},
  source:{title:"Source review notes",file:"source-review.md",description:"Maintainer notes on scope, design and verification. These notes are separate from the attested automated scan reports."}
};
const requested = new URLSearchParams(location.search).get("report");
const selected = Object.hasOwn(reports,requested) ? requested : "defender";
const report = reports[selected];
document.title = report.title + " · DarkWhispers";
$("report-title").textContent = report.title;
$("report-description").textContent = report.description;
for (const [id,item] of Object.entries(reports)) {
  const link = document.createElement("a"); link.href = "/reports.html?report=" + id; link.textContent = id === "evidence" ? "Provenance" : id === "source" ? "Review notes" : item.title;
  if (id === selected) link.setAttribute("aria-current","page");
  $("report-tabs").append(link);
}
function metric(value,label) {
  const card=document.createElement("div");card.className="report-metric";
  const strong=document.createElement("strong");strong.textContent=String(value);
  const caption=document.createElement("span");caption.textContent=label;card.append(strong,caption);$("report-summary").append(card);
}
async function load() {
  try {
    const [bytes,evidenceBytes] = await Promise.all([fetchBytes("/security/"+report.file,8*1024*1024),fetchBytes("/security/release-evidence.json",1024*1024)]);
    const evidence=JSON.parse(new TextDecoder().decode(evidenceBytes));
    if (!/^\d+\.\d+\.\d+$/.test(evidence.version) || !/^[a-f0-9]{40}$/.test(evidence.commit)) throw new Error("Invalid release evidence.");
    $("report-release").textContent = " / v"+evidence.version;
    const prefix="https://github.com/akiondev/darkwhispers/releases/download/v"+evidence.version+"/";
    $("original-report").href=report.original ? prefix+report.original : "https://github.com/akiondev/darkwhispers/blob/main/website/public/security/source-review.md";
    const digest=await sha256(bytes), expected=evidence.reports?.[report.original]?.sha256;
    if (expected && expected !== digest) throw new Error("This mirror does not match its release evidence. Read the original on GitHub.");
    $("report-integrity").textContent=(expected ? "Matches the SHA-256 recorded in release evidence. " : selected === "source" ? "Maintainer notes; not an independent audit. " : "Release evidence mirror. Verify its signed original on GitHub. ")+"SHA-256: "+digest;
    const text=new TextDecoder().decode(bytes);
    if (selected === "source") { $("report-content").textContent=text;metric("Maintainer","Review author");metric("Public","Source and workflow");metric("Not a certification","Scope");return; }
    const data=JSON.parse(text);$("report-content").textContent=JSON.stringify(data,null,2);
    if (selected === "defender" || selected === "clamav") {
      metric(data.detections ?? "See report","Detections");metric(data.artifacts?.length ?? 0,"Scanned packages");metric(data.status || "See report","Recorded result");
    } else if (selected === "semgrep") {
      metric(data.results?.length ?? 0,"Findings");metric(data.errors?.length ?? 0,"Analysis errors");metric(data.paths?.scanned?.length ?? 0,"Files scanned");
    } else if (selected === "rustsec") {
      metric(data.vulnerabilities?.count ?? "See report","Vulnerability entries");metric(Object.values(data.warnings || {}).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0),"Informational notes");metric(data.settings?.ignore?.length ?? 0,"Ignored advisories");
    } else if (selected === "codeql") {
      metric((data.runs || []).reduce((n,run)=>n+(run.results?.length || 0),0),"Findings");metric(data.runs?.length ?? 0,"Analysis runs");metric("Full SARIF","Original report format");
    } else {
      metric(data.artifacts?.length ?? 0,"Release packages");metric(data.commit?.slice(0,12) || "See report","Source commit");metric("v"+data.version,"Release version");
    }
  } catch (error) {
    $("report-integrity").classList.add("warning");$("report-integrity").textContent=error.message || "Report unavailable.";
    $("report-content").textContent="Could not display this report. Use Original on GitHub above or choose another report.";
  }
}
document.addEventListener("visibilitychange",()=>document.documentElement.classList.toggle("motion-paused",document.hidden));
load();
