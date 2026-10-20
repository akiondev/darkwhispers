// Only copied to a local QA page, never published. No access to host WoW files.
import {loadCatalog,sha256} from "/browser-install.mjs";
let sandbox, retail, token;
window.showDirectoryPicker = async () => {
  if (!retail) throw new Error("Prepare the private browser sandbox first.");
  return retail;
};
const write = async (dir,name,contents) => {
  const file=await dir.getFileHandle(name,{create:true}), stream=await file.createWritable();
  await stream.write(contents);await stream.close();
};
const read = async (dir,name) => (await (await dir.getFileHandle(name)).getFile()).text();
const panel=document.createElement("aside");
panel.style.cssText="position:fixed;left:8px;top:8px;z-index:20;background:#061627;padding:8px;max-width:200px;border:1px solid #689";
const status=document.createElement("p");status.textContent="Private browser filesystem test. No host folder access.";status.style.fontSize="10px";
for (const [name,action] of [
  ["Prepare browser sandbox",async()=>{
    sandbox=await navigator.storage.getDirectory();token="darkwhispers-qa-"+crypto.randomUUID();
    const root=await sandbox.getDirectoryHandle(token,{create:true});retail=await root.getDirectoryHandle("_retail_",{create:true});
    await write(retail,"Wow.exe","fixture");
    const ui=await retail.getDirectoryHandle("Interface",{create:true}),addons=await ui.getDirectoryHandle("AddOns",{create:true});
    const other=await addons.getDirectoryHandle("OtherAddon",{create:true});await write(other,"Keep.lua","keep");
    const old=await addons.getDirectoryHandle("DarkWhisperRaidTools",{create:true});await write(old,"DarkWhisperRaidTools.toc","## Version: 0.9.0");await write(old,"Old.lua","old");
    const wtf=await retail.getDirectoryHandle("WTF",{create:true});await write(wtf,"Keep.lua","settings");
    status.textContent="Sandbox ready. Use Install an addon → Choose folder → Install to WoW.";
  }],
  ["Verify browser installation",async()=>{
    const catalog=await loadCatalog(),addon=catalog.addons[0];
    const ui=await retail.getDirectoryHandle("Interface"),addons=await ui.getDirectoryHandle("AddOns"),installed=await addons.getDirectoryHandle(addon.id);
    for(const file of addon.files){
      let parent=installed;const parts=file.path.split("/"),name=parts.pop();for(const part of parts)parent=await parent.getDirectoryHandle(part);
      const bytes=await(await(await parent.getFileHandle(name)).getFile()).arrayBuffer();
      if(await sha256(bytes)!==file.sha256)throw new Error("Hash mismatch: "+file.path);
    }
    if(await read(await addons.getDirectoryHandle("OtherAddon"),"Keep.lua")!=="keep")throw new Error("Other addon changed");
    if(await read(await retail.getDirectoryHandle("WTF"),"Keep.lua")!=="settings")throw new Error("Saved settings changed");
    const backups=await addons.getDirectoryHandle(".darkwhispers-web-backups");let backedUp=false;
    for await(const [name,handle]of backups.entries())if(name.startsWith(addon.id+"-")&&await read(handle,"Old.lua")==="old")backedUp=true;
    if(!backedUp)throw new Error("Backup missing");
    status.textContent="PASS: 7 real browser files match SHA-256; old addon backed up; OtherAddon and WTF preserved.";
  }],
  ["Clean browser sandbox",async()=>{
    if(sandbox&&token)await sandbox.removeEntry(token,{recursive:true});retail=null;status.textContent="Private browser sandbox removed.";
  }]
]){
  const button=document.createElement("button");button.textContent=name;button.className="button secondary";button.style.margin="3px";
  button.addEventListener("click",async()=>{try{await action();}catch(error){status.textContent="FAIL: "+error.message;}});
  panel.append(button);
}
panel.append(status);document.body.append(panel);
