local _, ns = ...
local C = {}
ns.Compass = C
C.names = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }
C.selected = 1
local cfg, driver, hud, facing, reason, mapKey, instanceKey, nextLocationCheck
local FONT = "Fonts\\ARIALN.TTF"
local MEDIA = "Interface\\AddOns\\DarkWhisperRaidTools\\Media\\"
local directions = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" }
local defaultIcons = { 8, 4, 5, 6, 7, 1, 2, 3 }

local function PublicNumber(value)
    return not (issecretvalue and issecretvalue(value)) and type(value) == "number"
        and value == value and math.abs(value) ~= math.huge
end

local function Clamp(value, default, minimum, maximum)
    if not PublicNumber(value) then return default end
    return math.max(minimum, math.min(maximum, value))
end

local function ReadFacing()
    if type(GetPlayerFacing) ~= "function" then return nil, "The client does not provide heading data." end
    local ok, value = pcall(GetPlayerFacing)
    if not ok then return nil, "WoW does not allow heading access here." end
    if issecretvalue and issecretvalue(value) then return nil, "Heading data is protected by WoW here." end
    if not PublicNumber(value) then return nil, "No heading data is available from WoW here." end
    return value
end

local function ReadLocation()
    local map, instance
    if C_Map and C_Map.GetBestMapForUnit then
        local ok, id = pcall(C_Map.GetBestMapForUnit, "player")
        if ok and PublicNumber(id) and id > 0 then map = "map:" .. id end
    end
    if GetInstanceInfo then
        local ok, _, kind, _, _, _, _, _, id = pcall(GetInstanceInfo)
        if ok and not (issecretvalue and issecretvalue(kind)) and type(kind) == "string"
            and kind ~= "none" and PublicNumber(id) and id > 0 then instance = "instance:" .. id end
    end
    return map or instance or "session", instance
end

local function RefreshLocation()
    mapKey, instanceKey = ReadLocation()
    nextLocationCheck = GetTime() + 0.5
    for _, profile in ipairs(cfg.layouts) do
        -- Promote an instance/session fallback once the map becomes readable.
        -- Session calibrations are cleared BEFORE this on zone changes/reload.
        if profile.north and mapKey ~= "session" and (profile.northMap == "session"
            or (instanceKey and profile.northMap == instanceKey)) then
            profile.northMap, profile.northInstance = mapKey, instanceKey
        elseif profile.north and profile.northMap == mapKey and instanceKey then
            profile.northInstance = instanceKey
        end
    end
end

local function HasCalibration(profile)
    if not profile.north then return false end
    return profile.northMap == mapKey
        or (instanceKey ~= nil and mapKey == instanceKey and profile.northInstance == instanceKey)
end

local function NormalizeProfile(profile, index)
    if type(profile) ~= "table" then profile = {} end
    if type(profile.name) ~= "string" or profile.name == "" then profile.name = "Layout " .. index end
    profile.size = Clamp(profile.size, 240, 160, 420)
    profile.iconSize = Clamp(profile.iconSize, 32, 16, 64)
    profile.opacity = Clamp(profile.opacity, 0.55, 0, 1)
    profile.cardinals = profile.cardinals ~= false
    if not PublicNumber(profile.north) or type(profile.northMap) ~= "string" or profile.northMap == "session" then
        profile.north, profile.northMap, profile.northInstance = nil, nil, nil
    end
    if type(profile.northInstance) ~= "string" then profile.northInstance = nil end
    if type(profile.markers) ~= "table" then profile.markers = {} end
    local assigned = {}
    for id = 1, 8 do
        local marker = type(profile.markers[id]) == "table" and profile.markers[id] or {}
        -- Older layouts used the array index as the icon. Entries now represent
        -- positions, so replacing an icon does not change its angle or radius.
        marker.icon = math.floor(Clamp(marker.icon, id, 0, 8))
        if marker.icon > 0 then
            if assigned[marker.icon] then marker.icon = 0
            else assigned[marker.icon] = true end
        end
        marker.enabled = marker.icon > 0 and marker.enabled ~= false
        marker.angle = Clamp(marker.angle, (id - 1) * 45, -3600, 3600) % 360
        marker.radius = Clamp(marker.radius, 0.9, 0, 1)
        profile.markers[id] = marker
    end
    return profile
end

local function DefaultProfile()
    local profile = { name = "Default", markers = {} }
    -- Clockwise from north: Skull, Triangle, Moon, Square, Cross, Star, Circle, Diamond.
    for slot, icon in ipairs(defaultIcons) do profile.markers[slot] = { icon = icon } end
    return NormalizeProfile(profile, 1)
