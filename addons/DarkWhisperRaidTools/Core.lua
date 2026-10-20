local addonName, ns = ...
ns.version = "1.0.1"

local function Copy(value, seen)
    if type(value) ~= "table" then return value end
    seen = seen or {}
    if seen[value] then return seen[value] end
    local result = {}
    seen[value] = result
    for key, item in pairs(value) do result[key] = Copy(item, seen) end
    return result
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function(self, event, name)
    if event == "ADDON_LOADED" then
        if name ~= addonName then return end
        if type(DarkWhisperRaidToolsDB) ~= "table" then DarkWhisperRaidToolsDB = {} end
        ns.db = DarkWhisperRaidToolsDB
        self:UnregisterEvent("ADDON_LOADED")
    elseif event == "PLAYER_LOGIN" and ns.db and not ns.ready then
        -- All enabled addons' SavedVariables have loaded by PLAYER_LOGIN.
        -- Copy once; never alias or modify AkionUI's saved compass.
        if ns.db.compass == nil and type(AkionUIDB) == "table" and type(AkionUIDB.compass) == "table" then
            ns.db.compass = Copy(AkionUIDB.compass)
            ns.db.importedFromAkionUI = true
        end
        ns.Compass.Initialize()
        ns.ready = true
        self:UnregisterEvent("PLAYER_LOGIN")
    end
end)
