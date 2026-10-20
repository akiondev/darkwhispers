# DarkWhisper Raid Tools and AkionUI

**DarkWhisper Raid Tools 1.0.0** is Robin's standalone raid marker compass for World of Warcraft Retail: Midnight. Open it with `/dwrt` or `/acomp`. It has its own folder, namespace, textures and account-wide SavedVariables (`DarkWhisperRaidToolsDB`); it requires no other addon or external libraries. Its English menu uses a compact sidebar, translucent dark backdrop, gold headings and teal selection highlights, inspired by the supplied Northern Sky Raid Tools screenshot. All artwork is original or supplied by WoW.

**AkionUI 0.8.1** retains the Moonkin, Bloodlust and Soothe features under `/aui` or `/akionui`. It no longer loads or registers a compass. Both addons can run together or separately.

## Moving existing compass settings

On the first login with the new addon, keep **both DarkWhisper Raid Tools and AkionUI enabled**. Once all enabled addons have loaded, DarkWhisper copies the existing compass layouts, active layout, HUD position, enabled state, appearance and calibration into its own settings. It never changes or shares AkionUI's saved table, and it never replaces existing DarkWhisper settings. After this first import, AkionUI can be disabled and the compass continues independently.

Starting DarkWhisper for the first time with AkionUI disabled creates fresh settings because the old SavedVariables are not available. Both addons save their settings through WoW normally; the installer never edits WTF/SavedVariables files.

## Fixes included in this release

- Empty positions move aside if distributed or dragged icons cover their click targets. Assigned markers retain their chosen positions.
- The editor uses consistent 32-pixel handles. Test live previews the configured proportions and scales the whole preview down when large icons would extend outside its area.
- Set north refreshes the current map before saving. A temporary instance fallback is promoted when map data arrives; calibration survives reload and temporary map-data loss in the same instance.
- Selected rows retain their outline after mouse leave; mouse-wheel scrolling works over layout entries. Long button labels stay on one line, the dropdown arrow uses a texture, and Remove marker is disabled for empty positions.
- The settings window scales down to fit the screen and moves by dragging its title bar.

## Compass: markers and layouts

The compass uses manually configured directions and positions. It does not read the locations of actual raid markers. The editor is available everywhere and on every class.

- **Enable compass / Disable compass:** turn the separate compass HUD on or off. This setting survives `/reload` and login. Disabling it preserves all layouts and placement settings; the editor remains available.
- **Clear circle:** remove every marker from the current layout and reset its empty positions around the circle. Other layouts, appearance settings and north calibration are preserved.
- **Choose or replace a marker:** click a marker in the circle or a position in the list. Choose one of the eight raid icons in the graphical picker. The new icon keeps that position's angle and distance from the center. If the icon is assigned elsewhere, it moves here and its previous position becomes empty, even if it was hidden. There are no duplicate icons in a layout.
- **Empty positions / Remove marker:** empty positions appear as clickable numbered slots (1–8) directly in the editing circle, matching the positions in the list. Click an empty slot or its list entry to choose an icon, or drag the empty slot first to set its position. Use **Remove marker** in the picker to clear just that position. Numbered placeholders appear only while editing; they are hidden in the live preview and the compass HUD.
- **Shown / Hidden:** temporarily hide an assigned marker without removing its icon or position. Hidden assignments can still be moved to another position using the picker.
- **Position markers:** drag icons around the circle. Editing is always north-up, independent of your character's current heading. Clicking a position while testing live automatically returns to editing. The angle controls adjust in 5-degree steps; dragging uses whole degrees. Distance from the center is a visual layout setting, not a distance in the world.
- **Distribute evenly:** place the visible markers at evenly spaced angles around the circle.
- **Appearance:** adjust circle size (160–420), icon size (16–64), background opacity and cardinal direction labels.
- **Layout dropdown:** select layouts by name. Scroll with the mouse wheel or arrow buttons when the list is long. There is no fixed limit on saved layouts.
- **+ / −:** create a new empty layout or delete the selected custom layout. New layouts start with eight numbered empty slots. **Default** always remains available and cannot be deleted or renamed; its markers and appearance can be edited. Deleting a custom layout returns to Default.
- **Layout names and persistence:** enter a custom layout name and press Enter or leave the field to save it. Markers, sizes and calibration are stored per layout. Older layouts retain their icons, positions, names and visibility. A named legacy first layout is preserved separately when Default is introduced.
- **Set north:** face the direction you want to treat as north and press this button. **Map north** resets the calibration. Calibration is saved with the map or instance ID and reused there after reload. Other areas use map north. If WoW does not provide an area ID, calibration lasts only for the current session and is cleared on zone changes.
- **Test live / Edit layout:** switch between a live rotating preview and the stable marker editor. Live rotation follows the character's heading, not free camera rotation.
- **Move HUD / Lock position:** unlock and drag the separate compass HUD on screen. Moving also enables the HUD. Close the menu or lock it to finish; the locked HUD lets mouse clicks through. Its screen position is saved.
- Close the editor with **×** or **Escape**. Drag the title bar to move the settings window.

