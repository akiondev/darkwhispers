"""Build original app icons and a source-only archive for the isolated builder."""
from pathlib import Path
import shutil
import tarfile
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
icons = root / "src-tauri" / "icons"
icons.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=224, fill="#081d34")
draw.ellipse((158, 158, 866, 866), outline="#27658d", width=9)
draw.polygon([(512, 150), (752, 447), (512, 878), (272, 447)], fill="#a9e4ff")
draw.polygon([(512, 150), (512, 878), (272, 447)], fill="#438fbf")
draw.polygon([(512, 150), (752, 447), (512, 522), (272, 447)], fill="#cfefff")
draw.line([(512, 190), (512, 838)], fill="#e5f8ff", width=10)
draw.line([(512, 150), (752, 447), (512, 878), (272, 447), (512, 150)], fill="#e5f8ff", width=8)
image.resize((256, 256), Image.Resampling.LANCZOS).save(icons / "icon.png")
image.save(icons / "icon.ico", sizes=[(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)])
image.save(icons / "icon.icns")
shutil.copyfile(root.parent / "website/public/assets/frost.svg", root / "ui/mark.svg")

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
