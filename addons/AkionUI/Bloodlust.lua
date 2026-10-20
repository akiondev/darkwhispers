local _, ns = ...
local icon, driver
local lastExpiration, lastDuration
local WHITE = "Interface\\Buttons\\WHITE8X8"
local LOCKOUTS = { 57724, 57723, 80354, 95809, 160455, 264689, 390435 }

local function IsSecret(value)
    return issecretvalue and issecretvalue(value)
end

local function ReadLockout(now)
    if not C_UnitAuras or not C_UnitAuras.GetPlayerAuraBySpellID
        or not C_Secrets or not C_Secrets.ShouldSpellAuraBeSecret then
        return "unknown"
    end
    local unknown, expiration, duration = false, nil, nil
    for _, spellID in ipairs(LOCKOUTS) do
        -- A nil lookup is only evidence of absence when this specific aura is readable.
        if C_Secrets.ShouldSpellAuraBeSecret(spellID) then
            unknown = true
        else
            local aura = C_UnitAuras.GetPlayerAuraBySpellID(spellID)
            if IsSecret(aura) then
                unknown = true
            elseif aura then
                local ends, length = aura.expirationTime, aura.duration
                if IsSecret(ends) or IsSecret(length) then
                    unknown = true
                elseif type(ends) ~= "number" or type(length) ~= "number"
                    or ends <= 0 or length <= 0 or ends ~= ends or length ~= length
                    or ends == math.huge or length == math.huge then
                    unknown = true
                elseif ends > now and (not expiration or ends > expiration) then
                    expiration, duration = ends, length
                end
            end
        end
    end
    if expiration then
        return "cooldown", expiration, duration
    end
    return unknown and "unknown" or "ready"
end

local function StopDragging(self)
    self:StopMovingOrSizing()
    if self.moving then
        self.moving = false
        local x, y = self:GetCenter()
        local centerX, centerY = UIParent:GetCenter()
        ns.db.bloodlustX, ns.db.bloodlustY = x - centerX, y - centerY
        self:ClearAllPoints()
        self:SetPoint("CENTER", UIParent, "CENTER", ns.db.bloodlustX, ns.db.bloodlustY)
    end
end

local function SetGlow(shown)
    icon.glow:SetShown(shown)
    if shown then
        if not icon.pulse:IsPlaying() then icon.pulse:Play() end
    else
        icon.pulse:Stop()
    end
end

function ns.UpdateBloodlust()
    if not icon then return end
    if not ns.db.bloodlustEnabled and not ns.bloodlustUnlocked then
        SetGlow(false)
        icon:Hide()
        return
    end

    local now = GetTime()
    local status, expiration, duration = ReadLockout(now)
    -- Editing does not invent or change the actual lockout.
    icon.status = status
    if ns.bloodlustUnlocked then
        status, expiration, duration = "edit", nil, nil
    end
    local shown = status ~= "ready" or ns.db.bloodlustShowReady
    icon:SetShown(shown)
    SetGlow(shown and status == "ready" and ns.db.bloodlustGlow)
    icon.art:SetDesaturated(status == "cooldown" or status == "unknown")
    if status == "cooldown" then
        if expiration ~= lastExpiration or duration ~= lastDuration then
            icon.cooldown:SetCooldown(expiration - duration, duration)
        end
        icon.cooldown:Show()
        local remaining = math.max(0, math.ceil(expiration - now))
        icon.timer:SetText(string.format("%d:%02d", math.floor(remaining / 60), remaining % 60))
        icon.timer:SetTextColor(1, 1, 1)
        icon:SetBackdropBorderColor(0.4, 0.45, 0.5, 1)
    else
        icon.cooldown:Clear()
        icon.cooldown:Hide()
        if status == "ready" then
            icon.timer:SetText("READY")
            icon.timer:SetTextColor(0.3, 1, 0.55)
            icon:SetBackdropBorderColor(0.3, 1, 0.55, 1)
        elseif status == "edit" then
            icon.timer:SetText("DRAG")
            icon.timer:SetTextColor(0, 0.79, 0.9)
            icon:SetBackdropBorderColor(0, 0.79, 0.9, 1)
        else
            icon.timer:SetText("?")
            icon.timer:SetTextColor(1, 0.75, 0.2)
            icon:SetBackdropBorderColor(1, 0.75, 0.2, 1)
        end
    end
    lastExpiration, lastDuration = expiration, duration
end

