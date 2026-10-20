-- Run from the repository root with Lua 5.1. WoW itself is still needed for visual/API QA.
local frames, state = {}, { class = "DRUID", spec = 102 }
local now, auras, restricted, auraReads = 1000, {}, {}, 0
local enemyAuraReads, durationObject, bindings = 0, {}, {}
local methods = {}
for _, name in ipairs({
    "SetSize", "SetWidth", "SetFrameStrata", "SetClampedToScreen", "SetMovable",
    "RegisterForDrag", "SetShadowOffset", "SetBackdrop", "SetBackdropColor",
    "SetBackdropBorderColor", "SetJustifyH", "SetMinMaxValues", "SetValueStep",
    "SetObeyStepOnDrag", "ClearAllPoints", "SetOrientation", "SetColorTexture",
    "SetThumbTexture", "SetAlpha", "SetAllPoints", "SetTexture", "SetTexCoord",
    "SetFrameLevel", "SetDrawEdge", "SetSwipeColor", "SetHideCountdownNumbers",
    "SetLooping", "SetFromAlpha", "SetToAlpha", "SetDuration", "SetSmoothing", "SetOrder",
    "SetCountdownFont", "SetWordWrap", "SetVertexColor", "SetAutoFocus", "SetMaxLetters", "SetTextInsets",
}) do
    methods[name] = function() end
end
function methods:SetSize(width, height) self.width, self.height = width, height end
function methods:SetWidth(width) assert(type(width) == "number"); self.width = width end
function methods:SetHeight(height) self.height = height end
function methods:SetBackdropBorderColor(...) self.border = {...} end
function methods:SetWordWrap(value) self.wrap = value end
function methods:SetTexture(path) self.texture = path end
function methods:GetWidth() return self.width or 1920 end
function methods:GetHeight() return self.height or 1080 end
function methods:GetFrameLevel() return 1 end
function methods:SetDesaturated(value) self.desaturated = value end
function methods:SetCooldown(start, duration)
    assert(type(start) == "number" and type(duration) == "number", "Cooldown needs readable times")
    self.cooldownStart, self.cooldownDuration = start, duration
end
function methods:Clear() self.cooldownStart, self.cooldownDuration = nil, nil end
function methods:SetCooldownFromDurationObject(duration, clearIfZero)
    assert(duration == durationObject and clearIfZero, "Pass the native duration through unchanged")
    self.durationObject = duration
end
function methods:SetUnit(unit) self.unit = unit end
function methods:UpdateAllAuras() self.refreshCount = (self.refreshCount or 0) + 1 end
function methods:AddAuraSlot(key, filter, options)
    assert(self.kind == "AuraContainer" and not state.combat, "Create native slots out of combat")
    assert(filter == "HELPFUL|INCLUDE_NAME_PLATE_ONLY|DISPELLABLE", "Only dispellable enemy buffs")
    local types = options.candidateFilters.includeDispelTypes
    assert(types.Enrage and types[""] and not types.Magic and not types.None, "Never confuse purge with Soothe")
    local button = CreateFrame("AuraButton", nil, self)
    options.initializeFrame(button)
    button.sealed = true
    setmetatable(button, { __index = function(frame, name)
        if methods[name] then error("Do not call or inspect an initialized aura button: " .. name) end
    end })
    for _, child in ipairs(frames) do
        if child.parent == button then
            setmetatable(child, { __index = function(_, name)
                if methods[name] then error("Do not touch protected aura children: " .. name) end
            end })
        end
    end
    self.slot = { key = key, filter = filter, options = options, button = button }
    return button
end
function methods:Play() self.playing = true end
function methods:Stop() self.playing = false end
function methods:IsPlaying() return self.playing == true end
function methods:SetScale(scale) self.scale = scale end
function methods:SetScript(name, callback) self.scripts[name] = callback end
function methods:RegisterEvent(name) self.events[name] = true end
function methods:UnregisterEvent(name) self.events[name] = nil end
function methods:SetPoint(_, relative, _, x, y)
    if type(relative) == "table" and x and y then
        local cx, cy = relative:GetCenter()
        self.x, self.y = cx + x, cy + y
    end
end
function methods:GetCenter() return self.x or 960, self.y or 540 end
function methods:GetEffectiveScale()
    return (self.scale or 1) * (self.parent and self.parent:GetEffectiveScale() or 1)
end
function methods:GetText() return self.valueText or "" end
function methods:HasFocus() return self.focused == true end
function methods:ClearFocus()
    local focused = self.focused
    self.focused = false
    if focused and self.scripts.OnEditFocusLost then self.scripts.OnEditFocusLost(self) end
end
function methods:EnableMouse(enabled) self.mouse = enabled end
function methods:EnableMouseWheel(enabled) self.mouseWheel = enabled end
function methods:StartMoving() self.dragging = true end
function methods:StopMovingOrSizing() self.dragging = false end
function methods:SetFont(font, size, flags)
    self.font, self.fontSize, self.fontFlags = font, size, flags
    return true
end
function methods:SetText(text)
    if self.kind == "FontString" and not self.font then
        error("FontString:SetText(): Font not set", 2)
    end
    self.valueText = text
end
function methods:SetTextColor(...) self.color = { ... } end
function methods:SetChecked(checked) self.checked = checked end
function methods:GetChecked() return self.checked end
function methods:SetEnabled(enabled) self.enabled = enabled end
function methods:IsEnabled() return self.enabled ~= false end
function methods:SetValue(value)
    if self.value ~= value then
        self.value = value
        if self.scripts.OnValueChanged then self.scripts.OnValueChanged(self, value) end
    end
end
function methods:SetShown(shown)
    shown = not not shown
    if self.shown ~= shown then
        self.shown = shown
        local callback = self.scripts[shown and "OnShow" or "OnHide"]
        if callback then callback(self) end
    end
