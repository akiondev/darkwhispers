local _, ns = ...
local C = ns.Compass
local panel, updating
local FONT = "Fonts\\ARIALN.TTF"
local WHITE = "Interface\\Buttons\\WHITE8X8"
local WIDTH, HEIGHT = 1090, 728

local function Label(parent, text, size, x, y, width)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(FONT, size, "")
    label:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    label:SetWidth(width)
    label:SetJustifyH("LEFT")
    label:SetWordWrap(false)
    label:SetTextColor(0.92, 0.92, 0.9)
    label:SetText(text)
    return label
end

local function Box(kind, parent, width, height)
    local frame = CreateFrame(kind, nil, parent, "BackdropTemplate")
    frame:SetSize(width, height)
    frame:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    frame:SetBackdropColor(0.14, 0.135, 0.12, 0.96)
    frame:SetBackdropBorderColor(0.035, 0.035, 0.03, 1)
    return frame
end

local function Button(parent, text, x, y, width, callback)
    local button = Box("Button", parent, width, 26)
    button:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    button.label = Label(button, text, 13, 0, 6, width)
    button.label:SetJustifyH("CENTER")
    button.label:SetWordWrap(false)
    function button:RefreshBorder()
        if self.hovered or self.selected then self:SetBackdropBorderColor(0.2, 0.65, 0.61, 1)
        else self:SetBackdropBorderColor(0.035, 0.035, 0.03, 1) end
    end
    button:SetScript("OnClick", callback)
    button:SetScript("OnEnter", function(self)
        self.hovered = self:IsEnabled()
        self:RefreshBorder()
    end)
    button:SetScript("OnLeave", function(self)
        self.hovered = false
        self:RefreshBorder()
    end)
    return button
end

local function Slider(text, y, key, minimum, maximum, step, factor)
    local parent = panel.content
    Label(parent, text, 13, 12, y, 104)
    local slider = CreateFrame("Slider", nil, parent)
    slider:SetSize(174, 18)
    slider:SetPoint("TOPLEFT", parent, "TOPLEFT", 126, -y)
    slider:SetOrientation("HORIZONTAL")
    slider:SetMinMaxValues(minimum, maximum)
    slider:SetValueStep(step)
    slider:SetObeyStepOnDrag(true)
    slider:EnableMouse(true)
    local track = slider:CreateTexture(nil, "BACKGROUND")
    track:SetColorTexture(0.28, 0.27, 0.24, 1)
    track:SetPoint("CENTER", slider, "CENTER", 0, 0)
    track:SetSize(174, 4)
    local thumb = slider:CreateTexture(nil, "ARTWORK")
    thumb:SetColorTexture(0.72, 0.64, 0.3, 1)
    thumb:SetSize(12, 18)
    slider:SetThumbTexture(thumb)
    slider.valueLabel = Label(parent, "", 13, 318, y, 58)
    slider:SetScript("OnValueChanged", function(_, value)
        if not updating then
            value = math.floor(value / step + 0.5) * step
            C.SetProfileValue(key, value / factor)
        end
    end)
    function slider:Refresh()
        local value = math.floor(C.Profile()[key] * factor + 0.5)
        self:SetValue(value)
        self.valueLabel:SetText(value .. (factor == 100 and "%" or ""))
    end
    return slider
end

local function CommitName()
    if not panel then return end
    local name = panel.name:GetText():gsub("|", ""):gsub("[%c]", ""):match("^%s*(.-)%s*$")
    if name ~= "" and C.Config().active ~= 1 then C.Profile().name = name end
    panel.name:SetText(C.Profile().name)
    panel.layoutButton.label:SetText(C.Profile().name)
end

function C.CloseLayoutMenu()
    if panel and panel.layoutMenu then panel.layoutMenu:Hide() end
end

