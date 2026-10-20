# Soothe: efterforskning och versionshistorik

## Nuvarande utformning: 0.5.0, endast text

Användarens `/aui status` visade `aura_restricted` i 0.4.2, samtidigt som det manuella testljudet fungerade och den inbyggda ENRAGE-texten syntes. Detta bekräftade att den gamla generella ljudvägen stoppades av auraskyddet i den testade situationen. Användaren valde därefter att ta bort både ljud och ikon.

Det nya kravet är ENRAGE vid enrage, ENRAGE: sekunder under Soothe-cooldown (även utan enrage), annars ingen text. Av/på, dragning och textstorlek finns i menyn. Ingen röst eller bred buffläsning finns kvar. Den tidigare placeringen behålls.

Verifierade primärkällor inför ändringen:

- [DurationUtil](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/DurationUtilDocumentation.lua) skapar duration-objekt och automatisk textbinding.
- [DurationTextBinding](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/DurationTextBindingObjectAPIDocumentation.lua) stöder fontsträng, formatter, automatisk uppdatering och särskilda texter för noll/utgången tid.
- [NumericRuleFormatBreakpoint](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/NumericRuleFormatterSharedDocumentation.lua) stöder steg, avrundning uppåt och format med högst en numerisk platshållare, inklusive konstant tomt format.
- [LuaDurationObject:Assign](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/LuaDurationObjectAPIDocumentation.lua) kopierar ett annat duration-objekt utan egna beräkningar på dess tider.

En fristående binding visar countdown med tom fallback. Enrage-slotens binding visar tomt under cooldown och ENRAGE vid noll/utgången tid. De delar ett beständigt duration-objekt, som uppdateras från Soothe. Den inbyggda aura-containern styr fortfarande om själva enrage-slotens text finns på skärmen. Ingen färdig aura-knapp eller dess barn inspekteras eller ändras från addon-Lua.

Lokala Lua 5.1-tester täcker samtliga fyra synlighetsfall med offentliga/skyddade värden, timer efter borttagen enrage, utgången timer, återställning, reload, GCD, icke-druider, olärd förmåga, sparad placering, GUI och helt uteblivna ljud/buffläsningar. Testharnessen modellerar native textbinding; verklig rendering i WoW behöver kontrolleras av användaren efter reload.

## Historik: inför 0.4.0

Kontrollerat 2026-09-24 mot Retail 12.1-källkod. Källorna nedan är Blizzard-kod i Gethe-spegeln samt addonförfattares egen implementation. De inhämtades före implementationen. Live-klienttest återstår.

## Slutsats

Cooldown-ikonen går att implementera utan att läsa hemliga tidsvärden. Enrage kan filtreras och visas av Blizzards aura-container. Ett generellt röstutrop för godtycklig enrage har däremot ingen motsvarande inbyggd regel: `AddAuraSound` kräver ett spell-ID. Tillgång till fiendens aura-data begränsas i 12.1, och dispeltyp kan dessutom vara redigerad även för den inbyggda presentationen. Därför går det inte att lova det ursprungligen önskade beteendet i allt innehåll.

0.4.0 levererar cooldown, strikt enrage-markering och röst för bekräftad läsbar enrage. Den visar begränsat ljudläge på ikonen och i menyn. Den försöker inte kringgå skyddade värden eller härleda auror från andra addons, renderad text, visibility-hooks eller stridsloggen.

## Källor och beslut

