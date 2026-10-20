from pathlib import Path
import json
import shutil
import sys

root = Path(__file__).resolve().parents[1]
version = json.loads((root/"launcher/src-tauri/tauri.conf.json").read_text())["version"]
platform = sys.argv[1]
if platform == "windows":
    source = root/f"launcher/target/x86_64-pc-windows-msvc/release/bundle/nsis/DarkWhispers Addons_{version}_x64-setup.exe"
    name = f"DarkWhispers-Addons-{version}-windows-x64-setup.exe"
elif platform == "linux":
    source = root/f"launcher/target/release/bundle/deb/DarkWhispers Addons_{version}_amd64.deb"
    name = f"DarkWhispers-Addons-{version}-linux-amd64.deb"
else:
    raise ValueError("Unknown platform")
assert source.is_file()
out = root/"out/binaries"
out.mkdir(parents=True,exist_ok=True)
shutil.copyfile(source,out/name)
print(name)
