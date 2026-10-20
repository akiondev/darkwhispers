local addonName, ns = ...

ns.version = "0.8.1"

local defaults = {
    enabled = true,
    fontSize = 28,
    hudX = 0,
    hudY = 180,
    bloodlustEnabled = true,
    bloodlustSize = 64,
    bloodlustX = 0,
    bloodlustY = -120,
    bloodlustShowReady = true,
    bloodlustGlow = true,
    sootheEnabled = true,
    sootheFontSize = 28,
    sootheX = 90,
    sootheY = -120,
}

local function InitializeSettings()
    if type(AkionUIDB) ~= "table" then
        AkionUIDB = {}
    end
    for key, value in pairs(defaults) do
        local saved = AkionUIDB[key]
        if type(saved) ~= type(value)
            or (type(saved) == "number" and (saved ~= saved or math.abs(saved) == math.huge)) then
            AkionUIDB[key] = value
        end
    end
    AkionUIDB.fontSize = math.max(16, math.min(48, AkionUIDB.fontSize))
    AkionUIDB.bloodlustSize = math.max(32, math.min(160, AkionUIDB.bloodlustSize))
    AkionUIDB.sootheFontSize = math.max(16, math.min(64, AkionUIDB.sootheFontSize))
    -- Retire the old icon/audio settings; retain the user's existing position.
    AkionUIDB.sootheSize, AkionUIDB.sootheSound = nil, nil
    AkionUIDB.sootheActionableSound, AkionUIDB.sootheSoundInterval = nil, nil
    ns.db = AkionUIDB
    ns.isDruid = select(2, UnitClass("player")) == "DRUID"
end

local function UpdateSpecialization()
    local spec = ns.isDruid and C_SpecializationInfo.GetSpecialization()
    ns.isBalanceDruid = spec and C_SpecializationInfo.GetSpecializationInfo(spec) == 102 or false
    if not ns.isBalanceDruid then
        ns.SetHUDUnlocked(false)
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("PLAYER_SPECIALIZATION_CHANGED")
events:RegisterEvent("PLAYER_TALENT_UPDATE")
events:RegisterEvent("UPDATE_SHAPESHIFT_FORM")
events:RegisterEvent("UPDATE_SHAPESHIFT_FORMS")
events:SetScript("OnEvent", function(self, event, arg1)
    if event == "ADDON_LOADED" then
        if arg1 ~= addonName then
            return
        end

        InitializeSettings()
        ns.CreateHUD()
        ns.CreateBloodlustTracker()
        ns.CreateSootheTracker()
        self:UnregisterEvent("ADDON_LOADED")
        return
    end

    if not ns.db then
        return
    end
    if event == "PLAYER_SPECIALIZATION_CHANGED" and arg1 ~= "player" then
        return
    end
    if event == "PLAYER_ENTERING_WORLD"
        or event == "PLAYER_SPECIALIZATION_CHANGED" or event == "PLAYER_TALENT_UPDATE" then
        UpdateSpecialization()
    end
    ns.UpdateHUD()
    if event == "PLAYER_ENTERING_WORLD" then ns.UpdateBloodlust() end
    if ns.RefreshOptions then
        ns.RefreshOptions()
    end
end)

SLASH_AKIONUI1 = "/akionui"
SLASH_AKIONUI2 = "/aui"
SlashCmdList.AKIONUI = function(message)
    if ns.db then
        local command = (message or ""):match("^%s*(.-)%s*$"):lower()
        if command == "status" then
            ns.PrintSootheStatus()
        else
            ns.ToggleOptions()
        end
    end
end