- [Blizzards SpellDocumentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpellDocumentation.lua): `GetSpellCooldownDuration(spellIdentifier, ignoreGCD)` lämnar ett duration-objekt. Soothe använder ID 2908 och `ignoreGCD=true`.
- [Blizzards Cooldown-dokumentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/FrameAPICooldownDocumentation.lua): `SetCooldownFromDurationObject` och inbyggda countdown-siffror ger aktuell timer utan Lua-beräkningar på hemliga värden.
- [Blizzards CustomAuraContainer](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_AuraContainer/Blizzard_CustomAuraContainer.lua) och [filterimplementation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_AuraContainer/Blizzard_AuraContainerUtil.lua): `AddAuraSlot` stöder `candidateFilters.includeDispelTypes`. Identitetsfilter med spell-ID är begränsade för buffs på fiender. Soothe deklarerar en dispeltypsregel, utan spell-ID-listor.
- [Blizzards AuraUtil](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_FrameXMLUtil/AuraUtil.lua): `DISPELLABLE` betyder dispellable oberoende av gruppens klasser. `RAID_PLAYER_DISPELLABLE` omfattar gruppens förmågor och garanterar därför inte att just Soothe kan ta bort buffen. Enrage-typen behöver kontrolleras separat.
- [EllesmereUINameplates aktuella implementation](https://github.com/EllesmereGaming/EllesmereUI/blob/main/EllesmereUINameplates/EUI_Nameplates_AuraContainers.lua): författaren rapporterar redigerade dispeltyper i begränsat innehåll. Dess bredare glow faller tillbaka till alla dispellable buffs. AkionUI gör **inte** den breddningen, eftersom det skulle ge falska Soothe-larm för magiska buffs. Tom sträng accepteras som äldre enrage-typ bara efter spelets DISPELLABLE-filter; nil accepteras inte.
- [Blizzards UnitAuraSoundInfo](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitConstantsDocumentation.lua) och [AddAuraSound](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitAuraDocumentation.lua): ljudregeln tar unitToken, spellID och fil/kanal. Den har inget generellt dispel-/enrage-filter. En hårdkodad lista över några encounter-spells skulle inte uppfylla önskemålet om alla enrage-effekter och används inte.
- [Blizzards secrecypredikat](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SecretPredicateAPIDocumentation.lua) och [access-preconditions](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SecretPredicatesDocumentation.lua): bred aura-läsning kräver åtkomst och kan annars ge fel. Ljudvägen anropar den bara när `ShouldAurasBeSecret` finns och svarar false, och skyddar fortfarande varje aura/typ med `issecretvalue`.
- [Blizzards frame-provider](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_AuraContainer/Blizzard_AuraContainerFrameProviders.lua): restriktionerna appliceras efter `initializeFrame`. All styling av slot-knappen görs där. Storlek ändras via dess yttre, egna förälder; den färdiga knappen inspekteras inte. Skapande skjuts upp efter combat-reload tills striden är över.

## Verifiering

Lua 5.1-tester använder mockar som avvisar aura-läsning i skyddat läge och API-anrop på färdiginitierade aura-knappar. Testerna täcker även klass/spec, olärd Soothe, samtliga typer av bevakade units, magiska/vänliga/döda mål, null/secret-typ, gemensam ljudpaus, avstängning, GUI, storlek, placering och återladdning. Röstfilens WAV-format, längd och icke-tysta sampledata har verifierats lokalt.

Återstående klienttest: verkligt Soothe-cast och cooldown, native-filter mot enrage i dungeon/raid/PvP, faktisk ljuduppspelning, UI-layout och dragning i WoW. Lokala tester är inte bevis för att enrage-uppgifter exponeras i en viss encounter.

## Andra granskningen: 0.4.1

Kontrollen av installerad `Wow.exe` visade version **12.1.0.69933**. Det stämmer med addonens 12.1-mål. Ny läsning av [ljudregelns API-definition](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitConstantsDocumentation.lua) gav fortfarande inget generellt enrage-filter.

Konkreta luckor i första versionen: ljud kunde spelas under egen cooldown, för en avlägsen fiende och när spelaren var död; det saknades också måltext. 0.4.1 lägger till ett påslaget men valbart villkor för redo/användbar/inom räckhåll, visar ett läsbart målnamn och pausar bevakningen vid död. Om ett mål är för långt bort söker den vidare efter ett annat inom räckhåll. Okänd räckvidd eller beredskap ger ingen röst med villkoret på.

Verifierade API:er: [LuaDurationObject:GetRemainingDuration](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/LuaDurationObjectAPIDocumentation.lua) och [C_Spell.IsSpellUsable / IsSpellInRange](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpellDocumentation.lua). Värden kontrolleras för sekretess innan jämförelse. Siktlinje och immunitet garanteras inte av dessa kontroller.

Regressionstesterna täcker nu även cooldown→redo, utom räckhåll, okända/hemliga värden, flera enrage-mål, död/återupplivning, hemliga namn och sparat ljudvillkor. Inga av testerna ersätter den kvarstående kontrollen i en verklig dungeon/raid.