end

function C.Profile() return cfg.layouts[cfg.active] end
function C.Config() return cfg end

function C.Heading()
    if not facing then return nil end
    local profile = C.Profile()
    local north = HasCalibration(profile) and profile.north or 0
    return (-math.deg(facing - (north or 0))) % 360
end

function C.Status()
    local heading = C.Heading()
    if not heading then return reason or "Heading unavailable", false end
    local direction = directions[math.floor((heading + 22.5) / 45) % 8 + 1]
    return string.format("%s · %.1f°", direction, heading), true
end

function C.Reference()
    local profile = C.Profile()
    if HasCalibration(profile) then return "North: your calibrated heading" end
    if profile.north then return "North: map north · calibration belongs to another zone" end
    return "North: map north"
end

local function CenterLabel(parent, text, size, x, y)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(FONT, size, "OUTLINE")
    label:SetPoint("CENTER", parent, "CENTER", x, y)
    label:SetTextColor(0.9, 0.96, 1)
    label:SetText(text)
    return label
end

function C.CreateDial(parent, editable)
    local dial = CreateFrame("Frame", nil, parent)
    dial:EnableMouse(false)
    dial.disc = dial:CreateTexture(nil, "BACKGROUND")
    dial.disc:SetTexture(MEDIA .. "CompassDisc.tga")
    dial.disc:SetAllPoints(dial)
    dial.disc:SetVertexColor(0.07, 0.065, 0.055, 1)
    dial.ring = dial:CreateTexture(nil, "BORDER")
    dial.ring:SetTexture(MEDIA .. "CompassRing.tga")
    dial.ring:SetAllPoints(dial)
    dial.ring:SetVertexColor(0.65, 0.56, 0.29, 0.8)
    dial.arrow = dial:CreateTexture(nil, "OVERLAY")
    dial.arrow:SetTexture(MEDIA .. "CompassArrow.tga")
    dial.arrow:SetPoint("CENTER", dial, "CENTER", 0, 0)
    dial.arrow:SetVertexColor(0.85, 0.96, 1, 1)
    dial.labels, dial.markers = {}, {}
    for id, text in ipairs({ "N", "E", "S", "W" }) do
        dial.labels[id] = CenterLabel(dial, text, 12, 0, 0)
    end
    for id = 1, 8 do
        local marker = CreateFrame("Button", nil, dial, "BackdropTemplate")
        marker:EnableMouse(editable == true)
        marker:SetBackdrop({
            bgFile = "Interface\\Buttons\\WHITE8X8",
            edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1,
        })
        marker.icon = marker:CreateTexture(nil, "ARTWORK")
        marker.icon:SetAllPoints(marker)
        if editable then
            marker.slotNumber = CenterLabel(marker, tostring(id), 14, 0, 0)
            marker.slotNumber:Hide()
            marker:RegisterForDrag("LeftButton")
            marker:SetScript("OnClick", function() C.OpenPicker(id) end)
            marker:SetScript("OnDragStart", function()
                if C.live then return end
                C.ClosePicker()
                C.selected, C.dragging = id, id
                C.Refresh()
            end)
            marker:SetScript("OnDragStop", function() C.StopMarkerDrag() end)
        end
        dial.markers[id] = marker
    end
    dial.editable = editable
    return dial
end

function C.RenderDial(dial, size, heading)
    local profile = C.Profile()
    dial:SetSize(size, size)
    dial.disc:SetAlpha(profile.opacity)
    dial.arrow:SetSize(size * 0.1, size * 0.1)
    for id, label in ipairs(dial.labels) do
        local angle = math.rad((id - 1) * 90 - heading)
        label:ClearAllPoints()
        label:SetPoint("CENTER", dial, "CENTER", size * 0.46 * math.sin(angle), size * 0.46 * math.cos(angle))
        label:SetShown(profile.cardinals)
    end
    local editing = dial.editable and not C.live
    for id, marker in ipairs(dial.markers) do
        local setting = profile.markers[id]
        local placeholder = editing and setting.icon == 0
        if marker.iconId ~= setting.icon then
            marker.icon:SetTexture(setting.icon > 0 and ("Interface\\TargetingFrame\\UI-RaidTargetingIcon_" .. setting.icon) or nil)
            marker.iconId = setting.icon
        end
        local angle = math.rad(setting.angle - heading)
        local radius = size * 0.39 * setting.radius
        -- Editing uses stable handles; live preview and HUD show the actual size.
        local buttonSize = editing and 32 or profile.iconSize * size / profile.size
        marker:SetSize(buttonSize, buttonSize)
        marker:ClearAllPoints()
        marker:SetPoint("CENTER", dial, "CENTER", radius * math.sin(angle), radius * math.cos(angle))
        marker:SetShown(placeholder or (setting.enabled and setting.icon > 0))
        marker:EnableMouse(editing)
        if marker.slotNumber then marker.slotNumber:SetShown(placeholder) end
        marker:SetBackdropColor(0.035, 0.08, 0.1, placeholder and 0.95 or 0)
        marker:SetBackdropBorderColor(0, 0.85, 1, editing and id == C.selected and 1 or (placeholder and 0.45 or 0))
    end