When WoW does not provide a readable heading, the rotating HUD circle is hidden and shows **Heading unavailable**. Layout editing still works, but **Set north** is disabled. Moving the HUD can show an explicitly labelled preview without heading data. Protected values are never used in calculations. There is no estimated mouse input or obsolete minimap rotation workaround.

The user has reported that rotation works in the test panel. The environment and availability during a boss encounter have not been confirmed. A working outdoor compass does not establish raid compatibility.

## Moonkin warning

**NOT IN MOONKIN FORM!** appears when you are a **Balance druid**, the warning is enabled, and you are not in Moonkin Form. It works both in and out of combat. Entering Moonkin Form or changing specialization hides the warning; other classes never see it.

In `/aui`, select **Moonkin warning** to enable or disable the warning and adjust text size (16–48). Use **Move text** or **Unlock HUD**, drag the blue placement text, then close settings to lock it. The placement preview is available even while you are in Moonkin Form. The locked HUD lets mouse clicks through.

## Bloodlust / Heroism

Select **Bloodlust / Heroism** in `/aui`. The tracker works on all classes and factions and follows **your personal Bloodlust lockout**, such as Sated or Exhaustion. It does not track another player's ability cooldown.

- During your lockout, the icon shows a cooldown sweep and remaining time in `minutes:seconds`.
- **READY** and an optional green pulse appear when your lockout ends. Turn off **Show when ready** to hide the icon while ready.
- Use **Move icon** or **Unlock HUD** to drag it. Close settings to lock it and let mouse clicks through.
- Icon size ranges from 32 to 160, with timer text scaling accordingly.
- The tracker reads the debuff after `/reload` or login and follows early resets.

Lockouts associated with Bloodlust, Heroism, Time Warp, Primal Rage, Fury of the Aspects and older pet/drum variants are identified by spell ID. Someone else's Bloodlust only starts your timer if you receive the lockout. READY does not guarantee that a group member has Bloodlust available.

If the relevant information is protected or unreadable, a yellow **?** appears without ready glow. No guessed timer or ready state is shown.

## Soothe

Select **Soothe** in `/aui`. This feature is for druids in any specialization who have learned Soothe (spell ID 2908).

- **ENRAGE** appears when a removable enrage is detected and Soothe is ready.
- **ENRAGE: 8**, **ENRAGE: 7**, etc. count down while Soothe is on cooldown, even after the last enrage disappears.
- When cooldown ends, the display returns to ENRAGE if an enrage is still present; otherwise it disappears.
- There is no icon, border, target name, voice or other audio playback.
- The actual ability cooldown is used, including after reload and early resets. Global cooldown is excluded.
- Hostile target, focus, mouseover, boss units and visible nameplates are watched. Hidden or otherwise unavailable enemies are not scanned.
- Use **Move text** or **Unlock HUD** to drag the blue placement preview. Close settings to lock it and let mouse clicks through. Text size ranges from 16 to 64.
- Enrage tracking pauses while dead; an ongoing cooldown can still be displayed.
- `/aui status` prints a short status message.

Blizzard's aura containers control enrage text visibility. Native duration text bindings count down the cooldown and clear the text when it expires. The addon does not read protected buff data or compare protected cooldown values. Multiple enemies produce the same text at the same location.

Reloading in combat may delay enrage tracking until combat ends because aura containers must be created out of combat. Cooldown text may still appear. No time is guessed if the required cooldown API is unavailable.

The old sound controls and asset were removed in 0.5.0. The addon retires those saved options on load while retaining the user's placement.

## Installation and updates

The authorized installation targets for this project are:

- `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns\DarkWhisperRaidTools`
- `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns\AkionUI`

After verifying runtime changes, run from the project directory:

```powershell
.\deploy.ps1
```

The script installs both addons, verifies every runtime file using SHA-256, then removes only explicitly listed retired files from AkionUI. It does not touch other addons or WoW saved settings. Future updates use the same script and locations.

