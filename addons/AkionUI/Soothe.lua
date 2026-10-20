local _, ns = ...
local SPELL_ID = 2908
local FILTER = "HELPFUL|INCLUDE_NAME_PLATE_ONLY|DISPELLABLE"
local BASE_FONT_SIZE = 28
local hud, driver, cooldownDuration, zeroDuration, countdownFormatter, readyFormatter
local watchers, units = {}, { "target", "focus", "mouseover" }
for i = 1, 40 do units[#units + 1] = "nameplate" .. i end
for i = 1, 5 do units[#units + 1] = "boss" .. i end

local function Secret(value)
    return issecretvalue and issecretvalue(value)
end

local function True(value)
    return not Secret(value) and value == true
end

local function KnowsSoothe()
    return ns.isDruid and C_SpellBook and C_SpellBook.IsSpellKnown
        and True(C_SpellBook.IsSpellKnown(SPELL_ID))
end

local function EnemyExists(unit)
    if not True(UnitExists(unit)) or not True(UnitCanAttack("player", unit)) then return false end
    local dead = UnitIsDeadOrGhost(unit)
    return not Secret(dead) and not dead
end

local function Text(parent, color)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(STANDARD_TEXT_FONT, BASE_FONT_SIZE, "OUTLINE")
    label:SetPoint("CENTER")
    label:SetTextColor(unpack(color))
    label:SetShadowOffset(1, -1)
    label:SetText("")
    return label
end

local function BindDuration(label, formatter, readyText)
    local binding = C_DurationUtil.CreateDurationTextBinding()
    binding:SetFontString(label)
    binding:SetDuration(cooldownDuration)
    binding:SetFormatter(formatter)
    binding:SetZeroDurationText(readyText)
    binding:SetExpiredText(readyText)
    binding:SetUpdateInterval(0.05)
    binding:SetEnabled(true)
    binding:UpdateFontString()
    return binding
end

local function CreateWatcher(unit)
    if watchers[unit] or not ns.isDruid or not AuraContainerInbound
        or not C_AuraContainerUtil or InCombatLockdown() then return end
    local container = CreateFrame("AuraContainer", nil, hud.visual, "CustomAuraContainerTemplate")
    container:SetAllPoints(hud.visual)
    container:EnableMouse(false)
    container:SetEnabled(false)
    -- All protected presentation is configured before the button is sealed.
    -- No aura reads, visibility hooks, sound callbacks, or later button access.
    local watcher = { container = container, active = false }
    watchers[unit] = watcher
    container:AddAuraSlot("enrage", FILTER, {
        candidateFilters = { includeDispelTypes = { Enrage = true, [""] = true } },
        initializeFrame = function(button)
            button:SetAllPoints(container)
            button:EnableMouse(false)
            local label = Text(button, { 1, 0.65, 0.08, 1 })
            if cooldownDuration then
                -- While Soothe is cooling down this label is empty. The
                -- independent countdown below supplies the complete line.
                -- Both bindings sample the SAME object, including secrets.
                watcher.binding = BindDuration(label, readyFormatter, "ENRAGE")
            else
                label:SetText("ENRAGE")
            end
        end,
    })
    container:SetUnit(unit)
end

local function SetWatchersEnabled(enabled)
    for unit, watcher in pairs(watchers) do
        local active = enabled and EnemyExists(unit) or false
        if active ~= watcher.active then
            watcher.active = active
            watcher.container:SetEnabled(active)
        end
    end
end

local function StopDragging(self)
    self:StopMovingOrSizing()
    if self.moving then
        self.moving = false
        local x, y = self:GetCenter()
        local centerX, centerY = UIParent:GetCenter()
        ns.db.sootheX, ns.db.sootheY = x - centerX, y - centerY
        self:ClearAllPoints()
        self:SetPoint("CENTER", UIParent, "CENTER", ns.db.sootheX, ns.db.sootheY)
    end
end

function ns.UpdateSoothe()
    if not hud then return end
    local editing = ns.sootheUnlocked == true
    local active = ns.isDruid and ns.db.sootheEnabled and KnowsSoothe() or false
    local dead = UnitIsDeadOrGhost("player")
    SetWatchersEnabled(active and not editing and not Secret(dead) and not dead)
    hud:SetShown(active or editing)
    hud.preview:SetShown(editing)
    hud.hint:SetShown(editing)
    hud.countdown:SetShown(active and not editing)
    if hud.binding then
        hud.binding:SetEnabled(active and not editing)
        if active and not editing then
            local duration = C_Spell and C_Spell.GetSpellCooldownDuration
                and C_Spell.GetSpellCooldownDuration(SPELL_ID, true)
            -- Keep the object that all bindings hold; copy actual game timing
            -- into it. Never branch on, format, or calculate a secret time.
            cooldownDuration:Assign(duration or zeroDuration)
            hud.binding:UpdateFontString()
        end
    end
end

function ns.ApplySootheSettings()
    if not hud then return end
    local scale = ns.db.sootheFontSize / BASE_FONT_SIZE
    hud:SetSize(360 * scale, 76 * scale)
    hud.visual:SetScale(scale)
    hud:EnableMouse(ns.sootheUnlocked == true)
    hud:SetFrameStrata(ns.sootheUnlocked and "TOOLTIP" or "HIGH")
    driver:SetShown(ns.isDruid and (ns.db.sootheEnabled or ns.sootheUnlocked == true))
    ns.UpdateSoothe()
end

function ns.SetSootheUnlocked(enabled)
    ns.sootheUnlocked = ns.isDruid and enabled and true or false
    if hud then StopDragging(hud) end
    ns.ApplySootheSettings()
    if ns.RefreshOptions then ns.RefreshOptions() end
end

function ns.PrintSootheStatus()
    if not DEFAULT_CHAT_FRAME then return end
    local message
    if not ns.isDruid then
        message = "The Soothe display is available to druids only."
    elseif not ns.db.sootheEnabled then
        message = "The Soothe display is disabled."
    elseif not KnowsSoothe() then
        message = "Soothe has not been learned."
    elseif not hud.binding then
        message = "The client does not support cooldown text."
    elseif not watchers.target then
        message = InCombatLockdown() and "Enrage tracking will start after combat."
            or "The client does not support enrage tracking."
    else
        message = "Text mode: ENRAGE while an enrage is present, ENRAGE: seconds while Soothe is on cooldown; otherwise hidden. No sound."
    end
    DEFAULT_CHAT_FRAME:AddMessage("AkionUI " .. ns.version .. ": " .. message)
end

function ns.CreateSootheTracker()
    hud = CreateFrame("Frame", "AkionUISootheHUD", UIParent)
    hud:Hide()
    hud:SetPoint("CENTER", UIParent, "CENTER", ns.db.sootheX, ns.db.sootheY)
    hud:SetClampedToScreen(true)
    hud:SetMovable(true)
    hud:RegisterForDrag("LeftButton")
    hud:SetScript("OnDragStart", function(self)
        if ns.sootheUnlocked then self.moving = true; self:StartMoving() end
    end)
    hud:SetScript("OnDragStop", StopDragging)
    hud:SetScript("OnHide", StopDragging)
    hud.visual = CreateFrame("Frame", nil, hud)
    hud.visual:SetSize(360, 76)
    hud.visual:SetPoint("CENTER", hud, "CENTER", 0, 0)
    hud.visual:EnableMouse(false)
    hud.countdown = Text(hud.visual, { 1, 0.65, 0.08, 1 })
    hud.preview = Text(hud.visual, { 0.44, 0.84, 1, 1 })
    hud.preview:SetText("ENRAGE: 8")
    hud.hint = hud.visual:CreateFontString(nil, "OVERLAY")
    hud.hint:SetFont(STANDARD_TEXT_FONT, 12, "OUTLINE")
    hud.hint:SetPoint("TOP", hud.preview, "BOTTOM", 0, -8)
    hud.hint:SetText("Drag text · close settings to lock")

    if C_DurationUtil and C_DurationUtil.CreateDuration and C_DurationUtil.CreateDurationTextBinding
        and C_StringUtil and C_StringUtil.CreateNumericRuleFormatter then
        cooldownDuration, zeroDuration = C_DurationUtil.CreateDuration(), C_DurationUtil.CreateDuration()
        countdownFormatter = C_StringUtil.CreateNumericRuleFormatter()
        countdownFormatter:AddBreakpoint({ threshold = 0, step = 1,
            rounding = Enum.NumericRuleFormatRounding.Up, format = "ENRAGE: %d" })
        readyFormatter = C_StringUtil.CreateNumericRuleFormatter()
        readyFormatter:AddBreakpoint({ threshold = 0, format = "" })
        -- Expired/zero cooldown renders nothing, even if its values are secret.
        hud.binding = BindDuration(hud.countdown, countdownFormatter, "")
    end

    driver = CreateFrame("Frame")
    local elapsedTotal = 0
    driver:SetScript("OnUpdate", function(_, elapsed)
        elapsedTotal = elapsedTotal + elapsed
        if elapsedTotal >= 0.2 then elapsedTotal = 0; ns.UpdateSoothe() end
    end)
    for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_REGEN_ENABLED", "SPELLS_CHANGED",
        "SPELL_UPDATE_COOLDOWN", "PLAYER_TARGET_CHANGED", "PLAYER_FOCUS_CHANGED",
        "UPDATE_MOUSEOVER_UNIT", "NAME_PLATE_UNIT_ADDED", "NAME_PLATE_UNIT_REMOVED",
        "PLAYER_DEAD", "PLAYER_ALIVE", "PLAYER_UNGHOST" }) do
        driver:RegisterEvent(event)
    end
    driver:SetScript("OnEvent", function(_, event, unit)
        if not ns.isDruid then return end
        if event == "NAME_PLATE_UNIT_ADDED" and not watchers[unit] then
            local exists = false
            for _, token in ipairs(units) do if token == unit then exists = true; break end end
            if not exists then units[#units + 1] = unit end
            CreateWatcher(unit)
        end
        if event == "PLAYER_ENTERING_WORLD" or event == "PLAYER_REGEN_ENABLED" then
            for _, token in ipairs(units) do CreateWatcher(token) end
        end
        for token, watcher in pairs(watchers) do
            if token == unit or event == "PLAYER_ENTERING_WORLD"
                or (token == "target" and event == "PLAYER_TARGET_CHANGED")
                or (token == "focus" and event == "PLAYER_FOCUS_CHANGED")
                or (token == "mouseover" and event == "UPDATE_MOUSEOVER_UNIT") then
                watcher.container:UpdateAllAuras()
            end
        end
        ns.UpdateSoothe()
    end)
    for _, unit in ipairs(units) do CreateWatcher(unit) end
    ns.ApplySootheSettings()
end