end

local function PositionHUD()
    local profile = C.Profile()
    hud:SetSize(profile.size, profile.size)
    hud:ClearAllPoints()
    hud:SetPoint("CENTER", UIParent, "CENTER", cfg.x, cfg.y)
end

local function Draw()
    local heading = C.Heading()
    if cfg.enabled then
        hud:Show()
        hud:EnableMouse(C.unlocked == true)
        hud.hint:SetText(C.unlocked and (heading and "Drag to move the compass" or "Move · preview")
            or "Heading unavailable")
        hud.hint:SetShown(C.unlocked == true or heading == nil)
        if heading or C.unlocked then
            hud.dial:Show()
            C.RenderDial(hud.dial, C.Profile().size, heading or 0)
        else
            hud.dial:Hide()
        end
    else
        hud:Hide()
    end
    if C.panel and C.panel:IsShown() then
        if C.live and not heading then
            C.preview:Hide()
            C.panel.previewMessage:Show()
        else
            C.panel.previewMessage:Hide()
            C.preview:Show()
            local previewSize = 300
            if C.live then
                -- Keep the entire live preview inside its viewport, including
                -- large icons at the outer edge of a small configured circle.
                local profile, extent = C.Profile(), 0.5
                for _, marker in ipairs(profile.markers) do
                    if marker.enabled and marker.icon > 0 then
                        extent = math.max(extent, 0.39 * marker.radius + profile.iconSize / profile.size / 2)
                    end
                end
                previewSize = math.min(300, 150 / extent)
            end
            C.RenderDial(C.preview, previewSize, C.live and heading or 0)
        end
        C.UpdateStatus()
    end
end

local function WakeDriver()
    driver:SetShown(cfg.enabled or (C.panel and C.panel:IsShown()) or false)
end