function ns.ApplyBloodlustSettings()
    if not icon then return end
    local size = ns.db.bloodlustSize
    icon:SetSize(size, size)
    icon.timer:SetFont(STANDARD_TEXT_FONT, math.max(10, math.floor(size * 0.22)), "OUTLINE")
    icon.caption:SetFont(STANDARD_TEXT_FONT, math.max(10, math.floor(size * 0.16)), "OUTLINE")
    icon:EnableMouse(ns.bloodlustUnlocked == true)
    icon:SetFrameStrata(ns.bloodlustUnlocked and "TOOLTIP" or "HIGH")
    driver:SetShown(ns.db.bloodlustEnabled or ns.bloodlustUnlocked == true)
    ns.UpdateBloodlust()
end

function ns.SetBloodlustUnlocked(enabled)
    ns.bloodlustUnlocked = enabled and true or false
    if icon then StopDragging(icon) end
    ns.ApplyBloodlustSettings()
    if ns.RefreshOptions then ns.RefreshOptions() end
end

function ns.CreateBloodlustTracker()
    icon = CreateFrame("Frame", "AkionUIBloodlustIcon", UIParent, "BackdropTemplate")
    icon:Hide()
    icon:SetPoint("CENTER", UIParent, "CENTER", ns.db.bloodlustX, ns.db.bloodlustY)
    icon:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 2 })
    icon:SetBackdropColor(0.03, 0.04, 0.05, 1)
    icon:SetClampedToScreen(true)
    icon:SetMovable(true)
    icon:RegisterForDrag("LeftButton")
    icon:SetScript("OnDragStart", function(self)
        if ns.bloodlustUnlocked then
            self.moving = true
            self:StartMoving()
        end
    end)
    icon:SetScript("OnDragStop", StopDragging)
    icon:SetScript("OnHide", function(self)
        StopDragging(self)
        if self.pulse then self.pulse:Stop() end
    end)

    icon.art = icon:CreateTexture(nil, "ARTWORK")
    icon.art:SetPoint("TOPLEFT", 3, -3)
    icon.art:SetPoint("BOTTOMRIGHT", -3, 3)
    icon.art:SetTexture("Interface\\Icons\\Spell_Nature_BloodLust")
    icon.art:SetTexCoord(0.07, 0.93, 0.07, 0.93)

    icon.glow = CreateFrame("Frame", nil, icon, "BackdropTemplate")
    icon.glow:SetPoint("TOPLEFT", -5, 5)
    icon.glow:SetPoint("BOTTOMRIGHT", 5, -5)
    icon.glow:SetBackdrop({ edgeFile = WHITE, edgeSize = 3 })
    icon.glow:SetBackdropBorderColor(0.15, 1, 0.45, 0.75)
    icon.glow:EnableMouse(false)
    icon.pulse = icon.glow:CreateAnimationGroup()
    icon.pulse:SetLooping("BOUNCE")
    local alpha = icon.pulse:CreateAnimation("Alpha")
    alpha:SetOrder(1)
    alpha:SetFromAlpha(0.3)
    alpha:SetToAlpha(1)
    alpha:SetDuration(0.9)
    alpha:SetSmoothing("IN_OUT")

    icon.cooldown = CreateFrame("Cooldown", nil, icon, "CooldownFrameTemplate")
    icon.cooldown:SetPoint("TOPLEFT", 3, -3)
    icon.cooldown:SetPoint("BOTTOMRIGHT", -3, 3)
    icon.cooldown:SetDrawEdge(false)
    icon.cooldown:SetSwipeColor(0, 0, 0, 0.72)
    icon.cooldown:SetHideCountdownNumbers(true)
    icon.cooldown:EnableMouse(false)
    icon.cooldown.noCooldownCount = true -- Do not duplicate our text via cooldown-text addons.

    local textLayer = CreateFrame("Frame", nil, icon)
    textLayer:SetAllPoints(icon)
    textLayer:SetFrameLevel(icon.cooldown:GetFrameLevel() + 1)
    textLayer:EnableMouse(false)
    icon.timer = textLayer:CreateFontString(nil, "OVERLAY")
    icon.timer:SetPoint("CENTER")
    icon.caption = textLayer:CreateFontString(nil, "OVERLAY")
    icon.caption:SetFont(STANDARD_TEXT_FONT, 11, "OUTLINE")
    icon.caption:SetPoint("TOP", icon, "BOTTOM", 0, -5)
    icon.caption:SetText("BL / HERO")

    -- Keep polling even when 'hide when ready' hides the icon. No combat-log access,
    -- protected aura iteration, or guessed 10-minute timers are needed.
    driver = CreateFrame("Frame")
    local elapsedTotal = 0
    driver:SetScript("OnUpdate", function(self, elapsed)
        elapsedTotal = elapsedTotal + elapsed
        if elapsedTotal >= 0.25 then
            elapsedTotal = 0
            ns.UpdateBloodlust()
        end
    end)
    ns.ApplyBloodlustSettings()
end
