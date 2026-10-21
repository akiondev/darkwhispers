"""Offline layout review using the addon's real Lua UI construction.

Uses the smoke-test API fixture and records anchors, sizes, text and colors.
Pillow approximates WoW text rendering; raid symbols are schematic stand-ins.
This does not claim to reproduce the game's secure UI or input dispatch.
"""
from functools import lru_cache
import math
from pathlib import Path
import sys
import os

from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[1]
ADDONS = ROOT / "addons" if (ROOT / "addons").is_dir() else ROOT
os.chdir(ADDONS)
sys.path.insert(0, str(ROOT / ".tools/lua-validation"))
from lupa.lua51 import LuaRuntime

FIXTURE = (ROOT / "tests/smoke.lua").read_text(encoding="utf-8").split("local cases = 0", 1)[0]
RECORD = r'''
UIParent.id = 1
local originalCreate = CreateFrame
function CreateFrame(...)
    local frame = originalCreate(...)
    frame.id = #frames
    return frame
end
function methods:SetWidth(value) self.width = value end
function methods:SetAlpha(value) self.alpha = value end
function methods:SetBackdrop(value) self.backdrop = value end
function methods:SetBackdropColor(...) self.background = {...} end
function methods:SetBackdropBorderColor(...) self.border = {...} end
function methods:SetColorTexture(...) self.fill = {...} end
function methods:SetVertexColor(...) self.vertex = {...} end
function methods:SetFrameLevel(value) self.level = value end
function methods:GetFrameLevel() return self.level or (self.parent and self.parent:GetFrameLevel() + 1) or 0 end
function methods:SetJustifyH(value) self.justify = value end
function methods:SetWordWrap(value) self.wrap = value end
function methods:SetPoint(...)
    self.points = self.points or {}
    self.points[#self.points + 1] = {...}
end
function methods:ClearAllPoints() self.points = {}; self.allPoints = nil end
function methods:SetAllPoints(relative) self.allPoints = relative or self.parent end
function methods:CreateFontString(name, layer, template)
    local region = CreateFrame("FontString", name, self)
    region.font, region.layer = template, layer
    return region
end
function methods:CreateTexture(name, layer)
    local region = CreateFrame("Texture", name, self)
    region.layer = layer or "ARTWORK"
    return region
end
function methods:SetTexCoord(...) self.texCoord = {...} end
function methods:SetTextInsets(...) self.insets = {...} end
function methods:SetMinMaxValues(low, high) self.minimum, self.maximum = low, high end
function methods:SetThumbTexture(texture) self.thumb = texture end
local oldSetValue = methods.SetValue
function methods:SetValue(value)
    oldSetValue(self, value)
    if self.thumb then
        self.thumb:ClearAllPoints()
        self.thumb:SetPoint("CENTER", self, "LEFT",
            (value - self.minimum) / (self.maximum - self.minimum) * self.width, 0)
    end
end
state = { class = "DRUID", spec = 102, facing = 0, mapID = 101 }
GetPlayerFacing = function() return state.facing end
C_Map = { GetBestMapForUnit = function() return state.mapID end }
local function click(button) button.scripts.OnClick(button) end
'''


def values(table):
    return [table[i] for i in range(1, len(table) + 1)] if table is not None else []


def rgba(table, alpha=1):
    channels = values(table) if table is not None else [1, 1, 1, 1]
    return tuple(round(max(0, min(1, v)) * 255) for v in channels[:3]) + (
        round((channels[3] if len(channels) > 3 else 1) * alpha * 255),
    )