local function ReflowEmptyMarkers()
    local markers, occupied = C.Profile().markers, {}
    local function Point(marker)
        local radians = math.rad(marker.angle)
        return math.sin(radians) * marker.radius * 117, math.cos(radians) * marker.radius * 117
    end
    local function Free(x, y)
        for _, point in ipairs(occupied) do
            if math.abs(x - point[1]) < 36 and math.abs(y - point[2]) < 36 then return false end
        end
        return true
    end
    for id, marker in ipairs(markers) do
        if (marker.icon > 0 and marker.enabled) or C.dragging == id then
            local x, y = Point(marker)
            occupied[#occupied + 1] = { x, y }
        end
    end
    for id, marker in ipairs(markers) do
        if marker.icon == 0 and C.dragging ~= id then
            local x, y = Point(marker)
            if not Free(x, y) then
                local best, bestAngle, bestRadius
                for _, radius in ipairs({ 0.9, 0.65, 0.4, 0.15, 1, 0.8, 0.55, 0.3, 0 }) do
                    for angle = 0, 345, 15 do
                        local radians = math.rad(angle)
                        local cx, cy = math.sin(radians) * radius * 117, math.cos(radians) * radius * 117
                        local distance = (cx - x) ^ 2 + (cy - y) ^ 2
                        if (not best or distance < best) and Free(cx, cy) then
                            best, bestAngle, bestRadius = distance, angle, radius
                        end
                    end
                end
                if best then
                    marker.angle, marker.radius = bestAngle, bestRadius
                    x, y = Point(marker)
                end
            end
            occupied[#occupied + 1] = { x, y }
        end
    end
end

function C.Refresh()
    if not cfg then return end
    ReflowEmptyMarkers()
    PositionHUD()
    WakeDriver()
    Draw()
    if C.RefreshOptions and C.panel and C.panel:IsShown() then C.RefreshOptions() end
end

function C.Sample(refreshLocation)
    if refreshLocation or not nextLocationCheck or GetTime() >= nextLocationCheck then RefreshLocation() end
    facing, reason = ReadFacing()
    Draw()
end

function C.SelectMarker(id)
    C.StopMarkerDrag()
    C.live = false
    C.selected = id
    C.Refresh()
end

function C.AssignMarker(id, icon)
    if not PublicNumber(id) or id % 1 ~= 0 or id < 1 or id > 8
        or not PublicNumber(icon) or icon % 1 ~= 0 or icon < 0 or icon > 8 then return end
    C.StopMarkerDrag()
    C.ClosePicker()
    C.live, C.selected = false, id
    local markers = C.Profile().markers
    if icon > 0 then
        for other, marker in ipairs(markers) do
            if other ~= id and marker.icon == icon then
                marker.icon, marker.enabled = 0, false
            end
        end
    end
    markers[id].icon, markers[id].enabled = icon, icon > 0
    C.Refresh()
end

function C.ClearMarkers()
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    C.live, C.selected = false, 1
    for id, marker in ipairs(C.Profile().markers) do
        marker.icon, marker.enabled = 0, false
        marker.angle, marker.radius = (id - 1) * 45, 0.9
    end
    C.Refresh()
end

function C.SetMarker(id, key, value)
    C.StopMarkerDrag()
    C.live = false
    local marker = C.Profile().markers[id]
    if key == "enabled" then marker.enabled = value == true and marker.icon > 0
    elseif key == "angle" then marker.angle = value % 360
    elseif key == "radius" then marker.radius = Clamp(value, marker.radius, 0, 1) end
    C.Refresh()
end

function C.SetProfileValue(key, value)
    local profile = C.Profile()
    if key == "size" then profile.size = Clamp(value, 240, 160, 420)
    elseif key == "iconSize" then profile.iconSize = Clamp(value, 32, 16, 64)
    elseif key == "opacity" then profile.opacity = Clamp(value, 0.55, 0, 1)
    elseif key == "cardinals" then profile.cardinals = value == true end
    C.Refresh()
end

function C.SetActive(index)
    if not PublicNumber(index) or index % 1 ~= 0 or not cfg.layouts[index] then return end
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    cfg.active = index
    C.Refresh()
end

function C.AddLayout()
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    local names = {}
    for _, profile in ipairs(cfg.layouts) do names[profile.name] = true end
    local number = 1
    while names["Layout " .. number] do number = number + 1 end
    local profile = NormalizeProfile({ name = "Layout " .. number }, #cfg.layouts + 1)
    for _, marker in ipairs(profile.markers) do marker.icon, marker.enabled = 0, false end
    table.insert(cfg.layouts, profile)
    cfg.active = #cfg.layouts
    C.live, C.selected = false, 1
    C.Refresh()
end

function C.RemoveLayout()
    if cfg.active == 1 then return end
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    table.remove(cfg.layouts, cfg.active)
    cfg.active = 1
    C.live, C.selected = false, 1
    C.Refresh()
end

function C.SetNorth()
    RefreshLocation()
    facing, reason = ReadFacing()
    if facing then
        local profile = C.Profile()
        profile.north, profile.northMap, profile.northInstance = facing, mapKey, instanceKey
    end
    C.Refresh()
end

function C.ResetNorth()
    C.Profile().north, C.Profile().northMap, C.Profile().northInstance = nil, nil, nil
    C.Refresh()
end

function C.SetEnabled(enabled)
    C.StopHUDDrag()
    cfg.enabled = enabled == true
    if not cfg.enabled then C.unlocked = false end
    C.Sample(true)
    C.Refresh()
end

function C.StopHUDDrag()
    if not hud or not hud.moving then return end
    hud:StopMovingOrSizing()
    hud.moving = false
    local x, y = hud:GetCenter()
    local cx, cy = UIParent:GetCenter()
    cfg.x, cfg.y = x - cx, y - cy
    PositionHUD()
end

function C.SetUnlocked(unlocked)
    C.StopHUDDrag()
    C.unlocked = unlocked == true
    if C.unlocked then cfg.enabled = true end
    C.Refresh()
end

function C.SetLive(live)
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    C.live = live == true
    C.Sample(true)
    C.Refresh()
end

function C.Distribute()
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    C.live = false
    local count = 0
    for _, marker in ipairs(C.Profile().markers) do if marker.enabled then count = count + 1 end end
    if count == 0 then C.Refresh(); return end
    local index = 0
    for _, marker in ipairs(C.Profile().markers) do
        if marker.enabled then
            marker.angle, marker.radius = index * 360 / count, 0.9
            index = index + 1
        end
    end
    C.Refresh()
end

local function UpdateMarkerDrag()
    if not C.dragging or C.live then return end
    local x, y = GetCursorPosition()
    if not PublicNumber(x) or not PublicNumber(y) then return end
    local scale = C.preview:GetEffectiveScale()
    local cx, cy = C.preview:GetCenter()
    local dx, dy = x / scale - cx, y / scale - cy
    local distance = math.sqrt(dx * dx + dy * dy)
    local marker = C.Profile().markers[C.dragging]
    if distance > 2 then marker.angle = math.floor(math.deg(math.atan2(dx, dy)) + 0.5) % 360 end
    marker.radius = math.min(1, distance / (300 * 0.39))
    C.Refresh()
end

function C.StopMarkerDrag()
    if C.dragging then
        UpdateMarkerDrag()
        C.dragging = nil
        C.Refresh()
    end
end

function C.CloseEditor()
    C.StopMarkerDrag()
    C.ClosePicker()
    C.CloseLayoutMenu()
    C.StopHUDDrag()
    C.unlocked, C.live = false, false
    C.Refresh()
end

function C.Initialize()
    cfg = type(ns.db.compass) == "table" and ns.db.compass or {}
    ns.db.compass = cfg
    cfg.enabled = cfg.enabled == true
    cfg.x, cfg.y = Clamp(cfg.x, 280, -5000, 5000), Clamp(cfg.y, -100, -5000, 5000)
    if type(cfg.layouts) ~= "table" then cfg.layouts = {} end
    cfg.active = math.floor(Clamp(cfg.active, 1, 1, math.max(1, #cfg.layouts)))
    for index = 1, #cfg.layouts do cfg.layouts[index] = NormalizeProfile(cfg.layouts[index], index) end
    if #cfg.layouts == 0 then
        cfg.layouts[1] = DefaultProfile()
    elseif cfg.layoutVersion ~= 2 and cfg.layouts[1].name ~= "Layout 1" and cfg.layouts[1].name ~= "Default" then
        -- Keep named legacy layouts intact and selected when adding the required
        -- default. The old unnamed first layout can serve as Default directly.
        table.insert(cfg.layouts, 1, DefaultProfile())
        cfg.active = cfg.active + 1
    end
    cfg.layouts[1].name = "Default"
    cfg.layoutVersion = 2
    RefreshLocation()

    hud = CreateFrame("Frame", "DarkWhisperRaidToolsCompassHUD", UIParent)
    hud:Hide()
    hud:SetClampedToScreen(true)
    hud:SetFrameStrata("MEDIUM")
    hud:SetMovable(true)
    hud:EnableMouse(false)
    hud:RegisterForDrag("LeftButton")
    hud:SetScript("OnDragStart", function(self)
        if C.unlocked then self.moving = true; self:StartMoving() end
    end)
    hud:SetScript("OnDragStop", C.StopHUDDrag)
    hud:SetScript("OnHide", C.StopHUDDrag)
    hud.dial = C.CreateDial(hud, false)
    hud.dial:SetPoint("CENTER", hud, "CENTER", 0, 0)
    hud.hint = CenterLabel(hud, "", 13, 0, 0)

    driver = CreateFrame("Frame")
    driver:Hide()
    local elapsedSinceSample = 0
    driver:SetScript("OnUpdate", function(_, elapsed)
        elapsedSinceSample = elapsedSinceSample + elapsed
        if elapsedSinceSample < 1 / 30 then return end
        elapsedSinceSample = 0
        UpdateMarkerDrag()
        C.Sample()
    end)
    driver:RegisterEvent("PLAYER_ENTERING_WORLD")
    driver:RegisterEvent("ZONE_CHANGED_NEW_AREA")
    driver:RegisterEvent("ZONE_CHANGED")
    driver:RegisterEvent("ZONE_CHANGED_INDOORS")
    driver:SetScript("OnEvent", function()
        -- A session-only calibration cannot be carried across unknown maps.
        for _, profile in ipairs(cfg.layouts) do
            if profile.northMap == "session" then profile.north, profile.northMap, profile.northInstance = nil, nil, nil end
        end
        RefreshLocation()
        if cfg.enabled or (C.panel and C.panel:IsShown()) then C.Sample() end
    end)
    if cfg.enabled then facing, reason = ReadFacing() end
    C.Refresh()
end
