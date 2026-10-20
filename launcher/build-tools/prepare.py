"""Build original app icons and a source-only archive for the isolated builder."""
from pathlib import Path
import shutil
import tarfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
icons = root / "src-tauri" / "icons"
icons.mkdir(parents=True, exist_ok=True)
image = Image.open(root.parent / "website/design/hooded-vampire.png").convert("RGBA")
assert image.width == image.height
image.resize((256, 256), Image.Resampling.LANCZOS).save(icons / "icon.png")
image.save(icons / "icon.ico", sizes=[(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)])
shutil.copyfile(root.parent / "website/public/assets/vampire-logo.webp", root / "ui/mark.webp")
shutil.copytree(root.parent / "website/public/assets/fonts", root / "ui/fonts", dirs_exist_ok=True)

output = root / "dist" / "source.tar.gz"
output.parent.mkdir(exist_ok=True)
excluded = {"target", "dist", "node_modules", ".git", "cache", "__pycache__"}
with tarfile.open(output, "w:gz") as tar:
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if any(part in excluded for part in rel.parts) or not path.is_file():
            continue
        if path.suffix in {".pem", ".key", ".pfx", ".p12", ".log"}:
            raise RuntimeError(f"Unexpected secret or log in source tree: {rel}")
        tar.add(path, arcname=rel.as_posix(), recursive=False)
print(f"Prepared icons and source archive: {output}")
