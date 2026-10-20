local _, ns = ...
local hud

local function StopDragging(self)
    self:StopMovingOrSizing()
    if not self.moving then
        return
    end
    self.moving = false
    local x, y = self:GetCenter()
    local centerX, centerY = UIParent:GetCenter()
    ns.db.hudX, ns.db.hudY = x - centerX, y - centerY
    self:ClearAllPoints()
    self:SetPoint("CENTER", UIParent, "CENTER", ns.db.hudX, ns.db.hudY)
end

function ns.CreateHUD()
    hud = CreateFrame("Frame", "AkionUIMoonkinHUD", UIParent)
    hud:Hide()
    hud:SetSize(620, 80)
    hud:SetPoint("CENTER", UIParent, "CENTER", ns.db.hudX, ns.db.hudY)
    hud:SetFrameStrata("HIGH")
    hud:SetClampedToScreen(true)
    hud:SetMovable(true)
    hud:EnableMouse(false)
    hud:RegisterForDrag("LeftButton")
    hud:SetScript("OnDragStart", function(self)
        if ns.hudUnlocked then
            self.moving = true
            self:StartMoving()
        end
    end)
    hud:SetScript("OnDragStop", StopDragging)
    hud:SetScript("OnHide", StopDragging)

    hud.text = hud:CreateFontString(nil, "OVERLAY")
    hud.text:SetPoint("CENTER")
    hud.text:SetFont(STANDARD_TEXT_FONT, ns.db.fontSize, "OUTLINE")
    hud.text:SetShadowOffset(1, -1)

    hud.hint = hud:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    hud.hint:SetPoint("TOP", hud.text, "BOTTOM", 0, -6)
    hud.hint:SetText("Drag to move · close settings to lock")
    hud.hint:Hide()
end

function ns.SetHUDUnlocked(enabled)
    ns.hudUnlocked = enabled and ns.isBalanceDruid and true or false
    if hud then
        StopDragging(hud)
        ns.UpdateHUD()
    end
    if ns.RefreshOptions then
        ns.RefreshOptions()
    end
end

function ns.UpdateHUD()
    if not hud then
        return
    end
    hud.text:SetFont(STANDARD_TEXT_FONT, ns.db.fontSize, "OUTLINE")
    hud:EnableMouse(ns.hudUnlocked == true)
    hud:SetFrameStrata(ns.hudUnlocked and "TOOLTIP" or "HIGH")
    hud.hint:SetShown(ns.hudUnlocked == true)

    if not ns.isBalanceDruid then
        hud:Hide()
        return
    end
    if ns.hudUnlocked then
        -- A positioning label, not a live warning, while editing the layout.
        hud.text:SetText("Move Moonkin warning")
        hud.text:SetTextColor(0.44, 0.84, 1)
        hud:Show()
        return
    end
    if not ns.db.enabled then
        hud:Hide()
        return
    end

    -- Use the player's stance, not aura data or a form's action-bar index.
    local formID = GetShapeshiftFormID()
    if issecretvalue and issecretvalue(formID) then
        -- Never compare secrets or mistake an unknown form for a missing form.
        hud:Hide()
        return
    end
    -- Blizzard's Mainline constants cover both Moonkin form variants.
    local inMoonkin = formID == (DRUID_MOONKIN_FORM_1 or 31)
        or formID == (DRUID_MOONKIN_FORM_2 or 35)
    if inMoonkin then
        hud:Hide()
        return
    end
    hud.text:SetText("NOT IN MOONKIN FORM!")
    hud.text:SetTextColor(1, 0.25, 0.2)
    hud:Show()
end
