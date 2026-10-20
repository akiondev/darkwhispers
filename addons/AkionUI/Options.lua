local _, ns = ...
local panel
local activePage = "moonkin"

local FONT = "Fonts\\ARIALN.TTF"
local WHITE = "Interface\\Buttons\\WHITE8X8"
local WIDTH, HEIGHT, SIDEBAR = 980, 640, 220
local colors = {
    background = { 0.065, 0.077, 0.086, 0.99 },
    sidebar = { 0.045, 0.057, 0.063, 1 },
    row = { 0.078, 0.095, 0.104, 1 },
    border = { 0.18, 0.23, 0.25, 1 },
    accent = { 0, 0.79, 0.9, 1 },
    text = { 0.93, 0.96, 0.97, 1 },
    muted = { 0.52, 0.59, 0.62, 1 },
}

local function Label(parent, text, size, x, y, width, color)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(FONT, size, "")
    label:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    label:SetWidth(width)
    label:SetJustifyH("LEFT")
    label:SetTextColor(unpack(color or colors.text))
    label:SetText(text)
    return label
end

local function Rectangle(parent, x, y, width, height, color, layer)
    local texture = parent:CreateTexture(nil, layer or "BACKGROUND")
    texture:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    texture:SetSize(width, height)
    texture:SetColorTexture(unpack(color))
    return texture
end

local function Box(kind, name, parent, width, height, color)
    local box = CreateFrame(kind, name, parent, "BackdropTemplate")
    box:SetSize(width, height)
    box:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    box:SetBackdropColor(unpack(color or colors.row))
    box:SetBackdropBorderColor(unpack(colors.border))
    return box
end

local function Button(parent, text, width, height, onClick)
    local button = Box("Button", nil, parent, width, height, colors.sidebar)
    button.label = Label(button, text, 15, 0, 0, width, colors.muted)
    button.label:ClearAllPoints()
    button.label:SetPoint("CENTER")
    button.label:SetJustifyH("CENTER")
    button:SetScript("OnClick", onClick)
    button:SetScript("OnEnter", function(self)
        if self:IsEnabled() then
            self:SetBackdropBorderColor(unpack(colors.accent))
            self.label:SetTextColor(unpack(colors.text))
        end
    end)
    button:SetScript("OnLeave", function(self)
        self:SetBackdropBorderColor(unpack(colors.border))
        self.label:SetTextColor(unpack(colors.muted))
    end)
    return button
end

local function Toggle(parent, onClick)
    local toggle = CreateFrame("CheckButton", nil, parent)
    toggle:SetSize(42, 22)
    toggle:SetPoint("RIGHT", parent, "RIGHT", -22, 0)
    toggle.track = Rectangle(toggle, 0, 0, 42, 22, colors.border)
    toggle.thumb = Rectangle(toggle, 2, 2, 18, 18, colors.text, "ARTWORK")
    function toggle:Refresh(checked, enabled)
        self:SetChecked(checked)
        self:SetEnabled(enabled)
        self:SetAlpha(enabled and 1 or 0.35)
        self.track:SetColorTexture(unpack(checked and colors.accent or colors.border))
        self.thumb:ClearAllPoints()
        self.thumb:SetPoint("TOPLEFT", self, "TOPLEFT", checked and 22 or 2, -2)
    end
    toggle:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
        ns.RefreshOptions()
    end)
    return toggle
end

