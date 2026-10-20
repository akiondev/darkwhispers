from pathlib import Path
site = Path(__file__).resolve().parents[1]
qa = site / "public/__qa"
qa.mkdir(exist_ok=True)
html = (site / "public/index.html").read_text(encoding="utf-8")
html = html.replace("<head>", '<head><script type="module" src="/__qa/bridge.mjs"></script>')
(qa / "index.html").write_text(html, encoding="utf-8")
(qa / "bridge.mjs").write_text((site / "tests/opfs-bridge.mjs").read_text(encoding="utf-8"), encoding="utf-8")
print("Temporary, local-only QA page: /__qa/index.html. Remove __qa files before packaging.")
