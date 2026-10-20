from pathlib import Path
root = Path(__file__).resolve().parents[1]
html = (root / "ui/index.html").read_text(encoding="utf-8")
html = html.replace("<head>", '<head><base href="/ui/"><script src="/tests/bridge.js"></script>')
(root / "tests/ui.html").write_text(html, encoding="utf-8")
print("Browser test page ready at /tests/ui.html when serving launcher/")