local function SizeSlider(parent, minimum, maximum, onChanged)
    local valueBox = Box("Frame", nil, parent, 48, 28, colors.sidebar)
    valueBox:SetPoint("RIGHT", -22, 0)
    local valueLabel = Label(valueBox, "", 16, 0, 5, 48)
    valueLabel:SetJustifyH("CENTER")
    local slider = CreateFrame("Slider", nil, parent)
    slider:SetOrientation("HORIZONTAL")
    slider:EnableMouse(true)
    slider:SetSize(198, 22)
    slider:SetPoint("RIGHT", valueBox, "LEFT", -18, 0)
    slider:SetMinMaxValues(minimum, maximum)
    slider:SetValueStep(1)
    slider:SetObeyStepOnDrag(true)
    Rectangle(slider, 0, 9, 198, 4, colors.border)
    local fill = Rectangle(slider, 0, 9, 1, 4, colors.accent, "ARTWORK")
    local thumb = slider:CreateTexture(nil, "OVERLAY")
    thumb:SetSize(12, 18)
    thumb:SetColorTexture(unpack(colors.accent))
    slider:SetThumbTexture(thumb)
    local function Paint(value)
        valueLabel:SetText(tostring(value))
        fill:SetWidth(math.max(1, 198 * (value - minimum) / (maximum - minimum)))
    end
    slider:SetScript("OnValueChanged", function(self, value)
        value = math.floor(value + 0.5)
        Paint(value)
        onChanged(value)
    end)
    function slider:Refresh(value)
        self:SetValue(value)
        Paint(value)
    end
    return slider
end