end
function methods:Show() self:SetShown(true) end
function methods:Hide() self:SetShown(false) end
function methods:IsShown() return self.shown end
function CreateFrame(kind, name, parent)
    local frame = setmetatable({
        kind = kind, scripts = {}, events = {}, shown = true, parent = parent,
    }, { __index = methods })
    frames[#frames + 1] = frame
    if name then _G[name] = frame end
    return frame
end
function methods:CreateFontString(name, layer, template)
    local text = CreateFrame("FontString", name, self)
    text.font = template -- A font template supplies the inherited font in WoW.
    return text
end
function methods:CreateTexture() return CreateFrame("Texture", nil, self) end
function methods:CreateAnimationGroup() return CreateFrame("AnimationGroup", nil, self) end
function methods:CreateAnimation() return CreateFrame("Animation", nil, self) end
UIParent = CreateFrame("Frame")
UISpecialFrames, SlashCmdList = {}, {}
STANDARD_TEXT_FONT = "Fonts\\FRIZQT__.TTF"
tinsert = table.insert
DRUID_MOONKIN_FORM_1, DRUID_MOONKIN_FORM_2 = 31, 35
function UnitClass() return state.class, state.class end
function UnitExists(unit) return state.units and state.units[unit] ~= nil or false end
function UnitCanAttack(_, unit) return state.units[unit].hostile ~= false end
function UnitIsDeadOrGhost(unit)
    if unit == "player" then return state.dead or false end
    return state.units[unit].dead or false
end
function UnitName(unit) return state.units[unit].name or unit end
function PlaySoundFile(path, channel)
    error("Text-only Soothe must never play sound")
end
function GetShapeshiftFormID() return state.form end
function InCombatLockdown() return state.combat end
function GetTime() return now end
local secret = {}
function issecretvalue(value) return rawequal(value, secret) end
function durationObject:GetRemainingDuration() error("Soothe must not read cooldown values") end
Enum = { NumericRuleFormatRounding = { Up = 1 } }
C_StringUtil = { CreateNumericRuleFormatter = function()
    return { AddBreakpoint = function(self, rule) self.rule = rule end }
end }
local bindingMethods = {}
function bindingMethods:SetFontString(font) assert(font.font); self.font = font end
function bindingMethods:SetDuration(duration) self.duration = duration end
function bindingMethods:SetFormatter(formatter) self.formatter = formatter end
function bindingMethods:SetZeroDurationText(text) self.zeroText = text end
function bindingMethods:SetExpiredText(text) self.expiredText = text end
function bindingMethods:SetUpdateInterval(interval) self.interval = interval end
function bindingMethods:SetEnabled(enabled) self.enabled = enabled end
function bindingMethods:UpdateFontString()
    if not self.enabled then return end
    local duration, rule = self.duration, self.formatter.rule
    local remaining = (duration.endAt or now) - now
    local text
    if duration.isZero then text = self.zeroText
    elseif remaining <= 0 then text = self.expiredText
    elseif rule.format == "" then text = ""
    else
        assert(rule.step == 1 and rule.rounding == Enum.NumericRuleFormatRounding.Up)
        text = rule.format:format(math.ceil(remaining))
    end
    -- Simulate the native renderer, NOT an addon SetText on a protected child.
    self.font.valueText = text
end
C_DurationUtil = {
    CreateDuration = function()
        return { isZero = true, Assign = function(self, other)
            self.isZero, self.endAt, self.secret = other.isZero, other.endAt, other.secret
        end, GetRemainingDuration = function() error("No duration reads") end }
    end,
    CreateDurationTextBinding = function()
        local binding = setmetatable({}, { __index = bindingMethods })
        bindings[#bindings + 1] = binding
        return binding
    end,
}
C_SpecializationInfo = {
    GetSpecialization = function() return state.spec and 1 end,
    GetSpecializationInfo = function() return state.spec end,
}
C_Secrets = {
    ShouldSpellAuraBeSecret = function(id) return restricted[id] == true end,
    ShouldAurasBeSecret = function() return state.aurasSecret == true end,
}
C_SpellBook = { IsSpellKnown = function(id)
    assert(id == 2908)
    return state.sootheKnown ~= false
end }
C_Spell = {
    IsSpellUsable = function(id)
        assert(id == 2908)
        if state.usable == nil then return true end
        return state.usable
    end,
    IsSpellInRange = function(id, unit)
        assert(id == 2908)
        if state.units[unit].rangeUnknown then return nil end
        if state.units[unit].inRange == nil then return true end
        return state.units[unit].inRange
    end,
    GetSpellTexture = function(id) assert(id == 2908); return 132163 end,
    GetSpellCooldownDuration = function(id, ignoreGCD)
        assert(id == 2908 and ignoreGCD, "Soothe cooldown must ignore the GCD")
        if state.durationUnavailable then return nil end
        durationObject.endAt = state.cooldownEnd
        durationObject.isZero = state.cooldownEnd == nil
        durationObject.secret = state.cooldownSecret
        return durationObject
    end,
}
AuraContainerInbound, C_AuraContainerUtil = {}, {}
C_UnitAuras = { GetPlayerAuraBySpellID = function(id)
    assert(not restricted[id], "Must not query a restricted aura")
    auraReads = auraReads + 1
    return auras[id]
end }
C_UnitAuras.GetAuraDataByIndex = function(unit, index, filter)
    assert(not state.aurasSecret, "Never enumerate restricted enemy auras")
    assert(filter == "HELPFUL|INCLUDE_NAME_PLATE_ONLY|DISPELLABLE")
    enemyAuraReads = enemyAuraReads + 1
    return (state.units[unit].auras or {})[index]
end

local function fire(event, ...)
    for _, frame in ipairs(frames) do
        if frame.events[event] then frame.scripts.OnEvent(frame, event, ...) end
    end
end
local function tick(seconds)
    now = now + seconds
    for _, frame in ipairs(frames) do
        if frame.shown and frame.scripts.OnUpdate then frame.scripts.OnUpdate(frame, seconds) end
    end
    for _, binding in ipairs(bindings) do binding:UpdateFontString() end
end
local function loadAddon(saved)
    frames = { UIParent }
    bindings = {}
    AkionUIDB = saved
    UISpecialFrames, SlashCmdList = {}, {}
    local ns = {}
    for line in io.lines("AkionUI/AkionUI.toc") do
        line = line:gsub("\r$", "")
        if line:match("%.lua$") then assert(loadfile("AkionUI/" .. line))("AkionUI", ns) end
    end
    fire("ADDON_LOADED", "UnrelatedAddon")
    assert(not ns.db, "Other addons must not initialize AkionUI")
    fire("ADDON_LOADED", "AkionUI")
    fire("PLAYER_ENTERING_WORLD")
    return ns
end

local function loadRaidTools(saved, legacy, order)
    frames, bindings = { UIParent }, {}
    AkionUIDB, DarkWhisperRaidToolsDB = legacy, saved
    UISpecialFrames, SlashCmdList = {}, {}
    AkionUICompassOptions, AkionUICompassHUD = nil, nil
    DarkWhisperRaidToolsCompassOptions, DarkWhisperRaidToolsCompassHUD = nil, nil
    local raid, akion = {}, {}
    local function Load(name, namespace)
        for line in io.lines(name .. "/" .. name .. ".toc") do
            line = line:gsub("\r$", "")
            if line:match("%.lua$") then assert(loadfile(name .. "/" .. line))(name, namespace) end
        end
        fire("ADDON_LOADED", name)
    end
    if order == "akion-first" then Load("AkionUI", akion) end
    Load("DarkWhisperRaidTools", raid)
    assert(raid.db and not raid.ready, "Wait for all enabled addons before importing legacy settings")
    if order == "raid-first" then Load("AkionUI", akion) end
    fire("PLAYER_LOGIN")
    fire("PLAYER_ENTERING_WORLD")
    assert(raid.ready and raid.db == DarkWhisperRaidToolsDB)
    return raid, akion
end

local cases = 0
for _, class in ipairs({ "DRUID", "MAGE" }) do
    state.class = class
    local ns = loadAddon()
    for _, spec in ipairs({ 102, 103, 104, 105, false }) do
        state.spec = spec or nil
        fire("PLAYER_SPECIALIZATION_CHANGED", "player")
        for _, combat in ipairs({ false, true }) do
            state.combat = combat
            fire(combat and "PLAYER_REGEN_DISABLED" or "PLAYER_REGEN_ENABLED")
            for _, form in ipairs({ false, 1, 5, 31, 35 }) do
                state.form = form or nil
                for _, enabled in ipairs({ false, true }) do
                    ns.db.enabled = enabled
                    fire("UPDATE_SHAPESHIFT_FORM")
                    local expected = class == "DRUID" and spec == 102 and enabled and form ~= 31 and form ~= 35
                    assert(AkionUIMoonkinHUD:IsShown() == expected, "Visibility rule failed")
                    assert(not AkionUIMoonkinHUD.mouse, "Locked HUD must not intercept clicks")
                    cases = cases + 1
                end
            end
        end
    end
end

state = { class = "DRUID", spec = 102 }
local ns = loadAddon({ enabled = false, fontSize = 99, hudX = 125, hudY = -75 })
assert(ns.db.enabled == false and ns.db.fontSize == 48, "Saved settings must survive and clamp")
ns.db.enabled = true
state.form = secret
fire("UPDATE_SHAPESHIFT_FORM")
assert(not AkionUIMoonkinHUD:IsShown(), "Unknown form must not produce a false warning")
state.form = nil
fire("UPDATE_SHAPESHIFT_FORM")
assert(AkionUIMoonkinHUD:IsShown(), "Must recover when form data becomes available")

assert(SLASH_AKIONUI1 == "/akionui" and SLASH_AKIONUI2 == "/aui")
SlashCmdList.AKIONUI()
assert(AkionUIOptionsFrame:IsShown(), "Slash command opens settings")
assert(UISpecialFrames[1] == "AkionUIOptionsFrame", "Escape can close settings")
local optionsFrame = AkionUIOptionsFrame
SlashCmdList.AKIONUI()
assert(not optionsFrame:IsShown(), "Second slash command closes settings")
SlashCmdList.AKIONUI()
assert(AkionUIOptionsFrame == optionsFrame and optionsFrame:IsShown(), "Slash command reopens the existing menu")
UIParent:SetSize(800, 600)
fire("DISPLAY_SIZE_CHANGED")
assert(AkionUIOptionsFrame:GetWidth() * AkionUIOptionsFrame.scale <= 760, "Menu fits small viewports")
assert(AkionUIOptionsFrame:GetHeight() * AkionUIOptionsFrame.scale <= 560, "Menu fits available height")
UIParent:SetSize(1920, 1080)
fire("UI_SCALE_CHANGED")
assert(AkionUIOptionsFrame.scale == 1, "Menu returns to native size on larger screens")
local checks = {}
for _, frame in ipairs(frames) do
    if frame.kind == "CheckButton" then checks[#checks + 1] = frame end
end
checks[1]:SetChecked(false)
checks[1].scripts.OnClick(checks[1])
assert(not AkionUIMoonkinHUD:IsShown(), "GUI disable applies immediately")
checks[1]:SetChecked(true)
checks[1].scripts.OnClick(checks[1])
assert(AkionUIMoonkinHUD:IsShown(), "GUI enable applies immediately")

state.form = 31
fire("UPDATE_SHAPESHIFT_FORM")
checks[2]:SetChecked(true)
checks[2].scripts.OnClick(checks[2])
local hud = AkionUIMoonkinHUD
assert(hud:IsShown() and hud.mouse, "GUI unlock gives Moonkin players a drag handle")
hud.scripts.OnDragStart(hud)
hud.x, hud.y = 1060, 740
hud.scripts.OnDragStop(hud)
assert(ns.db.hudX == 100 and ns.db.hudY == 200, "Dragging saves center-relative position")
AkionUIOptionsFrame:Hide()
assert(not ns.hudUnlocked and not hud.mouse and not hud:IsShown(), "Closing settings restores live visibility")

SlashCmdList.AKIONUI()
ns.SetHUDUnlocked(true)
state.spec = 103
fire("PLAYER_SPECIALIZATION_CHANGED", "player")
assert(not hud:IsShown() and not ns.hudUnlocked and not checks[2].enabled, "Spec switch exits edit mode")
state.spec = 102
fire("PLAYER_SPECIALIZATION_CHANGED", "player")
assert(checks[2].enabled, "Returning to Balance enables positioning")
state.form = nil
fire("UPDATE_SHAPESHIFT_FORM")
assert(hud:IsShown(), "Returning to Balance restores warning")

local saved = ns.db
ns = loadAddon(saved)
local x, y = AkionUIMoonkinHUD:GetCenter()
assert(x == 1060 and y == 740 and not ns.hudUnlocked, "Reload restores position and locks HUD")
state.class = "MAGE"
ns = loadAddon()
ns.SetHUDUnlocked(true)
assert(not ns.hudUnlocked and not AkionUIMoonkinHUD:IsShown(), "Other classes cannot show an edit HUD")

-- Bloodlust tracks the player's lockout, regardless of class/faction or who cast it.
local lockouts = { 57724, 57723, 80354, 95809, 160455, 264689, 390435 }
local lustCases = 0
for _, class in ipairs({ "DRUID", "MAGE", "WARRIOR", "HUNTER", "EVOKER", "SHAMAN" }) do
    for _, faction in ipairs({ "Horde", "Alliance" }) do
        state.class, state.faction = class, faction
        auras, restricted = {}, {}
        ns = loadAddon()
        local lust = AkionUIBloodlustIcon
        assert(lust.status == "ready" and lust:IsShown() and lust.timer.valueText == "READY")
        assert(lust.pulse:IsPlaying() and not lust.mouse, "Ready icon glows and is click-through")
        for _, id in ipairs(lockouts) do
            auras = { [id] = { duration = 600, expirationTime = now + 600 } }
            tick(0.25)
            assert(lust.status == "cooldown" and lust.timer.valueText == "10:00")
            assert(lust.cooldown:IsShown() and not lust.pulse:IsPlaying())
            tick(60)
            assert(lust.timer.valueText == "9:00", "Countdown uses actual aura expiration")
            auras = {}
            tick(0.25)
            assert(lust.status == "ready", "Early removal/reset clears the lockout immediately")
            lustCases = lustCases + 1
        end
    end
end

local lust = AkionUIBloodlustIcon
auras = { [57724] = { duration = 600, expirationTime = now + 1 } }
tick(1)
assert(lust.status == "ready", "Expiration restores ready state")
restricted[57724] = true
tick(0.25)
assert(lust.status == "unknown" and lust.timer.valueText == "?" and not lust.pulse:IsPlaying())
restricted = {}
auras = { [57724] = secret }
tick(0.25)
assert(lust.status == "unknown", "Secret aura cannot be read or reported ready")
auras = { [57724] = { duration = 600, expirationTime = secret } }
tick(0.25)
assert(lust.status == "unknown", "Secret timing must never enter arithmetic")
auras = { [57724] = { duration = 0, expirationTime = 0 } }
tick(0.25)
assert(lust.status == "unknown", "Missing duration does not produce a guessed timer")
auras = {
    [57724] = { duration = 600, expirationTime = now + 300 },
    [80354] = { duration = 600, expirationTime = now + 480 },
}
tick(0.25)
assert(lust.timer.valueText == "8:00", "Overlapping lockouts use the longest remaining one")
ns = loadAddon(ns.db)
lust = AkionUIBloodlustIcon
assert(lust.timer.valueText == "8:00", "Reload reconstructs the timer from the active aura")
auras = {}
ns.db.bloodlustShowReady = false
ns.ApplyBloodlustSettings()
assert(not lust:IsShown(), "Ready icon may be hidden")
auras[57723] = { duration = 600, expirationTime = now + 600 }
tick(0.25)
assert(lust:IsShown() and lust.status == "cooldown", "Hidden ready icon still detects new lockouts")
ns.db.bloodlustEnabled = false
ns.ApplyBloodlustSettings()
local readsBefore = auraReads
tick(1)
assert(not lust:IsShown() and auraReads == readsBefore, "Disabling tracking also stops polling")
ns.db.bloodlustEnabled, ns.db.bloodlustShowReady = true, true
auras = {}
ns.ApplyBloodlustSettings()
ns.db.bloodlustGlow = false
ns.UpdateBloodlust()
assert(lust.timer.valueText == "READY" and not lust.pulse:IsPlaying(), "Glow is optional")

SlashCmdList.AKIONUI()
local bloodlustNav, moonkinNav, lustChecks, sliders = nil, nil, {}, {}
for _, frame in ipairs(frames) do
    if frame.label and frame.label.valueText == "Bloodlust / Heroism" then bloodlustNav = frame end
    if frame.label and frame.label.valueText == "Moonkin warning" then moonkinNav = frame end
    if frame.kind == "CheckButton" then lustChecks[#lustChecks + 1] = frame end
    if frame.kind == "Slider" then sliders[#sliders + 1] = frame end
end
bloodlustNav.scripts.OnClick(bloodlustNav)
lustChecks[4]:SetChecked(true)
lustChecks[4].scripts.OnClick(lustChecks[4])
assert(ns.bloodlustUnlocked and lust.mouse and lust:IsShown(), "All classes can unlock the BL icon")
lust.scripts.OnDragStart(lust)
lust.x, lust.y = 1250, 650
lust.scripts.OnDragStop(lust)
assert(ns.db.bloodlustX == 290 and ns.db.bloodlustY == 110, "Bloodlust position saves independently")
sliders[2]:SetValue(120)
assert(ns.db.bloodlustSize == 120 and lust:GetWidth() == 120, "Icon size updates from GUI")
moonkinNav.scripts.OnClick(moonkinNav)
assert(not ns.bloodlustUnlocked and not lust.mouse, "Page changes finish positioning")
bloodlustNav.scripts.OnClick(bloodlustNav)
ns.SetBloodlustUnlocked(true)
AkionUIOptionsFrame:Hide()
assert(not ns.bloodlustUnlocked and not lust.mouse, "Closing the menu locks the BL icon")
ns = loadAddon(ns.db)
lust = AkionUIBloodlustIcon
local lustX, lustY = lust:GetCenter()
assert(lustX == 1250 and lustY == 650 and lust:GetWidth() == 120, "BL size and position survive reload")
local auraAPI = C_UnitAuras
C_UnitAuras = nil
ns.UpdateBloodlust()
assert(lust.status == "unknown" and not lust.pulse:IsPlaying(), "Unavailable API must not imply ready")
C_UnitAuras = auraAPI

-- Soothe: the native renderer owns both protected aura visibility and timers.
-- This models the documented bindings; it does not replace live WoW visual QA.
local function visibleSootheText()
    for _, frame in ipairs(frames) do
        if frame.kind == "AuraContainer" and frame.slot then
            local unit, enrage = state.units and state.units[frame.unit], false
            if unit then
                enrage = unit.nativeEnrage == true
                for _, aura in ipairs(unit.auras or {}) do
                    if aura.dispelName == "Enrage" or aura.dispelName == "" then enrage = true end
                end
            end
            frame.slot.button.shown = frame.enabled and enrage
        end
    end
    for _, binding in ipairs(bindings) do binding:UpdateFontString() end
    local result = {}
    for _, frame in ipairs(frames) do
        if frame.kind == "FontString" and frame.valueText and frame.valueText ~= "" then
            local current, visible, inHUD = frame, true, false
            while current do
                if current.shown == false then visible = false end
                if current == AkionUISootheHUD then inHUD = true end
                current = current.parent
            end
            if visible and inHUD then result[frame.valueText] = true end
        end
    end
    return result
end
local function assertSootheText(expected)
    local shown = visibleSootheText()
    if expected then
        assert(shown[expected], "Missing Soothe text: " .. expected)
        shown[expected] = nil
    end
    assert(next(shown) == nil, "Soothe must not leave extra labels/countdowns on screen")
end

local sootheCases = 0
for _, class in ipairs({ "DRUID", "MAGE", "HUNTER" }) do
    for _, spec in ipairs({ 102, 103, 104, 105 }) do
        for _, known in ipairs({ false, true }) do
            state = { class = class, spec = spec, sootheKnown = known,
                units = { target = { nativeEnrage = true } } }
            ns = loadAddon()
            assertSootheText(class == "DRUID" and known and "ENRAGE" or nil)
            assert(not AkionUISootheHUD.mouse, "Locked text must pass through clicks")
            sootheCases = sootheCases + 1
        end
    end
end

for _, auraSecret in ipairs({ false, true }) do
    for _, enrage in ipairs({ false, true }) do
        for _, cooldown in ipairs({ false, true }) do
            state = { class = "DRUID", spec = 102, aurasSecret = auraSecret,
                cooldownSecret = auraSecret, cooldownEnd = cooldown and now + 8 or nil,
                units = { target = { nativeEnrage = enrage } } }
            ns = loadAddon()
            assertSootheText(cooldown and "ENRAGE: 8" or (enrage and "ENRAGE" or nil))
            assert(enemyAuraReads == 0, "Even public enemy auras are no longer scanned")
            sootheCases = sootheCases + 1
        end
    end
end

state = { class = "DRUID", spec = 102, aurasSecret = true, cooldownSecret = true, units = {} }
ns = loadAddon()
for _, unit in ipairs({ "target", "focus", "mouseover", "nameplate1", "nameplate40", "boss1", "boss5" }) do
    state.units = { [unit] = { nativeEnrage = true } }
    tick(0.2)
    assertSootheText("ENRAGE")
    state.units = {}
    tick(0.2)
    assertSootheText(nil)
    sootheCases = sootheCases + 1
end

-- Cast, remove the last enrage, count down, then disappear. Re-adding an enrage
-- during the cooldown must not overlay a second ENRAGE label.
state.units = { target = { nativeEnrage = true } }
tick(0.2)
state.cooldownEnd = now + 10
fire("SPELL_UPDATE_COOLDOWN")
assertSootheText("ENRAGE: 10")
state.units = {}
tick(1.1)
assertSootheText("ENRAGE: 9")
state.units = { focus = { nativeEnrage = true } }
tick(1)
assertSootheText("ENRAGE: 8")
tick(8)
assertSootheText("ENRAGE")
state.units = {}
tick(0.2)
assertSootheText(nil)

-- A reset and /reload use the actual duration, never a guessed ten seconds.
state.cooldownEnd = now + 37
fire("SPELL_UPDATE_COOLDOWN")
assertSootheText("ENRAGE: 37")
ns = loadAddon(ns.db)
assertSootheText("ENRAGE: 37")
state.cooldownEnd = nil
fire("SPELL_UPDATE_COOLDOWN")
assertSootheText(nil)
state.gcdEnd = now + 1.5
fire("SPELL_UPDATE_COOLDOWN")
assertSootheText(nil)
state.units = { target = { auras = { { dispelName = "Magic" } } } }
tick(0.2)
assertSootheText(nil)
state.units.target.auras = { {} }
tick(0.2)
assertSootheText(nil)
state.units.target.auras = { { dispelName = "" } }
tick(0.2)
assertSootheText("ENRAGE")
state.units.target.hostile = false
tick(0.2)
assertSootheText(nil)
state.units.target.hostile, state.units.target.dead = true, true
tick(0.2)
assertSootheText(nil)
state.units.target.dead, state.dead = false, true
tick(0.2)
assertSootheText(nil)
state.cooldownEnd = now + 7
fire("SPELL_UPDATE_COOLDOWN")
assertSootheText("ENRAGE: 7")
state.dead, state.cooldownEnd = false, nil
fire("PLAYER_ALIVE")
assertSootheText("ENRAGE")

-- Combat reload defers creation of native containers; the cooldown still works.
state = { class = "DRUID", spec = 103, combat = true, aurasSecret = true,
    cooldownEnd = now + 8, units = { nameplate51 = { nativeEnrage = true } } }
ns = loadAddon()
fire("NAME_PLATE_UNIT_ADDED", "nameplate51")
assertSootheText("ENRAGE: 8")
for _, frame in ipairs(frames) do assert(frame.kind ~= "AuraContainer") end
state.combat, state.cooldownEnd = false, nil
fire("PLAYER_REGEN_ENABLED")
assertSootheText("ENRAGE")

-- Settings migration retains position and never retains audio behavior.
state = { class = "DRUID", spec = 102, units = {} }
ns = loadAddon({ sootheSize = 120, sootheSound = true, sootheActionableSound = true,
    sootheSoundInterval = 5, sootheX = 140, sootheY = -170, sootheFontSize = 90 })
assert(ns.db.sootheFontSize == 64 and ns.db.sootheSize == nil)
assert(ns.db.sootheSound == nil and ns.db.sootheActionableSound == nil and ns.db.sootheSoundInterval == nil)
local soothe = AkionUISootheHUD
local sx, sy = soothe:GetCenter()
assert(sx == 1100 and sy == 370, "Existing Soothe position is preserved")
for _, frame in ipairs(frames) do
    local current = frame.parent
    while current do
        if current == soothe then
            assert(frame.kind ~= "Texture" and frame.kind ~= "Cooldown", "Text HUD has no icon or cooldown swipe")
        end
        current = current.parent
    end
end
SlashCmdList.AKIONUI()
local sootheNav, settingChecks, settingSliders, sample = nil, {}, {}, nil
for _, frame in ipairs(frames) do
    if frame.label and frame.label.valueText == "Soothe" then sootheNav = frame end
    if frame.kind == "CheckButton" then settingChecks[#settingChecks + 1] = frame end
    if frame.kind == "Slider" then settingSliders[#settingSliders + 1] = frame end
    if frame.kind == "FontString" and frame.valueText == "ENRAGE: 8" and frame ~= soothe.preview then sample = frame end
    assert(not frame.label or frame.label.valueText ~= "Test sound", "Audio test button removed")
end
assert(#settingChecks == 8 and #settingSliders == 3, "Only enable, move and text size for Soothe")
sootheNav.scripts.OnClick(sootheNav)
settingChecks[8]:SetChecked(true)
settingChecks[8].scripts.OnClick(settingChecks[8])
assert(ns.sootheUnlocked and soothe.mouse and soothe.preview.shown)
soothe.scripts.OnDragStart(soothe)
soothe.x, soothe.y = 1200, 680
soothe.scripts.OnDragStop(soothe)
assert(ns.db.sootheX == 240 and ns.db.sootheY == 140, "Unscaled anchor saves correct drag position")
state.combat = true
settingSliders[3]:SetValue(42)
assert(ns.db.sootheFontSize == 42 and soothe.visual.scale == 1.5 and sample.fontSize == 42)
AkionUIOptionsFrame:Hide()
assert(not ns.sootheUnlocked and not soothe.mouse, "Closing menu locks the text")
assertSootheText(nil)
state.combat = false
ns = loadAddon(ns.db)
soothe = AkionUISootheHUD
sx, sy = soothe:GetCenter()
assert(sx == 1200 and sy == 680 and soothe.visual.scale == 1.5 and not soothe.mouse)
state.units = { target = { nativeEnrage = true } }
state.cooldownEnd = now + 5
tick(0.2)
assertSootheText("ENRAGE: 5")
ns.db.sootheEnabled = false
ns.ApplySootheSettings()
assertSootheText(nil)
ns.db.sootheEnabled = true
ns.ApplySootheSettings()
assertSootheText("ENRAGE: 5")

-- Missing duration data clears stale countdown text without treating unknown
-- aura data as an enrage. /aui status remains safe and does not toggle the menu.
state.durationUnavailable = true
tick(0.2)
assertSootheText("ENRAGE")
state.units = {}
tick(0.2)
assertSootheText(nil)
local messages = {}
DEFAULT_CHAT_FRAME = { AddMessage = function(_, message) messages[#messages + 1] = message end }
ns.ToggleOptions = function() error("Status must not toggle the menu") end
SlashCmdList.AKIONUI(" status ")
assert(messages[#messages]:find("Text mode", 1, true))
assert(enemyAuraReads == 0)

-- The graphical compass edits independent saved layouts and uses only readable
-- headings. Exercise user actions, map transitions, persistence and HUD dragging.
state = { class = "WARRIOR", facing = 0, mapID = 101 }
local facingReads = 0
local function readTestFacing()
    facingReads = facingReads + 1
    return state.facing
end
GetPlayerFacing = readTestFacing
C_Map = { GetBestMapForUnit = function() return state.mapID end }
local cursorX, cursorY = 0, 0
GetCursorPosition = function() return cursorX, cursorY end
ns = loadRaidTools()
ns.ToggleOptions = function() error("Compass command must open its own panel") end
tick(1)
assert(facingReads == 0, "Disabled compass must not poll")
assert(SLASH_DARKWHISPERRAIDTOOLS1 == "/acomp")
SlashCmdList.DARKWHISPERRAIDTOOLS()
local C, menu, hud = ns.Compass, DarkWhisperRaidToolsCompassOptions, DarkWhisperRaidToolsCompassHUD
local function click(button) button.scripts.OnClick(button) end
local function selectLayout(index)
    click(menu.layoutButton)
    local dropdown = menu.layoutMenu
    for attempt = 1, #C.Config().layouts do
        for _, button in ipairs(dropdown.items) do
            if button:IsShown() and button.index == index then
                click(button)
                assert(not dropdown:IsShown() and C.Config().active == index)
                return
            end
        end
        dropdown.scripts.OnMouseWheel(dropdown, index <= dropdown.offset and 1 or -1)
    end
    error("Layout not reachable through the dropdown: " .. index)
end
assert(menu:IsShown() and not hud:IsShown())
assert(menu.markerCount.valueText:find("8 of 8", 1, true))
assert(#menu.rows == 8 and #C.Config().layouts == 1 and C.Profile().name == "Default")
assert(not menu.removeLayout:IsEnabled())
menu.name:SetText("Cannot replace Default")
menu.name.scripts.OnEnterPressed(menu.name)
click(menu.removeLayout)
assert(C.Profile().name == "Default" and #C.Config().layouts == 1)
click(menu.addLayout)
assert(C.Config().active == 2 and menu.removeLayout:IsEnabled())
for id = 1, 8 do C.AssignMarker(id, id) end

-- Edit north-up even if the player is turning; live preview is explicit.
state.facing = -math.pi / 2
tick(0.1)
local cx = C.preview:GetCenter()
local nx = C.preview.labels[1]:GetCenter()
assert(math.abs(nx - cx) < 0.001)
click(menu.liveButton)
nx = C.preview.labels[1]:GetCenter()
assert(nx < cx, "North moves left when the player turns right")
click(menu.northButton)
assert(C.Status():find("N", 1, true) and math.abs(C.Heading()) < 0.001)
state.facing = -math.pi
tick(0.1)
assert(math.abs(C.Heading() - 90) < 0.001)
click(menu.resetButton)
assert(math.abs(C.Heading() - 180) < 0.001)
click(menu.liveButton)

-- Dragging uses effective UI scale and stores polar coordinates in the layout.
menu:SetScale(0.75)
local px, py = C.preview:GetCenter()
local scale = C.preview:GetEffectiveScale()
cursorX, cursorY = (px + 300 * 0.39 * 0.5) * scale, py * scale
C.preview.markers[3].scripts.OnDragStart()
tick(0.1)
C.preview.markers[3].scripts.OnDragStop()
assert(C.selected == 3 and C.dragging == nil)
assert(C.Profile().markers[3].angle == 90)
assert(math.abs(C.Profile().markers[3].radius - 0.5) < 0.001)
click(menu.rows[3].toggle)
assert(not C.preview.markers[3]:IsShown() and not C.Profile().markers[3].enabled)
click(menu.rows[3].toggle)
click(menu.anglePlus)
assert(C.Profile().markers[3].angle == 95)
click(menu.radiusMinus)
assert(math.abs(C.Profile().markers[3].radius - 0.45) < 0.001)
menu.sizeSlider:SetValue(300)
menu.iconSlider:SetValue(44)
menu.opacitySlider:SetValue(45)
assert(C.Profile().size == 300 and C.Profile().iconSize == 44 and C.Profile().opacity == 0.45)
menu.name:SetText("Boss A")
menu.name.scripts.OnEnterPressed(menu.name)
click(menu.addLayout)
assert(C.Config().active == 3 and C.Profile().size == 240)
for id = 1, 8 do C.AssignMarker(id, id) end
for id = 4, 8 do click(menu.rows[id].toggle) end
click(menu.distribute)
assert(C.Profile().markers[1].angle == 0 and C.Profile().markers[2].angle == 120
    and C.Profile().markers[3].angle == 240)
selectLayout(2)
assert(C.Profile().name == "Boss A" and C.Profile().markers[3].angle == 95)

-- Enabling a separate HUD survives closing the editor; moving it is temporary.
click(menu.enableButton)
assert(hud:IsShown() and not hud.mouse)
click(menu.moveButton)
assert(C.unlocked and hud.mouse)
hud.scripts.OnDragStart(hud)
hud.x, hud.y = 1310, 750
hud.scripts.OnDragStop(hud)
assert(C.Config().x == 350 and C.Config().y == 210)
state.facing = 0.8
tick(0.1)
click(menu.northButton)
assert(math.abs(C.Heading()) < 0.001)
click(menu.closeButton)
assert(hud:IsShown() and not C.unlocked and not hud.mouse)
state.facing = 0.3
tick(0.1)
assert(C.Heading() > 20, "HUD keeps following direction after the menu closes")
local saved = ns.db
ns = loadRaidTools(saved)
C, hud = ns.Compass, DarkWhisperRaidToolsCompassHUD
assert(hud:IsShown() and C.Profile().name == "Boss A")
assert(C.Profile().markers[3].angle == 95 and C.Config().x == 350 and C.Config().y == 210)
assert(math.abs(C.Profile().north - 0.8) < 0.001 and C.Heading() > 20)
SlashCmdList.DARKWHISPERRAIDTOOLS()
menu = DarkWhisperRaidToolsCompassOptions
assert(menu.name:GetText() == "Boss A")

-- Protected/missing/error values remove live markers; static editing stays usable.
click(menu.liveButton)
for _, value in ipairs({ false, secret, math.huge, 0 / 0 }) do
    state.facing = value
    tick(0.1)
    assert(not C.preview:IsShown() and not hud.dial:IsShown())
    assert(not menu.northButton:IsEnabled())
end
state.facing = nil
tick(0.1)
assert(not C.preview:IsShown())
GetPlayerFacing = function() error(secret) end
tick(0.1)
assert(not hud.dial:IsShown())
GetPlayerFacing = nil
tick(0.1)
assert(not hud.dial:IsShown())
click(menu.liveButton)
assert(C.preview:IsShown(), "Manual layout editor works without heading access")
click(menu.rows[1].toggle)
assert(not C.Profile().markers[1].enabled)
click(menu.rows[1].toggle)
GetPlayerFacing, state.facing = readTestFacing, 0.8
tick(0.1)
assert(hud.dial:IsShown() and menu.northButton:IsEnabled())
state.mapID = 202
fire("ZONE_CHANGED_NEW_AREA")
assert(math.abs(C.Heading()) > 1, "Old north must not be used in a different map")
state.mapID = 101
fire("PLAYER_ENTERING_WORLD")
assert(math.abs(C.Heading()) < 0.001, "Reuse saved north in its original map")
click(menu.enableButton)
click(menu.closeButton)
local stoppedReads = facingReads
tick(1)
assert(facingReads == stoppedReads, "No polling with both editor and HUD closed")
assert(#messages == 1, "Compass does not spam chat")

-- Migrate old fixed-icon layouts to editable positions without changing the
-- user's names, angles, visibility or calibration.
ns = loadRaidTools({ compass = { enabled = false, layouts = {
    { name = "Boss Åke", size = 300, north = 0.8, northMap = "map:101",
      markers = { { angle = 37, radius = 0.4 }, { enabled = false, angle = 80 } } },
} } })
C, hud = ns.Compass, DarkWhisperRaidToolsCompassHUD
SlashCmdList.DARKWHISPERRAIDTOOLS()
menu = DarkWhisperRaidToolsCompassOptions
for id = 1, 8 do assert(C.Profile().markers[id].icon == id) end
assert(not C.Profile().markers[2].enabled and C.Profile().markers[2].angle == 80)
assert(C.Profile().name == "Boss Åke" and C.Profile().north == 0.8)
assert(menu.enableButton.label.valueText == "Enable compass")
click(menu.enableButton)
assert(hud:IsShown() and menu.enableButton.label.valueText == "Disable compass")

-- Editing a live preview returns to a stable north-up view. Selecting an icon
-- already assigned elsewhere moves it; the destination keeps its coordinates.
click(menu.liveButton)
click(menu.rows[1].select)
assert(not C.live and menu.picker:IsShown() and menu.picker.slot == 1)
click(menu.picker.choices[8])
local markers = C.Profile().markers
assert(not menu.picker:IsShown() and markers[1].icon == 8 and markers[1].enabled)
assert(markers[1].angle == 37 and markers[1].radius == 0.4)
assert(markers[8].icon == 0 and not markers[8].enabled)
assert(C.preview.markers[1].icon.texture == "Interface\\TargetingFrame\\UI-RaidTargetingIcon_8")
assert(hud.dial.markers[1].icon.texture == C.preview.markers[1].icon.texture)
assert(C.preview.markers[8]:IsShown() and C.preview.markers[8].slotNumber:IsShown())
assert(C.preview.markers[8].slotNumber.valueText == "8" and not hud.dial.markers[8]:IsShown())
assert(not menu.rows[8].toggle:IsShown() and menu.rows[8].icon.texture == nil)

-- A replacement also clears a hidden copy. The displaced old icon becomes
-- available again, and choosing the same icon twice is harmless.
click(C.preview.markers[1])
click(menu.picker.choices[2])
assert(markers[1].icon == 2 and markers[2].icon == 0 and not markers[2].enabled)
click(menu.rows[1].select)
click(menu.picker.choices[2])
assert(markers[1].icon == 2 and markers[1].angle == 37 and markers[1].radius == 0.4)
click(menu.rows[8].select)
click(menu.picker.choices[8])
assert(markers[8].icon == 8 and markers[8].enabled and markers[8].angle == 315)
click(menu.rows[1].select)
click(menu.picker.remove)
assert(markers[1].icon == 0 and not markers[1].enabled and markers[1].angle == 37)
assert(not hud.dial.markers[1]:IsShown())
C.SetMarker(1, "enabled", true)
assert(not markers[1].enabled, "Empty positions cannot display an invalid icon")

-- Clear affects only the current layout's markers. New assignments survive a
-- reload, including empty positions, the enabled state and user-authored names.
click(menu.clearButton)
assert(menu.markerCount.valueText == "MARKERS · 0 of 8 shown")
for id = 1, 8 do
    assert(markers[id].icon == 0 and not markers[id].enabled)
    local slot = C.preview.markers[id]
    assert(slot:IsShown() and slot.mouse and slot.slotNumber:IsShown())
    assert(slot.slotNumber.valueText == tostring(id) and slot.icon.texture == nil)
    assert(not hud.dial.markers[id]:IsShown() and not menu.rows[id].toggle:IsShown())
end
-- Empty positions remain usable at the smallest icon scale and disappear
-- during live preview, without affecting the separate HUD.
menu.sizeSlider:SetValue(420)
menu.iconSlider:SetValue(16)
assert(C.preview.markers[1]:GetWidth() >= 28)
menu.sizeSlider:SetValue(300)
menu.iconSlider:SetValue(32)
click(menu.liveButton)
for _, slot in ipairs(C.preview.markers) do
    assert(not slot:IsShown() and not slot.mouse and not slot.slotNumber:IsShown())
end
click(menu.liveButton)
assert(C.Profile().size == 300 and C.Profile().north == 0.8 and C.Profile().name == "Boss Åke")
selectLayout(1)
assert(C.Profile().markers[8].icon == 8 and C.Profile().markers[8].enabled)
selectLayout(2)
-- Position a numbered empty slot directly in the circle, then fill it.
px, py = C.preview:GetCenter()
scale = C.preview:GetEffectiveScale()
cursorX, cursorY = (px + 300 * 0.39 * 0.5) * scale, py * scale
C.preview.markers[4].scripts.OnDragStart()
tick(0.1)
C.preview.markers[4].scripts.OnDragStop()
assert(C.Profile().markers[4].icon == 0 and C.Profile().markers[4].angle == 90)
click(C.preview.markers[4])
assert(menu.picker:IsShown() and menu.picker.slot == 4)
click(menu.picker.choices[7])
assert(C.Profile().markers[4].angle == 90 and math.abs(C.Profile().markers[4].radius - 0.5) < 0.001)
assert(not C.preview.markers[4].slotNumber:IsShown() and menu.rows[4].toggle:IsShown())
assert(hud.dial.markers[4]:IsShown() and hud.dial.markers[4].slotNumber == nil)
C.SetMarker(4, "angle", 123)
C.SetMarker(4, "radius", 0.6)
click(C.preview.markers[6])
click(menu.picker.choices[3])
click(menu.rows[4].select)
click(menu.liveButton)
assert(not menu.picker:IsShown())
for id, slot in ipairs(C.preview.markers) do
    assert(slot:IsShown() == (id == 4 or id == 6) and not slot.slotNumber:IsShown())
end
click(menu.rows[6].select)
selectLayout(1)
assert(not menu.picker:IsShown())
selectLayout(2)
click(menu.enableButton)
assert(not hud:IsShown() and not C.Config().enabled)
click(menu.closeButton)
ns = loadRaidTools(ns.db)
C, hud = ns.Compass, DarkWhisperRaidToolsCompassHUD
SlashCmdList.DARKWHISPERRAIDTOOLS()
menu = DarkWhisperRaidToolsCompassOptions
assert(not hud:IsShown() and menu.enableButton.label.valueText == "Enable compass")
assert(C.Profile().name == "Boss Åke")
for id, marker in ipairs(C.Profile().markers) do
    local expected = id == 4 and 7 or id == 6 and 3 or 0
    assert(marker.icon == expected and marker.enabled == (expected > 0))
    assert(C.preview.markers[id]:IsShown() and C.preview.markers[id].slotNumber:IsShown() == (expected == 0))
    assert(menu.rows[id].toggle:IsShown() == (expected > 0))
end
assert(C.Profile().markers[4].angle == 123 and C.Profile().markers[4].radius == 0.6)
click(menu.enableButton)
click(menu.closeButton)
ns = loadRaidTools(ns.db)
assert(DarkWhisperRaidToolsCompassHUD:IsShown() and ns.Compass.Config().enabled)
assert(DarkWhisperRaidToolsCompassHUD.dial.markers[4].icon.texture == "Interface\\TargetingFrame\\UI-RaidTargetingIcon_7")

-- Layout count is dynamic. Exercise creation, scrolling, renaming, deletion,
-- protected Default, and persistence beyond the former five-layout limit.
C, hud = ns.Compass, DarkWhisperRaidToolsCompassHUD
SlashCmdList.DARKWHISPERRAIDTOOLS()
menu = DarkWhisperRaidToolsCompassOptions
assert(#C.Config().layouts == 2 and C.Config().active == 2, "Legacy layout migration runs once")
for index = 3, 20 do
    click(menu.addLayout)
    assert(C.Config().active == index and #C.Config().layouts == index)
    for _, marker in ipairs(C.Profile().markers) do assert(marker.icon == 0) end
end
menu.name:SetText("Last boss")
menu.name.scripts.OnEnterPressed(menu.name)
selectLayout(1)
assert(C.Profile().name == "Default" and not menu.removeLayout:IsEnabled())
selectLayout(20)
assert(C.Profile().name == "Last boss" and menu.layoutButton.label.valueText == "Last boss")
selectLayout(10)
click(menu.removeLayout)
assert(#C.Config().layouts == 19 and C.Config().active == 1)
selectLayout(19)
assert(C.Profile().name == "Last boss")
click(menu.rows[1].select)
click(menu.layoutButton)
assert(not menu.picker:IsShown() and menu.layoutMenu:IsShown(), "Only one picker is open")
click(C.preview.markers[1])
assert(menu.picker:IsShown() and not menu.layoutMenu:IsShown())
click(menu.closeButton)
ns = loadRaidTools(ns.db)
C = ns.Compass
assert(#C.Config().layouts == 19 and C.Config().active == 19 and C.Profile().name == "Last boss")
assert(C.Config().layouts[1].name == "Default" and C.Config().layouts[2].name == "Boss Åke")

local legacyLayouts = {}
for index = 1, 5 do
    legacyLayouts[index] = { name = "Raid " .. index, markers = { { angle = index * 10 } } }
end
ns = loadRaidTools({ compass = { active = 5, layouts = legacyLayouts } })
assert(#ns.Compass.Config().layouts == 6 and ns.Compass.Config().active == 6)
assert(ns.Compass.Profile().name == "Raid 5" and ns.Compass.Profile().markers[1].angle == 50)
for index = 1, 5 do assert(ns.Compass.Config().layouts[index + 1].name == "Raid " .. index) end
ns = loadRaidTools(ns.db)
assert(#ns.Compass.Config().layouts == 6 and ns.Compass.Config().active == 6)

-- Duplicate icon assignments in saved data are repaired even if the original
-- assignment was hidden, and explicit empty slots never become default icons.
ns = loadRaidTools({ compass = { layouts = {
    { markers = { { icon = 5, enabled = false }, { icon = 5 }, { icon = 0 } } },
} } })
assert(ns.Compass.Profile().markers[1].icon == 5 and not ns.Compass.Profile().markers[1].enabled)
assert(ns.Compass.Profile().markers[2].icon == 0 and not ns.Compass.Profile().markers[2].enabled)
assert(ns.Compass.Profile().markers[3].icon == 0 and not ns.Compass.Profile().markers[3].enabled)

-- Corrupt saved settings are repaired without breaking the rest of the addon.
ns = loadRaidTools({ compass = { active = math.huge, x = 0 / 0, layouts = {
    { size = -10, opacity = 2, markers = { { angle = math.huge, radius = -2 } } },
} } })
assert(ns.Compass.Config().active == 1 and ns.Compass.Config().x == 280)
assert(ns.Compass.Profile().size == 160 and ns.Compass.Profile().opacity == 1)
assert(ns.Compass.Profile().markers[1].angle == 0 and ns.Compass.Profile().markers[1].radius == 0)
state.mapID = nil
GetInstanceInfo = function() return "Raid", "raid", 16, "Mythic", 20, 0, false, 1234 end
ns = loadRaidTools()
ns.Compass.SetNorth()
assert(ns.Compass.Profile().northMap == "instance:1234", "Use instance identity if map identity is unavailable")

-- Standalone boot must not need AkionUI, a class API or its globals/commands.
local unitClass = UnitClass
UnitClass = nil
ns = loadRaidTools()
UnitClass = unitClass
assert(AkionUIDB == nil and SlashCmdList.AKIONUI == nil and ns.Compass)
assert(SLASH_DARKWHISPERRAIDTOOLS2 == "/dwrt")
assert(AkionUICompassHUD == nil and AkionUICompassOptions == nil)
assert(DarkWhisperRaidToolsCompassHUD)
SlashCmdList.DARKWHISPERRAIDTOOLS()
assert(DarkWhisperRaidToolsCompassOptions:IsShown())

-- Migration is order-independent, copied once, and does not mutate AkionUI.
for _, order in ipairs({ "raid-first", "akion-first" }) do
    state = { class = "WARRIOR", facing = 0.8, mapID = 101 }
    local legacy = { compass = { enabled = true, layoutVersion = 2, active = 2, x = 320, y = -40, layouts = {
        { name = "Default" },
        { name = "Raid setup", north = 0.8, northMap = "map:101",
          markers = { { icon = 3, angle = 72, radius = 0.6 }, { icon = 0 } } },
    } } }
    local akion
    ns, akion = loadRaidTools(nil, legacy, order)
    assert(ns.db.importedFromAkionUI and ns.db ~= akion.db and akion.db == legacy)
    assert(ns.db.compass ~= legacy.compass and ns.Compass.Profile() ~= legacy.compass.layouts[2])
    assert(ns.Compass.Profile().name == "Raid setup" and ns.Compass.Config().x == 320)
    assert(#legacy.compass.layouts[2].markers == 2 and legacy.compass.layouts[2].northInstance == nil)
    assert(akion.Compass == nil and not AkionUICompassHUD, "Only the standalone addon may run the compass")
    ns.Compass.Profile().name = "Standalone edit"
    ns.Compass.SetMarker(1, "angle", 95)
    assert(legacy.compass.layouts[2].name == "Raid setup" and legacy.compass.layouts[2].markers[1].angle == 72)
    ns = loadRaidTools(ns.db, legacy, order)
    assert(ns.Compass.Profile().name == "Standalone edit" and ns.Compass.Profile().markers[1].angle == 95,
        "Existing standalone settings must never be overwritten by another migration")
    ns = loadRaidTools(ns.db)
    assert(ns.Compass.Profile().name == "Standalone edit", "AkionUI can be disabled after import")
end

-- A map can arrive late without a zone event, both before and after calibration.
state = { class = "WARRIOR", facing = 0.8 }
ns = loadRaidTools()
C = ns.Compass
state.mapID = 101
C.SetNorth()
assert(C.Profile().northMap == "map:101" and C.Profile().northInstance == "instance:1234")
ns = loadRaidTools(ns.db)
C = ns.Compass
C.Sample(true)
assert(math.abs(C.Heading()) < 0.001, "Set north refreshes location before saving")
state.mapID = nil
ns = loadRaidTools()
C = ns.Compass
SlashCmdList.DARKWHISPERRAIDTOOLS()
C.SetNorth()
assert(C.Profile().northMap == "instance:1234")
state.mapID = 101
tick(0.6)
assert(C.Profile().northMap == "map:101" and math.abs(C.Heading()) < 0.001)
ns = loadRaidTools(ns.db)
C = ns.Compass
C.Sample(true)
assert(math.abs(C.Heading()) < 0.001, "Promoted instance calibration survives reload")
state.mapID = nil
C.Sample(true)
assert(math.abs(C.Heading()) < 0.001, "Transient map loss keeps the same instance calibration")
state.mapID = 202
C.Sample(true)
assert(math.abs(C.Heading()) > 1, "A different map must not inherit a floor-specific calibration")
GetInstanceInfo = function() return "Outdoors", "none", 0, "", 0, 0, false, 1234 end
state.mapID = nil
ns = loadRaidTools()
C = ns.Compass
C.SetNorth()
assert(C.Profile().northMap == "session", "Outdoor continent IDs are not raid instance IDs")
fire("ZONE_CHANGED")
assert(C.Profile().north == nil, "Unknown session calibration expires on zone changes")
C.SetNorth()
ns = loadRaidTools(ns.db)
assert(ns.Compass.Profile().north == nil, "Session-only calibration must not survive reload")
GetInstanceInfo = nil

-- Reproduce distributed icons covering empty slots. Exercise every assignment
-- subset: only empty handles may move aside, and every empty stays clickable.
state = { class = "WARRIOR", facing = 0, mapID = 101 }
ns = loadRaidTools()
C = ns.Compass
SlashCmdList.DARKWHISPERRAIDTOOLS()
menu = DarkWhisperRaidToolsCompassOptions
local function CheckEmptySeparation()
    local markers = C.Profile().markers
    for id, marker in ipairs(markers) do
        if marker.icon == 0 then
            local x, y = C.preview.markers[id]:GetCenter()
            for other, otherMarker in ipairs(markers) do
                if id ~= other and (otherMarker.icon == 0 or otherMarker.enabled) then
                    local ox, oy = C.preview.markers[other]:GetCenter()
                    assert(math.abs(x - ox) >= 35.99 or math.abs(y - oy) >= 35.99,
                        "Empty click targets must not overlap")
                end
            end
        end
    end
end
for mask = 0, 255 do
    C.ClearMarkers()
    local count = 0
    for id = 1, 8 do
        if math.floor(mask / 2 ^ (id - 1)) % 2 == 1 then C.AssignMarker(id, id); count = count + 1 end
    end
    C.Distribute()
    local placed = 0
    for _, marker in ipairs(C.Profile().markers) do
        if marker.icon > 0 then
            assert(math.abs(marker.angle - placed * 360 / count) < 0.001 and marker.radius == 0.9)
            placed = placed + 1
        end
    end
    CheckEmptySeparation()
end
C.ClearMarkers()
C.AssignMarker(2, 1)
C.AssignMarker(4, 8)
C.Distribute()
local empty = C.Profile().markers[1]
local emptyAngle, emptyRadius = empty.angle, empty.radius
click(C.preview.markers[1])
assert(not menu.picker.remove:IsEnabled(), "An empty slot has nothing to remove")
click(menu.picker.choices[2])
assert(empty.angle == emptyAngle and empty.radius == emptyRadius, "Picking an icon keeps the displayed position")
click(C.preview.markers[1])
assert(menu.picker.remove:IsEnabled())
for _, size in ipairs({ 160, 420 }) do
    C.SetProfileValue("size", size)
    for _, iconSize in ipairs({ 16, 64 }) do
        C.SetProfileValue("iconSize", iconSize)
        for _, marker in ipairs(C.preview.markers) do assert(marker:GetWidth() == 32) end
        CheckEmptySeparation()
    end
end
C.ClosePicker()
C.SetProfileValue("size", 160)
C.SetProfileValue("iconSize", 64)
C.SetMarker(1, "radius", 1)
C.SetLive(true)
local vx, vy = menu.previewViewport:GetCenter()
for _, marker in ipairs(C.preview.markers) do
    if marker:IsShown() then
        local mx, my = marker:GetCenter()
        local half = marker:GetWidth() / 2
        assert(math.abs(mx - vx) + half <= 150.001 and math.abs(my - vy) + half <= 150.001,
            "Large live-preview icons stay inside their viewport")
    end
end
C.SetLive(false)
assert(C.preview:GetWidth() == 300, "Editing keeps its stable drag coordinate system")
local selected = menu.rows[1].select
selected.scripts.OnEnter(selected)
selected.scripts.OnLeave(selected)
assert(selected.border[2] == 0.65, "Selected row retains its highlight after mouse leave")
for _ = 1, 12 do C.AddLayout() end
click(menu.layoutButton)
local dropdown, oldOffset = menu.layoutMenu, menu.layoutMenu.offset
dropdown.items[1].scripts.OnMouseWheel(dropdown.items[1], 1)
assert(dropdown.offset < oldOffset, "Mouse wheel works when hovering a layout row")
assert(menu.status.width == 874, "Status line remains within the content area")
print("PASS: " .. cases .. " Moonkin, " .. lustCases .. " Bloodlust, " .. sootheCases
    .. " Soothe cases; compass GUI, clickable numbered empty positions, marker replacement/migration/clearing, enable/disable persistence,"
    .. " dragging, scrollable layouts beyond five, Default protection, calibration, reload, protected data and recovery;"
    .. " standalone boot, both migration load orders, no shared settings, delayed map identity, 256 empty-slot layouts and UI regressions")