Restart WoW after the first installation so the new addon folder is discovered, then enable DarkWhisper Raid Tools in the addon list. Keep AkionUI enabled for the first login to import its old compass settings. Subsequent updates to existing files can be loaded with `/reload`.

For manual installation elsewhere, copy `DarkWhisperRaidTools` into `World of Warcraft\_retail_\Interface\AddOns\`. The manifest must be at `Interface\AddOns\DarkWhisperRaidTools\DarkWhisperRaidTools.toc`, without an extra folder level. AkionUI is optional and can be installed separately.

The manifest currently declares interface version `120100`. Check the running client's interface version with:

```text
/dump select(4, GetBuildInfo())
```

Changing the interface declaration does not replace functional testing.

## Verification

Run the simulated API tests from the project root with Lua 5.1:

```text
lua tests/smoke.lua
```

The suite covers 200 Moonkin cases, 84 Bloodlust cases and 39 Soothe cases, plus timers, protected values, absence of sound, menu interactions, dragging, saved settings and recovery after reload in combat. Compass checks cover marker replacement, moving an already assigned or hidden icon, clearing one or all markers, migration from old layouts, clicking and dragging numbered empty slots, empty slots after reload, creating and scrolling through 20 layouts, deleting custom layouts, preserving Default, north calibration, enable/disable persistence, scaled dragging, HUD position, unavailable heading data and recovery.

Additional regressions exercise all 256 marker assignment subsets, late map data, standalone startup without AkionUI or class APIs, legacy import in either addon load order, independent saved tables, and preservation of existing standalone settings. `tools/render_ui_preview.py` produces offline layout previews from the actual Lua UI construction; text rendering is approximate and raid symbols are schematic stand-ins.

These tests use simulated WoW APIs; they do not prove API availability or rendering during a real encounter. In-game verification should include:

1. Open `/aui` and `/akionui`, navigate all pages and close with Escape. Check English labels and placement controls.
2. As Balance, test Moonkin Form transitions in and out of combat. Change to another druid spec and verify the warning hides.
3. Receive a Bloodlust lockout, reload during it, and verify the timer and eventual READY state. Test hiding the ready icon and disabling its glow.
4. With Soothe learned, test all four combinations of enrage present/absent and Soothe ready/on cooldown. No sound should play, and global cooldown alone must not show the display.
5. In `/acomp`, clear a layout, click numbered empty slots to add icons, drag one, replace it with an icon already placed elsewhere, and check that only the destination remains. Remove one marker and test hiding/showing another.
6. Create layouts with **+**, rename them and select them from the dropdown. Delete a custom layout with **−** and verify Default remains. Reload and check that names, markers, empty positions, calibration and appearance persist.
7. Enable the compass, move the HUD and close settings. Verify it follows the character and lets clicks through. Disable it, reload and verify it stays hidden.
8. Set north and test live rotation both outdoors and during the intended encounter. Turning right should rotate the markers left when readable heading data is available.

## Implementation notes

`AkionUI/Core.lua` manages class-feature settings and player events. `MoonkinHUD.lua` uses form IDs and Balance specialization ID 102, with `C_SpecializationInfo` for specialization access. Unknown protected form data hides the warning. Form constants follow [Blizzard's Mainline constants](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_FrameXMLBase/Constants.lua).

`Bloodlust.lua` reads only named lockouts through `C_UnitAuras.GetPlayerAuraBySpellID` after checking `C_Secrets.ShouldSpellAuraBeSecret`. It polls four times per second while enabled, including when the ready icon is hidden. Sources: [aura API](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitAuraDocumentation.lua), [secrecy predicates](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SecretPredicateAPIDocumentation.lua) and [PulseCheck's lockout research](https://github.com/dbspringer/pulse-check/blob/main/bloodlust-detection-research.md).

`Soothe.lua` copies the ability's `LuaDurationObject`, using `ignoreGCD=true`, into a shared duration object for native text bindings. A native formatter rounds remaining seconds up. The cooldown text clears on expiry; inverse fallback text on aura slots prevents overlapping labels. Slots are configured only in `initializeFrame`; the addon never inspects their visibility or attaches scripts to them. See the historical [Soothe research](soothe-research.md) for sources and earlier designs.

`AkionUI/Options.lua` contains the class-feature menu. `DarkWhisperRaidTools/Core.lua` owns standalone settings and the optional legacy import. `DarkWhisperRaidTools/Compass.lua` manages layouts, heading access, calibration and the compass HUD; `DarkWhisperRaidTools/CompassOptions.lua` provides its graphical editor. Compass textures are generated by `tools/build_compass_assets.py`; raid marker icons use WoW's built-in textures.