local function CreateOptions()
    local frame = Box("Frame", "AkionUIOptionsFrame", UIParent, WIDTH, HEIGHT, colors.background)
    frame:Hide()
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetClampedToScreen(true)
    frame:EnableMouse(true)
    frame:SetMovable(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetScript("OnHide", function(self)
        self:StopMovingOrSizing()
        ns.SetHUDUnlocked(false)
        ns.SetBloodlustUnlocked(false)
        ns.SetSootheUnlocked(false)
    end)

    local function FitToScreen()
        local scale = math.min(1, (UIParent:GetWidth() - 40) / WIDTH, (UIParent:GetHeight() - 40) / HEIGHT)
        frame:SetScale(math.max(0.1, scale))
    end
    frame:RegisterEvent("DISPLAY_SIZE_CHANGED")
    frame:RegisterEvent("UI_SCALE_CHANGED")
    frame:SetScript("OnEvent", FitToScreen)

    Rectangle(frame, 1, 1, SIDEBAR - 1, HEIGHT - 2, colors.sidebar)
    Rectangle(frame, SIDEBAR, 1, WIDTH - SIDEBAR - 1, 111, { 0.065, 0.105, 0.115, 1 })
    Rectangle(frame, SIDEBAR, 1, 1, HEIGHT - 2, colors.border, "BORDER")
    Rectangle(frame, 1, 111, WIDTH - 2, 1, { 0, 0.79, 0.9, 0.3 }, "BORDER")
    Rectangle(frame, SIDEBAR, 157, WIDTH - SIDEBAR - 1, 1, colors.border, "BORDER")
    Rectangle(frame, SIDEBAR, 576, WIDTH - SIDEBAR - 1, 1, colors.border, "BORDER")

    local mark = Box("Frame", nil, frame, 36, 36, { 0, 0.2, 0.22, 1 })
    mark:SetPoint("TOPLEFT", 22, -30)
    mark:SetBackdropBorderColor(unpack(colors.accent))
    local monogram = Label(mark, "A", 28, 0, 2, 36, colors.accent)
    monogram:SetJustifyH("CENTER")
    Label(frame, "AkionUI", 28, 68, 32, 146)
    Label(frame, "YOUR PERSONAL INTERFACE", 11, 23, 81, 190, colors.muted)

    Label(frame, "SETTINGS", 12, 22, 139, 176, colors.muted)
    local selection = Rectangle(frame, 1, 164, SIDEBAR - 1, 48, { 0.045, 0.14, 0.17, 1 })
    local selectionEdge = Rectangle(frame, 1, 164, 3, 48, colors.accent, "BORDER")
    local function Navigation(text, page, y)
        local button = CreateFrame("Button", nil, frame)
        button:SetSize(SIDEBAR - 2, 48)
        button:SetPoint("TOPLEFT", 1, -y)
        button.label = Label(button, text, 17, 23, 15, 190, colors.text)
        button:SetScript("OnClick", function()
            if activePage ~= page then
                ns.SetHUDUnlocked(false)
                ns.SetBloodlustUnlocked(false)
                ns.SetSootheUnlocked(false)
                activePage = page
            end
            ns.RefreshOptions()
        end)
        return button
    end
    local moonkinNav = Navigation("Moonkin warning", "moonkin", 164)
    local bloodlustNav = Navigation("Bloodlust / Heroism", "bloodlust", 212)
    local sootheNav = Navigation("Soothe", "soothe", 260)

    local moveButton = Button(frame, "Unlock HUD", 176, 36, function()
        if activePage == "bloodlust" then
            ns.SetBloodlustUnlocked(not ns.bloodlustUnlocked)
        elseif activePage == "soothe" then
            ns.SetSootheUnlocked(not ns.sootheUnlocked)
        else
            ns.SetHUDUnlocked(not ns.hudUnlocked)
        end
    end)
    moveButton:SetPoint("TOPLEFT", 22, -328)
    Label(frame, "Drag your HUD into position.\nClose settings to lock it.", 13, 23, 377, 177, colors.muted)
    local audience = Label(frame, "", 12, 23, 536, 177, colors.accent)
    Label(frame, "Your interface. Your choices.", 13, 23, 557, 177, colors.muted)
    Label(frame, "v" .. ns.version, 12, 23, 608, 177, colors.muted)

    local heading = Label(frame, "", 32, 252, 30, 620)
    local subtitle = Label(frame, "", 15, 253, 77, 650, colors.muted)
    local close = Button(frame, "×", 30, 30, function() frame:Hide() end)
    close:SetPoint("TOPRIGHT", -16, -16)
    Label(frame, "General", 16, 252, 130, 100)
    Rectangle(frame, 252, 156, 57, 2, colors.accent, "BORDER")
    local moonkinPage = CreateFrame("Frame", nil, frame)
    moonkinPage:SetAllPoints(frame)
    local bloodlustPage = CreateFrame("Frame", nil, frame)
    bloodlustPage:SetAllPoints(frame)
    bloodlustPage:Hide()
    local soothePage = CreateFrame("Frame", nil, frame)
    soothePage:SetAllPoints(frame)
    soothePage:Hide()
    Label(moonkinPage, "MOONKIN FORM", 12, 252, 185, 400, colors.muted)
    Label(bloodlustPage, "YOUR BLOODLUST LOCKOUT", 12, 252, 185, 400, colors.muted)
    Label(soothePage, "SOOTHE · COOLDOWN AND ENRAGE", 12, 252, 185, 500, colors.muted)

    local function Row(parent, y, title, description)
        local row = CreateFrame("Frame", nil, parent)
        row:SetSize(696, 66)
        row:SetPoint("TOPLEFT", 252, -y)
        Rectangle(row, 0, 0, 696, 66, colors.row)
        Label(row, title, 16, 18, 12, 320)
        Label(row, description, 13, 18, 37, 340, colors.muted)
        return row
    end

    local enabled = Toggle(Row(moonkinPage, 211, "Enable warning", "Shown when you are not in Moonkin Form."), function(checked)
        ns.db.enabled = checked
        ns.UpdateHUD()
    end)
    local unlock = Toggle(Row(moonkinPage, 282, "Move text", "Unlock and drag the text on screen."), function(checked)
        ns.SetHUDUnlocked(checked)
    end)
    local preview = Box("Frame", nil, moonkinPage, 696, 112, colors.sidebar)
    preview:SetPoint("TOPLEFT", 252, -440)
    Label(preview, "PREVIEW", 11, 16, 12, 280, colors.muted)
    local sample = preview:CreateFontString(nil, "OVERLAY")
    sample:SetFont(STANDARD_TEXT_FONT, ns.db.fontSize, "OUTLINE")
    sample:SetPoint("CENTER", 0, -8)
    sample:SetText("NOT IN MOONKIN FORM!")
    sample:SetTextColor(1, 0.25, 0.2)

    local size = SizeSlider(Row(moonkinPage, 353, "Text size", "Size of your HUD warning."), 16, 48, function(value)
        ns.db.fontSize = value
        sample:SetFont(STANDARD_TEXT_FONT, value, "OUTLINE")
        ns.UpdateHUD()
    end)
    local lustEnabled = Toggle(Row(bloodlustPage, 211, "Enable icon", "Tracks your lockout from all Bloodlust variants."), function(checked)
        ns.db.bloodlustEnabled = checked
        ns.ApplyBloodlustSettings()
    end)
    local lustUnlock = Toggle(Row(bloodlustPage, 282, "Move icon", "Unlock and drag the icon into position."), function(checked)
        ns.SetBloodlustUnlocked(checked)
    end)
    local lustSize = SizeSlider(Row(bloodlustPage, 353, "Icon size", "32–160. Timer text scales with the icon."), 32, 160, function(value)
        ns.db.bloodlustSize = value
        ns.ApplyBloodlustSettings()
    end)
    local lustReady = Toggle(Row(bloodlustPage, 424, "Show when ready", "Off: hide the icon until you have a BL lockout."), function(checked)
        ns.db.bloodlustShowReady = checked
        ns.UpdateBloodlust()
    end)
    local lustGlow = Toggle(Row(bloodlustPage, 495, "Glow when ready", "A green pulse when your lockout has ended."), function(checked)
        ns.db.bloodlustGlow = checked
        ns.UpdateBloodlust()
    end)

    local function SootheRow(y, title, description)
        local row = CreateFrame("Frame", nil, soothePage)
        row:SetSize(696, 46)
        row:SetPoint("TOPLEFT", 252, -y)
        Rectangle(row, 0, 0, 696, 46, colors.row)
        Label(row, title, 15, 18, 5, 320)
        Label(row, description, 12, 18, 26, 340, colors.muted)
        return row
    end
    local sootheEnabled = Toggle(SootheRow(211, "Enable Soothe", "All druid specs with Soothe learned."), function(checked)
        ns.db.sootheEnabled = checked
        ns.ApplySootheSettings()
    end)
    local sootheUnlock = Toggle(SootheRow(282, "Move text", "Drag the text. Close settings to lock it."), function(checked)
        ns.SetSootheUnlocked(checked)
    end)
    local sootheSample
    local sootheSize = SizeSlider(SootheRow(353, "Text size", "16–64. ENRAGE and countdown scale together."), 16, 64, function(value)
        ns.db.sootheFontSize = value
        if sootheSample then sootheSample:SetFont(STANDARD_TEXT_FONT, value, "OUTLINE") end
        ns.ApplySootheSettings()
    end)
    Label(soothePage, "PREVIEW", 11, 270, 429, 500, colors.muted)
    sootheSample = Label(soothePage, "ENRAGE: 8", ns.db.sootheFontSize, 270, 453, 650, { 1, 0.65, 0.08, 1 })
    Label(soothePage, "ENRAGE when an enrage is present. ENRAGE: seconds during Soothe cooldown.",
        13, 270, 530, 660, colors.muted)
    Label(soothePage, "Hidden when there is no enrage or cooldown. No sound.",
        13, 270, 552, 660, colors.muted)

    local status = Label(frame, "", 14, 252, 601, 484, colors.muted)
    local done = Button(frame, "Close", 152, 34, function() frame:Hide() end)
    done:SetPoint("BOTTOMRIGHT", -32, 16)
    done:SetBackdropBorderColor(unpack(colors.accent))
    done.label:SetTextColor(unpack(colors.accent))

    function ns.RefreshOptions()
        local isLust = activePage == "bloodlust"
        local isSoothe = activePage == "soothe"
        local isMoonkin = activePage == "moonkin"
        local canMove = isLust or (isSoothe and ns.isDruid) or (isMoonkin and ns.isBalanceDruid == true)
        local isUnlocked = (isLust and ns.bloodlustUnlocked) or (isSoothe and ns.sootheUnlocked)
            or (isMoonkin and ns.hudUnlocked)
        moonkinPage:SetShown(isMoonkin)
        bloodlustPage:SetShown(isLust)
        soothePage:SetShown(isSoothe)
        local selectionY = isSoothe and -260 or (isLust and -212 or -164)
        selection:ClearAllPoints()
        selection:SetPoint("TOPLEFT", frame, "TOPLEFT", 1, selectionY)
        selectionEdge:ClearAllPoints()
        selectionEdge:SetPoint("TOPLEFT", frame, "TOPLEFT", 1, selectionY)
        moonkinNav.label:SetTextColor(unpack(isMoonkin and colors.text or colors.muted))
        bloodlustNav.label:SetTextColor(unpack(isLust and colors.text or colors.muted))
        sootheNav.label:SetTextColor(unpack(isSoothe and colors.text or colors.muted))
        heading:SetText(isSoothe and "Soothe" or (isLust and "Bloodlust / Heroism" or "Moonkin warning"))
        subtitle:SetText(isSoothe and "Enrage warnings and your Soothe cooldown as text."
            or isLust and "All classes and factions · tracks your own 10-minute BL lockout."
            or "A reminder when your Balance druid is not in Moonkin Form.")
        audience:SetText(isSoothe and "DRUID / ALL SPECS" or (isLust and "ALL CLASSES / FACTIONS" or "DRUID / BALANCE"))
        enabled:Refresh(ns.db.enabled, true)
        unlock:Refresh(ns.hudUnlocked == true, ns.isBalanceDruid == true)
        moveButton:SetEnabled(canMove)
        moveButton:SetAlpha(canMove and 1 or 0.35)
        moveButton.label:SetText(isUnlocked and "Lock HUD" or "Unlock HUD")
        size:Refresh(ns.db.fontSize)
        sample:SetFont(STANDARD_TEXT_FONT, ns.db.fontSize, "OUTLINE")
        lustEnabled:Refresh(ns.db.bloodlustEnabled, true)
        lustUnlock:Refresh(ns.bloodlustUnlocked == true, true)
        lustSize:Refresh(ns.db.bloodlustSize)
        lustReady:Refresh(ns.db.bloodlustShowReady, true)
        lustGlow:Refresh(ns.db.bloodlustGlow, true)
        sootheEnabled:Refresh(ns.db.sootheEnabled, ns.isDruid)
        sootheUnlock:Refresh(ns.sootheUnlocked == true, ns.isDruid)
        sootheSize:Refresh(ns.db.sootheFontSize)
        sootheSample:SetFont(STANDARD_TEXT_FONT, ns.db.sootheFontSize, "OUTLINE")
        if isSoothe then
            status:SetText(isUnlocked and "Drag the text. Close settings to lock and save."
                or (ns.isDruid and "Saved automatically · text only, no sound or icon."
                    or "Available to druids who have learned Soothe."))
        elseif isLust then
            status:SetText(isUnlocked and "Drag the icon. Close settings to lock and save."
                or "READY = no personal BL lockout. Not a group cooldown.")
        elseif not ns.isBalanceDruid then
            status:SetText("Available when playing a Balance druid.")
        elseif ns.hudUnlocked then
            status:SetText("Drag the blue HUD text. Close settings to lock it.")
        else
            status:SetText("Saved automatically · active in and out of combat")
        end
    end
    frame:SetScript("OnShow", function()
        FitToScreen()
        ns.RefreshOptions()
    end)

    tinsert(UISpecialFrames, "AkionUIOptionsFrame")
    return frame
end

function ns.ToggleOptions()
    if not panel then
        panel = CreateOptions()
    end
    panel:SetShown(not panel:IsShown())
end