class Preview:
    def __init__(self, frames, root, width, height):
        self.nodes = {f["id"]: f for f in values(frames)}
        self.root = root["id"]
        self.screen = width, height
        self.canvas = Image.new("RGBA", (width, height), (19, 23, 29, 255))
        self.warnings = []

    @lru_cache(None)
    def scale(self, ident):
        f = self.nodes[ident]
        return (f["scale"] or 1) * (self.scale(f["parent"]["id"]) if f["parent"] else 1)

    def font(self, f):
        if "Carlito-Regular.ttf" in (f["font"] or ""):
            return ImageFont.truetype(str(ADDONS / "DarkWhisperRaidTools/Media/Carlito-Regular.ttf"), max(1, round((f["fontSize"] or 14) * self.scale(f["id"]))))
        face = "arialn.ttf" if "ARIALN" in (f["font"] or "") else "arial.ttf"
        return ImageFont.truetype("C:/Windows/Fonts/" + face, max(1, round((f["fontSize"] or 14) * self.scale(f["id"]))))

    def lines(self, f, width):
        text, font = str(f["valueText"] or ""), self.font(f)
        result = []
        for paragraph in text.split("\n"):
            if f["wrap"] is False:
                line = paragraph
                if font.getlength(line) > width:
                    while line and font.getlength(line + "…") > width:
                        line = line[:-1]
                    line += "…"
                result.append(line)
            else:
                line = ""
                for word in paragraph.split(" "):
                    candidate = (line + " " + word).strip()
                    if line and font.getlength(candidate) > width:
                        result.append(line)
                        line = word
                    else:
                        line = candidate
                result.append(line)
        return result

    @staticmethod
    def anchor(name):
        return (0 if "LEFT" in name else 1 if "RIGHT" in name else .5,
                0 if "TOP" in name else 1 if "BOTTOM" in name else .5)

    @lru_cache(None)
    def rect(self, ident):
        if ident == 1:
            return (0, 0, *self.screen)
        f = self.nodes[ident]
        if f["allPoints"] is not None:
            return self.rect(f["allPoints"]["id"])
        scale = self.scale(ident)
        w, h = (f["width"] or 0) * scale, (f["height"] or 0) * scale
        if f["kind"] == "FontString":
            font = self.font(f)
            w = w or max(1, font.getlength(str(f["valueText"] or "")))
            h = h or len(self.lines(f, w)) * (font.size + 2)
        constraints = []
        for p in values(f["points"]):
            args = values(p)
            own = args[0]
            if len(args) > 1 and not isinstance(args[1], (int, float)):
                relative = args[1]["id"]
                target = args[2] if len(args) > 2 else own
                dx, dy = args[3:5] if len(args) >= 5 else (0, 0)
            else:
                relative = f["parent"]["id"]
                target = own
                dx, dy = args[1:3] if len(args) >= 3 else (0, 0)
            rx, ry, rw, rh = self.rect(relative)
            tx, ty = self.anchor(target)
            ox, oy = self.anchor(own)
            constraints.append((ox, oy, rx + rw * tx + dx * scale, ry + rh * ty - dy * scale))
        if not constraints:
            return (0, 0, w, h)
        ox, oy, ax, ay = constraints[0]
        if len(constraints) > 1:
            bx, by, cx, cy = constraints[-1]
            if bx != ox:
                w = (cx - ax) / (bx - ox)
            if by != oy:
                h = (cy - ay) / (by - oy)
        return ax - ox * w, ay - oy * h, w, h

    @lru_cache(None)
    def level(self, ident):
        f = self.nodes[ident]
        if f["level"] is not None:
            return f["level"]
        return (self.level(f["parent"]["id"]) if f["parent"] else 0) + (
            0 if f["kind"] in ("Texture", "FontString") else 1)

    def visible(self, f):
        while f is not None:
            if not f["shown"]:
                return False
            if f["id"] == self.root:
                return True
            f = f["parent"]
        return False

    def opacity(self, f):
        alpha = 1
        while f is not None:
            alpha *= f["alpha"] if f["alpha"] is not None else 1
            f = f["parent"]
        return alpha

    def symbol(self, ident, size):
        tile = Image.new("RGBA", (size, size))
        d = ImageDraw.Draw(tile)
        colors = ["#ffe95b", "#ef9c22", "#ce5aee", "#38dd77", "#a7e4ff", "#32c8fc", "#ef5744", "#eee7d9"]
        c, center, r = colors[ident - 1], size / 2, size * .42
        if ident == 1:
            pts = [(center + math.sin(i * math.pi / 5) * r * (1 if i % 2 == 0 else .45),
                    center - math.cos(i * math.pi / 5) * r * (1 if i % 2 == 0 else .45)) for i in range(10)]
            d.polygon(pts, fill=c)
        elif ident == 2:
            d.ellipse((center-r, center-r, center+r, center+r), fill=c)
        elif ident == 3:
            d.polygon([(center, center-r), (center+r, center), (center, center+r), (center-r, center)], fill=c)
        elif ident == 4:
            d.polygon([(center, center-r), (center+r, center+r), (center-r, center+r)], outline=c, width=max(2, size//10))
        elif ident == 5:
            d.ellipse((center-r, center-r, center+r, center+r), fill=c)
            d.ellipse((center-r+size*.25, center-r-size*.1, center+r+size*.25, center+r-size*.1), fill=(0,0,0,0))
        elif ident == 6:
            d.rectangle((center-r, center-r, center+r, center+r), fill=c)
        elif ident == 7:
            d.line((center-r, center-r, center+r, center+r), fill=c, width=max(3, size//5))
            d.line((center-r, center+r, center+r, center-r), fill=c, width=max(3, size//5))
        else:
            d.ellipse((center-r, center-r, center+r, center+r*.6), fill=c)
            d.rectangle((center-r*.5, center, center+r*.5, center+r), fill=c)
            for ex in (-.35, .35):
                d.ellipse((center+r*ex-r*.19, center-r*.3, center+r*ex+r*.19, center+r*.08), fill="#202326")
        return tile

    def draw(self):
        layers = {"BACKGROUND": 0, "BORDER": 1, "ARTWORK": 2, "OVERLAY": 3}
        ordered = sorted((f for f in self.nodes.values() if self.visible(f)),
                         key=lambda f: (self.level(f["id"]), layers.get(f["layer"], -1), f["id"]))
        root_x, root_y, root_w, root_h = self.rect(self.root)
        for f in ordered:
            x, y, w, h = self.rect(f["id"])
            if w <= 0 or h <= 0:
                continue
            if (x < root_x - 1 or y < root_y - 1
                    or x + w > root_x + root_w + 1 or y + h > root_y + root_h + 1):
                self.warnings.append(f"Outside window: {f['valueText'] or f['kind']}")
            x, y, w, h = round(x), round(y), max(1, round(w)), max(1, round(h))
            alpha = self.opacity(f)
            tile = Image.new("RGBA", self.canvas.size)
            d = ImageDraw.Draw(tile)
            if f["backdrop"] is not None:
                bg, edge = f["background"], f["border"]
                if f["backdrop"]["bgFile"] and bg is not None:
                    d.rectangle((x,y,x+w-1,y+h-1), fill=rgba(bg, alpha))
                if edge is not None:
                    d.rectangle((x,y,x+w-1,y+h-1), outline=rgba(edge, alpha),
                                width=max(1, round((f["backdrop"]["edgeSize"] or 1)*self.scale(f["id"]))))
            if f["kind"] == "Texture":
                path = f["texture"] or ""
                image = None
                if "UI-RaidTargetingIcon_" in path:
                    image = self.symbol(int(path[-1]), max(w, h)).resize((w, h))
                elif "\\Media\\" in path:
                    image = Image.open(ADDONS / path.split("\\")[-3] / "Media" / (path.split("\\")[-1] if "." in path.split("\\")[-1] else path.split("\\")[-1] + ".tga")).convert("RGBA").resize((w,h), Image.Resampling.LANCZOS)
                    image = ImageChops.multiply(image, Image.new("RGBA", image.size, rgba(f["vertex"])))
                if image:
                    if f["texCoord"] is not None and values(f["texCoord"]) == [0, 1, 1, 0]:
                        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                    image.putalpha(image.getchannel("A").point(lambda v: round(v * alpha)))
                    tile.alpha_composite(image, (x,y))
                elif f["fill"] is not None:
                    d.rectangle((x,y,x+w-1,y+h-1), fill=rgba(f["fill"], alpha))
            elif f["kind"] in ("FontString", "EditBox"):
                font = self.font(f)
                inset = 8 * self.scale(f["id"]) if f["kind"] == "EditBox" else 0
                lines = self.lines(f, w - inset * 2)
                top = y + ((h - (font.size+2))/2 if f["kind"] == "EditBox" else 0)
                for line in lines:
                    tw = font.getlength(line)
                    left = x + inset
                    if f["justify"] == "CENTER": left = x + (w-tw)/2
                    elif f["justify"] == "RIGHT": left = x+w-tw
                    d.text((left,top), line, font=font, fill=rgba(f["color"], alpha), anchor="lt")
                    top += font.size + 2
                if top > y+h+2:
                    self.warnings.append(f"Text exceeds box: {f['valueText']}")
            self.canvas = Image.alpha_composite(self.canvas, tile)
        x, y, w, h = self.rect(self.root)
        result = self.canvas.crop((max(0,round(x)-12), max(0,round(y)-12),
                                   min(self.screen[0],round(x+w)+12), min(self.screen[1],round(y+h)+12)))
        return result.convert("RGB")


def render(name, script="", screen=(1440, 1000), main=False):
    lua = LuaRuntime()
    setup = f"UIParent.width, UIParent.height = {screen[0]}, {screen[1]}\n"
    if main:
        setup += 'local ns = loadAddon()\nSlashCmdList.AKIONUI()\n'
    else:
        setup += 'local ns = loadRaidTools()\nSlashCmdList.DARKWHISPERRAIDTOOLS()\nlocal C, menu = ns.Compass, DarkWhisperRaidToolsCompassOptions\n'
    root_name = "AkionUIOptionsFrame" if main else "DarkWhisperRaidToolsCompassOptions"
    frames, root = lua.execute(FIXTURE + RECORD + setup + script + f"\nreturn frames, {root_name}")
    preview = Preview(frames, root, *screen)
    output = ROOT / ".research/ui-review"
    output.mkdir(exist_ok=True)
    path = output / (name + ".png")
    preview.draw().save(path)
    print(f"{path.name}: " + ("; ".join(preview.warnings) or "no text or window overflow"))
    assert not preview.warnings, f"Inspect layout problems in {path.name}"
    return path


if __name__ == "__main__":
    render("compass-default")
    render("compass-empty", "C.AddLayout()")
    render("compass-distributed", "C.AddLayout(); C.AssignMarker(2, 1); C.AssignMarker(4, 8); C.Distribute()")
    render("compass-picker", "C.AddLayout(); C.OpenPicker(8)")
    render("compass-dropdown", 'for i=1,15 do C.AddLayout() end; C.Profile().name = string.rep("W",28); C.Refresh(); click(menu.layoutButton)')
    render("compass-small", "C.AddLayout(); C.OpenPicker(1)", (1024, 768))
    render("compass-no-heading", "state.facing = nil; C.SetLive(true)")
    render("compass-max-size", 'C.SetProfileValue("size",160); C.SetProfileValue("iconSize",64)')
    render("compass-max-live", 'C.SetProfileValue("size",160); C.SetProfileValue("iconSize",64); C.SetMarker(1,"radius",1); C.SetLive(true)')
    render("moonkin", main=True)
    render("bloodlust", 'for _, f in ipairs(frames) do if f.label and f.label.valueText=="Bloodlust / Heroism" then click(f); break end end', main=True)
    render("soothe", 'for _, f in ipairs(frames) do if f.label and f.label.valueText=="Soothe" then click(f); break end end', main=True)
