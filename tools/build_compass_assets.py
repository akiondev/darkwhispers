"""Generate the compass's simple alpha textures; no third-party artwork."""
import math
import struct
from pathlib import Path

project = Path(__file__).resolve().parents[1]
addon_base = project / "addons" if (project / "addons").is_dir() else project
target = addon_base / "DarkWhisperRaidTools" / "Media"
target.mkdir(exist_ok=True)


def write_tga(name, size, coverage):
    header = struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, size, size, 32, 0x28)
    pixels = bytearray()
    for y in range(size):
        for x in range(size):
            alpha = round(255 * min(1, max(0, coverage(x + 0.5, y + 0.5))))
            pixels.extend((255, 255, 255, alpha))
    (target / name).write_bytes(header + pixels)


write_tga("CompassDisc.tga", 256, lambda x, y: 119 - math.hypot(x - 128, y - 128))
write_tga("CompassRing.tga", 256, lambda x, y: 1.6 - abs(math.hypot(x - 128, y - 128) - 118))


def arrow(x, y):
    # Upward-pointing arrowhead with a notch at its base.
    if y < 5 or y > 57:
        return 0
    outside = (y - 5) * 0.48 - abs(x - 32)
    notch = 45 + abs(x - 32) * 0.5 - y
    return min(outside, notch)


write_tga("CompassArrow.tga", 64, arrow)
print("Generated CompassDisc.tga, CompassRing.tga and CompassArrow.tga")
