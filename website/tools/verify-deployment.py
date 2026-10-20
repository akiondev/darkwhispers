"""Verify the installed release and public HTTPS assets against local build hashes."""
from pathlib import Path
import hashlib
import http.client
import json
import ssl
import sys
from urllib.parse import quote

build = json.loads(Path(sys.argv[1]).read_text())
installed = Path("/srv/darkwhispers-site/current").resolve()
assert installed.name == build["release"], "Wrong active release"
headers = {"User-Agent": "DarkWhispers-Deployment-Check/1.0"}
def fetch(relative=""):
    # HTTPS to this fixed origin only. Never follow redirects or handle file URLs.
    assert not relative.startswith(("/", "\\")) and "\\" not in relative
    assert all(part not in (".", "..") for part in relative.split("/"))
    connection = http.client.HTTPSConnection("darkwhispers.akion.se", timeout=20, context=ssl.create_default_context())
    try:
        connection.request("GET", "/" + quote(relative, safe="/"), headers=headers)
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()

for relative, expected in build["files"].items():
    assert hashlib.sha256((installed / relative).read_bytes()).hexdigest() == expected, relative
    status, response_headers, content = fetch(relative)
    assert status == 200, (relative, status)
    assert hashlib.sha256(content).hexdigest() == expected, f"Public file differs: {relative}"
    assert response_headers.get("X-Content-Type-Options") == "nosniff"
    if relative.endswith(".zip"):
        assert response_headers.get("Content-Disposition") == "attachment"
    print(f"Verified origin + public SHA-256: {relative}")

status, response_headers, content = fetch()
assert status == 200
assert "frame-ancestors 'none'" in response_headers.get("Content-Security-Policy", "")
assert hashlib.sha256(content).hexdigest() == build["files"]["index.html"]
status, _, content = fetch("missing-page-deployment-check")
assert status == 404, status
assert b"This page could not be found." in content
print("Home page, security headers, download headers and custom 404 verified.")