local function RefreshLayoutMenu()
    local menu, layouts = panel.layoutMenu, C.Config().layouts
    menu.offset = math.max(0, math.min(menu.offset or 0, math.max(0, #layouts - 8)))
    local count = math.min(8, #layouts)
    menu:SetHeight(count * 32 + 48)
    for row, button in ipairs(menu.items) do
        local index = menu.offset + row
        local profile = layouts[index]
        button.index = index
        button:SetShown(profile ~= nil)
        if profile then
            button.selected = C.Config().active == index
            button:RefreshBorder()
            button.label:SetText(profile.name)
            button:SetBackdropColor(0.12, C.Config().active == index and 0.3 or 0.135,
                C.Config().active == index and 0.28 or 0.12, 1)
        end
    end
    menu.up:ClearAllPoints()
    menu.up:SetPoint("TOPLEFT", menu, "TOPLEFT", 8, -(count * 32 + 8))
    menu.down:ClearAllPoints()
    menu.down:SetPoint("TOPLEFT", menu, "TOPLEFT", 56, -(count * 32 + 8))
    menu.range:ClearAllPoints()
    menu.range:SetPoint("TOPLEFT", menu, "TOPLEFT", #layouts > 8 and 112 or 12, -(count * 32 + 16))
    menu.range:SetText(#layouts > 8 and ((menu.offset + 1) .. "–" .. (menu.offset + count) .. " / " .. #layouts)
        or (#layouts == 1 and "1 layout" or (#layouts .. " layouts")))
    menu.up:SetShown(#layouts > 8)
    menu.down:SetShown(#layouts > 8)
    menu.up:SetEnabled(menu.offset > 0)
    menu.down:SetEnabled(menu.offset + count < #layouts)
    menu.up:SetAlpha(menu.offset > 0 and 1 or 0.3)
    menu.down:SetAlpha(menu.offset + count < #layouts and 1 or 0.3)
end

local function CreateLayoutMenu()
    local menu = Box("Frame", panel, 330, 80)
    menu:SetBackdropColor(0.075, 0.07, 0.055, 1)
    panel.layoutMenu = menu
    menu:Hide()
    menu:EnableMouse(true)
    menu:EnableMouseWheel(true)
    menu:SetFrameLevel(panel:GetFrameLevel() + 20)
    menu:SetPoint("TOPLEFT", panel.layoutButton, "BOTTOMLEFT", 0, -5)
    menu.items = {}
    local function Scroll(delta)
        menu.offset = (menu.offset or 0) + delta
        RefreshLayoutMenu()
    end
    for row = 1, 8 do
        local button = Button(menu, "", 8, 8 + (row - 1) * 32, 314, function(self)
            CommitName()
            panel.name:ClearFocus()
            C.SetActive(self.index)
        end)
        button.label:SetJustifyH("LEFT")
        button.label:ClearAllPoints()
        button.label:SetPoint("LEFT", button, "LEFT", 12, 0)
        button.label:SetWidth(290)
        button:EnableMouseWheel(true)
        button:SetScript("OnMouseWheel", function(_, delta) Scroll(-delta) end)
        menu.items[row] = button
    end
    menu:SetScript("OnMouseWheel", function(_, delta) Scroll(-delta) end)
    menu.up = Button(menu, "↑", 8, 0, 40, function() Scroll(-1) end)
    menu.down = Button(menu, "↓", 56, 0, 40, function() Scroll(1) end)
    menu.range = Label(menu, "", 12, 112, 0, 202)
end

local function ToggleLayoutMenu()
    if panel.layoutMenu:IsShown() then C.CloseLayoutMenu(); return end
    CommitName()
    panel.name:ClearFocus()
    C.ClosePicker()
    panel.layoutMenu.offset = math.max(0, C.Config().active - 4)
    RefreshLayoutMenu()
    panel.layoutMenu:Show()
end

function C.ClosePicker()
    if panel and panel.picker then panel.picker:Hide() end
end

function C.OpenPicker(id)
    C.CloseLayoutMenu()
    C.SelectMarker(id)
    local picker = panel.picker
    picker.slot = id
    picker.title:SetText("Position " .. id .. " · choose a marker")
    picker.hint:SetText("An existing marker moves to this position.")
    local occupied = C.Profile().markers[id].icon > 0
    picker.remove:SetEnabled(occupied)
    picker.remove:SetAlpha(occupied and 1 or 0.35)
    picker:ClearAllPoints()
    picker:SetPoint("TOPLEFT", panel.rows[id].select, "BOTTOMLEFT", 0, -4)
    picker:Show()
end

local function CreatePicker()
    local picker = Box("Frame", panel, 394, 142)
    picker:SetBackdropColor(0.075, 0.07, 0.055, 1)
    picker:Hide()
    picker:EnableMouse(true)
    picker:SetFrameLevel(panel:GetFrameLevel() + 10)
    picker:SetBackdropBorderColor(0.48, 0.43, 0.22, 1)
    picker.title = Label(picker, "", 14, 12, 12, 330)
    picker.hint = Label(picker, "", 12, 12, 34, 370)
    picker.hint:SetTextColor(0.5, 0.8, 0.85)
    picker.choices = {}
    for icon = 1, 8 do
        local choice = Button(picker, "", 12 + (icon - 1) * 47, 56, 41, function()
            C.AssignMarker(picker.slot, icon)
        end)
        choice:SetHeight(36)
        choice.icon = choice:CreateTexture(nil, "ARTWORK")
        choice.icon:SetTexture("Interface\\TargetingFrame\\UI-RaidTargetingIcon_" .. icon)
        choice.icon:SetSize(30, 30)
        choice.icon:SetPoint("CENTER", choice, "CENTER", 0, 0)
        choice:SetScript("OnEnter", function(self)
            self:SetBackdropBorderColor(0, 0.8, 0.92, 1)
            local text = C.names[icon]
            for slot, marker in ipairs(C.Profile().markers) do
                if marker.icon == icon and slot ~= picker.slot then
                    text = text .. " · moves from position " .. slot
                    break
                end
            end
            picker.hint:SetText(text)
        end)
        choice:SetScript("OnLeave", function(self)
            self:SetBackdropBorderColor(0.18, 0.27, 0.3, 1)
            picker.hint:SetText("An existing marker moves to this position.")
        end)
        picker.choices[icon] = choice
    end
    picker.remove = Button(picker, "Remove marker", 12, 102, 158, function()
        C.AssignMarker(picker.slot, 0)
    end)
    picker.close = Button(picker, "×", 352, 6, 30, C.ClosePicker)
    panel.picker = picker
end

function C.UpdateStatus()
    if not panel then return end
    local text, available = C.Status()
    panel.status:SetText(available and ("Heading: " .. text .. " · " .. C.Reference())
        or (text .. " You can still edit markers."))
    panel.status:SetTextColor(available and 0.45 or 1, available and 0.9 or 0.67, available and 0.72 or 0.3)
    panel.northButton:SetEnabled(available)
    panel.northButton:SetAlpha(available and 1 or 0.4)
end

function C.RefreshOptions()
    if not panel then return end
    updating = true
    local profile, cfg = C.Profile(), C.Config()
    if not panel.name:HasFocus() then panel.name:SetText(profile.name) end
    panel.layoutButton.label:SetText(profile.name)
    panel.layoutHint:SetText((#cfg.layouts == 1 and "1 layout" or (#cfg.layouts .. " layouts")) .. "  ·  + New  ·  − Delete")
    panel.removeLayout:SetEnabled(cfg.active ~= 1)
    panel.removeLayout:SetAlpha(cfg.active ~= 1 and 1 or 0.3)
    panel.name:EnableMouse(cfg.active ~= 1)
    panel.name:SetAlpha(cfg.active ~= 1 and 1 or 0.55)
    if cfg.active == 1 then panel.name:ClearFocus() end
    local count = 0
    for id, row in ipairs(panel.rows) do
        local marker = profile.markers[id]
        if marker.enabled then count = count + 1 end
        row.icon:SetTexture(marker.icon > 0 and ("Interface\\TargetingFrame\\UI-RaidTargetingIcon_" .. marker.icon) or nil)
        row.select.label:SetText(id .. ". " .. (C.names[marker.icon] or "Empty"))
        row.select.selected = C.selected == id
        row.select:RefreshBorder()
        row.select.label:SetTextColor(marker.enabled and 0.93 or 0.48, marker.enabled and 0.96 or 0.52,
            marker.enabled and 0.97 or 0.55)
        row.angle:SetText(string.format("%.0f°", marker.angle))
        row.toggle:SetShown(marker.icon > 0)
        row.toggle.label:SetText(marker.enabled and "Shown" or "Hidden")
        row.toggle.label:SetTextColor(marker.enabled and 0.4 or 0.55, marker.enabled and 1 or 0.6, 0.7)
    end
    panel.markerCount:SetText("MARKERS · " .. count .. " of 8 shown")
    local marker = profile.markers[C.selected]
    panel.selected:SetText("Position " .. C.selected .. ": " .. (C.names[marker.icon] or "Empty"))
    panel.angleValue:SetText(string.format("%.0f°", marker.angle))
    panel.radiusValue:SetText(string.format("%.0f%%", marker.radius * 100))
    panel.sizeSlider:Refresh()
    panel.iconSlider:Refresh()
    panel.opacitySlider:Refresh()
    panel.cardinals.label:SetText(profile.cardinals and "Cardinals: on" or "Cardinals: off")
    panel.enableButton.label:SetText(cfg.enabled and "Disable compass" or "Enable compass")
    panel.enableButton:SetBackdropColor(0.12, cfg.enabled and 0.3 or 0.135, cfg.enabled and 0.28 or 0.12, 1)
    panel.moveButton.label:SetText(C.unlocked and "Lock position" or "Move HUD")
    panel.liveButton.label:SetText(C.live and "Edit layout" or "Test live")
    panel.previewTitle:SetText(C.live and "LIVE · forward is up" or "EDIT · north is up")
    panel.previewHint:SetText(C.live and "Turn your character to see the markers rotate."
        or "Click to choose an icon; drag to position it. Test live to preview icon scaling.")
    updating = false
    C.UpdateStatus()
end

local function CreatePanel()
    panel = CreateFrame("Frame", "DarkWhisperRaidToolsCompassOptions", UIParent, "BackdropTemplate")
    panel:Hide()
    panel:SetSize(WIDTH, HEIGHT)
    panel:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
    panel:SetFrameStrata("DIALOG")
    panel:SetClampedToScreen(true)
    panel:SetMovable(true)
    panel:EnableMouse(true)
    panel:SetScript("OnMouseDown", function()
        C.CloseLayoutMenu()
        C.ClosePicker()
    end)
    panel:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    panel:SetBackdropColor(0.035, 0.03, 0.018, 0.88)
    panel:SetBackdropBorderColor(0.47, 0.4, 0.19, 1)
    tinsert(UISpecialFrames, "DarkWhisperRaidToolsCompassOptions")

    local function Surface(parent, x, y, width, height, r, g, b, alpha)
        local texture = parent:CreateTexture(nil, "BACKGROUND")
        texture:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
        texture:SetSize(width, height)
        texture:SetColorTexture(r, g, b, alpha or 1)
    end
    local function Heading(parent, text, x, y, width)
        return Label(parent, text, 12, x, y, width):SetTextColor(0.96, 0.82, 0.27)
    end
    -- Only the title bar moves the window; controls and the circle keep their input.
    panel.titleBar = CreateFrame("Frame", nil, panel)
    panel.titleBar:SetPoint("TOPLEFT", panel, "TOPLEFT", 2, -2)
    panel.titleBar:SetSize(WIDTH - 36, 26)
    panel.titleBar:EnableMouse(true)
    panel.titleBar:RegisterForDrag("LeftButton")
    panel.titleBar:SetScript("OnDragStart", function() panel:StartMoving() end)
    panel.titleBar:SetScript("OnDragStop", function() panel:StopMovingOrSizing() end)
    Surface(panel, 2, 2, WIDTH - 4, 26, 0.06, 0.055, 0.04, 0.95)
    panel.scaleLabel = Label(panel.titleBar, "", 11, 10, 7, 140)
    panel.scaleLabel:SetTextColor(0.85, 0.75, 0.38)
    local title = Label(panel.titleBar, "DarkWhisper Raid Tools", 15, 180, 4, WIDTH - 360)
    title:SetJustifyH("CENTER")
    title:SetTextColor(0.18, 0.85, 0.82)
    panel.closeButton = Button(panel, "X", WIDTH - 30, 3, 26, function() panel:Hide() end)
    panel.closeButton:SetHeight(22)

    Surface(panel, 8, 36, 146, HEIGHT - 64, 0.08, 0.075, 0.06, 0.75)
    Surface(panel, 160, 34, 1, HEIGHT - 61, 0.4, 0.35, 0.18, 0.65)
    Heading(panel, "RAID TOOLS", 18, 49, 126)
    panel.compassTab = Button(panel, "Marker compass", 10, 72, 142, function() C.SetLive(false) end)
    panel.compassTab:SetBackdropColor(0.1, 0.28, 0.26, 1)
    panel.compassTab.selected = true
    panel.compassTab:RefreshBorder()
    Heading(panel, "DISPLAY", 18, 122, 126)
    panel.enableButton = Button(panel, "", 10, 146, 142, function() C.SetEnabled(not C.Config().enabled) end)
    panel.moveButton = Button(panel, "", 10, 178, 142, function() C.SetUnlocked(not C.unlocked) end)
    panel.liveButton = Button(panel, "", 10, 210, 142, function() C.SetLive(not C.live) end)
    Heading(panel, "CALIBRATION", 18, 270, 126)
    panel.northButton = Button(panel, "Set north", 10, 294, 142, C.SetNorth)
    panel.resetButton = Button(panel, "Map north", 10, 326, 142, C.ResetNorth)
    local northHint = Label(panel, "Face your preferred direction, then click Set north.", 12, 18, 368, 126)
    northHint:SetWordWrap(true)
    northHint:SetTextColor(0.66, 0.65, 0.59)
    local moveHint = Label(panel, "Drag the title bar to move this window.", 11, 18, HEIGHT - 94, 126)
    moveHint:SetWordWrap(true)
    moveHint:SetTextColor(0.55, 0.55, 0.5)

    panel.content = CreateFrame("Frame", nil, panel)
    local body = panel.content
    body:SetPoint("TOPLEFT", panel, "TOPLEFT", 176, -40)
    body:SetSize(898, 650)
    Heading(body, "Saved layout", 12, 8, 340)
    panel.layoutButton = Button(body, "", 12, 30, 244, ToggleLayoutMenu)
    panel.layoutButton.label:ClearAllPoints()
    panel.layoutButton.label:SetPoint("LEFT", panel.layoutButton, "LEFT", 10, 0)
    panel.layoutButton.label:SetWidth(206)
    panel.layoutButton.label:SetJustifyH("LEFT")
    -- Font-independent dropdown chevron, drawn with the addon's own texture.
    local arrow = panel.layoutButton:CreateTexture(nil, "ARTWORK")
    arrow:SetTexture("Interface\\AddOns\\DarkWhisperRaidTools\\Media\\CompassArrow.tga")
    arrow:SetTexCoord(0, 1, 1, 0)
    arrow:SetSize(12, 12)
    arrow:SetPoint("RIGHT", panel.layoutButton, "RIGHT", -8, 0)
    arrow:SetVertexColor(0.85, 0.74, 0.28, 1)
    panel.addLayout = Button(body, "+", 264, 30, 32, function()
        CommitName()
        panel.name:ClearFocus()
        C.AddLayout()
    end)
    panel.removeLayout = Button(body, "−", 304, 30, 32, C.RemoveLayout)
    panel.layoutHint = Label(body, "", 11, 12, 64, 360)
    panel.layoutHint:SetTextColor(0.6, 0.6, 0.55)
    Heading(body, "Layout name", 410, 8, 476)
    panel.name = Box("EditBox", body, 476, 26)
    panel.name:SetPoint("TOPLEFT", body, "TOPLEFT", 410, -30)
    panel.name:SetFont(FONT, 13, "")
    panel.name:SetAutoFocus(false)
    panel.name:SetMaxLetters(28)
    panel.name:SetTextInsets(8, 8, 0, 0)
    panel.name:SetScript("OnEnterPressed", function(self) CommitName(); self:ClearFocus() end)
    panel.name:SetScript("OnEditFocusLost", CommitName)
    panel.name:SetScript("OnEscapePressed", function(self)
        self:SetText(C.Profile().name)
        self:ClearFocus()
    end)
    Surface(body, 12, 88, 874, 1, 0.35, 0.31, 0.19, 0.6)
    Surface(body, 390, 98, 1, 526, 0.35, 0.31, 0.19, 0.45)
    panel.previewTitle = Label(body, "", 12, 12, 102, 365)
    panel.previewTitle:SetTextColor(0.96, 0.82, 0.27)
    panel.previewHint = Label(body, "", 12, 12, 434, 365)
    panel.previewHint:SetWordWrap(true)
    panel.previewHint:SetTextColor(0.7, 0.7, 0.64)
    panel.previewMessage = Label(body, "Heading unavailable here.\nChoose Edit layout to change your markers.", 15, 42, 246, 300)
    panel.previewMessage:SetJustifyH("CENTER")
    panel.previewMessage:SetWordWrap(true)
    C.panel = panel
    panel.previewViewport = CreateFrame("Frame", nil, body)
    panel.previewViewport:SetSize(300, 300)
    panel.previewViewport:SetPoint("TOPLEFT", body, "TOPLEFT", 42, -126)
    C.preview = C.CreateDial(panel.previewViewport, true)
    C.preview:SetPoint("CENTER", panel.previewViewport, "CENTER", 0, 0)
    panel.rows = {}
    panel.markerCount = Label(body, "", 12, 410, 102, 290)
    panel.markerCount:SetTextColor(0.96, 0.82, 0.27)
    panel.clearButton = Button(body, "Clear circle", 782, 96, 104, C.ClearMarkers)
    for id = 1, 8 do
        local y = 132 + (id - 1) * 32
        local row = {}
        row.select = Button(body, "", 410, y, 280, function() C.OpenPicker(id) end)
        row.icon = row.select:CreateTexture(nil, "ARTWORK")
        row.icon:SetSize(22, 22)
        row.icon:SetPoint("LEFT", row.select, "LEFT", 7, 0)
        row.select.label:ClearAllPoints()
        row.select.label:SetPoint("LEFT", row.select, "LEFT", 40, 0)
        row.select.label:SetWidth(228)
        row.select.label:SetJustifyH("LEFT")
        row.angle = Label(body, "", 13, 706, y + 6, 70)
        row.toggle = Button(body, "", 794, y, 92, function()
            local marker = C.Profile().markers[id]
            if marker.icon == 0 then return end
            C.ClosePicker()
            C.SelectMarker(id)
            C.SetMarker(id, "enabled", not marker.enabled)
        end)
        panel.rows[id] = row
    end
    Surface(body, 410, 396, 476, 1, 0.35, 0.31, 0.19, 0.6)
    panel.selected = Label(body, "", 14, 410, 410, 476)
    Label(body, "Angle", 13, 410, 448, 220)
    panel.angleMinus = Button(body, "−", 704, 442, 36, function()
        C.SetMarker(C.selected, "angle", C.Profile().markers[C.selected].angle - 5)
    end)
    panel.angleValue = Label(body, "", 13, 760, 448, 76)
    panel.anglePlus = Button(body, "+", 850, 442, 36, function()
        C.SetMarker(C.selected, "angle", C.Profile().markers[C.selected].angle + 5)
    end)
    Label(body, "Distance from center", 13, 410, 484, 250)
    panel.radiusMinus = Button(body, "−", 704, 478, 36, function()
        C.SetMarker(C.selected, "radius", C.Profile().markers[C.selected].radius - 0.05)
    end)
    panel.radiusValue = Label(body, "", 13, 760, 484, 76)
    panel.radiusPlus = Button(body, "+", 850, 478, 36, function()
        C.SetMarker(C.selected, "radius", C.Profile().markers[C.selected].radius + 0.05)
    end)
    panel.distribute = Button(body, "Distribute evenly", 410, 520, 220, C.Distribute)
    panel.cardinals = Button(body, "", 644, 520, 242, function()
        C.SetProfileValue("cardinals", not C.Profile().cardinals)
    end)
    local markerHint = Label(body, "Click a position or a numbered slot to choose a marker. Assigning a marker already in use moves it to the selected position.", 12, 410, 566, 476)
    markerHint:SetWordWrap(true)
    markerHint:SetTextColor(0.64, 0.64, 0.58)
    Heading(body, "Appearance", 12, 492, 365)
    panel.sizeSlider = Slider("Circle size", 520, "size", 160, 420, 10, 1)
    panel.iconSlider = Slider("Icon size", 556, "iconSize", 16, 64, 2, 1)
    panel.opacitySlider = Slider("Background", 592, "opacity", 0, 100, 5, 100)
    Surface(body, 12, 628, 874, 1, 0.35, 0.31, 0.19, 0.6)
    panel.status = Label(body, "", 12, 12, 642, 874)
    panel.status:SetWordWrap(true)
    Label(panel, "DarkWhisper Raid Tools  " .. ns.version, 11, 12, HEIGHT - 18, 340):SetTextColor(0.3, 0.72, 0.69)
    local footer = Label(panel, "/dwrt  ·  /acomp", 11, WIDTH - 180, HEIGHT - 18, 166)
    footer:SetJustifyH("RIGHT")
    footer:SetTextColor(0.6, 0.59, 0.52)
    CreatePicker()
    CreateLayoutMenu()
    panel:SetScript("OnHide", function(self)
        CommitName()
        self.name:ClearFocus()
        self:StopMovingOrSizing()
        C.CloseEditor()
    end)
    local function Fit()
        local scale = math.max(0.1, math.min(1, (UIParent:GetWidth() - 32) / WIDTH, (UIParent:GetHeight() - 32) / HEIGHT))
        panel:SetScale(scale)
        panel.scaleLabel:SetText("Scale: " .. math.floor(scale * 100 + 0.5) .. "% (auto)")
    end
    panel:RegisterEvent("DISPLAY_SIZE_CHANGED")
    panel:RegisterEvent("UI_SCALE_CHANGED")
    panel:SetScript("OnEvent", Fit)
    Fit()
end

SLASH_DARKWHISPERRAIDTOOLS1 = "/acomp"
SLASH_DARKWHISPERRAIDTOOLS2 = "/dwrt"
SlashCmdList.DARKWHISPERRAIDTOOLS = function()
    if not ns.ready then return end
    if not panel then CreatePanel() end
    panel:Show()
    C.Sample(true)
    C.Refresh()
end
