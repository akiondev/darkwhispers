"""Collect dependency versions and their shipped license notices from Cargo metadata."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
metadata = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--locked", "--format-version", "1"], cwd=root))
sections = ["DarkWhispers Addons — third-party dependency notices",
            "Application license:\n" + (root / "LICENSE").read_text(encoding="utf-8"),
            "The application uses Tauri, Rust crates and the operating system's webview.",
            "The list includes build-time and platform-specific dependencies.",
            "Each dependency remains licensed by its authors under the terms below.\n"]
sections.extend(["\nGrenze Gotisch Black — self-hosted wordmark font\n",
                 (root / "ui/fonts/SOURCE.txt").read_text(encoding="utf-8"),
                 (root / "ui/fonts/OFL.txt").read_text(encoding="utf-8")])
for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
    if not package["source"]:
        continue
    directory = Path(package["manifest_path"]).parent
    sections.append(f"\n{'=' * 72}\n{package['name']} {package['version']}\n"
                    f"License: {package.get('license') or 'See license file'}\n"
                    f"Source: {package.get('repository') or package['source']}\n")
    licenses = {p for p in directory.iterdir() if p.is_file()
                and p.name.upper().startswith(("LICENSE", "COPYING", "NOTICE"))}
    if package.get("license_file"):
        licenses.add(directory / package["license_file"])
    for path in sorted(licenses):
        if path.is_file() and path.stat().st_size < 512 * 1024:
            sections.append(f"\n--- {path.name} ---\n{path.read_text(encoding='utf-8', errors='replace')}")
output = root / "src-tauri/THIRD-PARTY-NOTICES.txt"
output.write_text("\n".join(sections), encoding="utf-8")
print(f"Wrote dependency notices: {output}")
