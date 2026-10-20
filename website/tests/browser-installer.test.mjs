import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import {readFileSync} from "node:fs";
import {resolve, dirname, basename, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyCatalog, validateCatalog, safePath, resolveRetail, installVerified, snapshotTree, verifyAddonFiles} from "../public/browser-install.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(site, "build/installer-tests");
await fs.mkdir(fixtureRoot, {recursive:true});
const envelope = JSON.parse(readFileSync(resolve(site, "public/api/v1/catalog.json"), "utf8"));
const catalog = await verifyCatalog(envelope);
const addon = catalog.addons[0];
const files = new Map(await Promise.all(addon.files.map(async file => [file.path,new Uint8Array(await fs.readFile(resolve(site,"public",new URL(file.url).pathname.slice(1))))])));
const domError = (name) => new DOMException(name,name);

function directory(path, fault = {}) {
  return {
    name:basename(path), kind:"directory",
    async getDirectoryHandle(name, options = {}) {
      assert.ok(!name.includes("/") && name !== ".." && name !== ".");
      const child = resolve(path,name);
      if (options.create) await fs.mkdir(child,{recursive:true});
      const stat = await fs.stat(child).catch(() => {throw domError("NotFoundError");});
      if (!stat.isDirectory()) throw domError("TypeMismatchError");
      return directory(child,fault);
    },
    async getFileHandle(name, options = {}) {
      assert.ok(!name.includes("/") && name !== ".." && name !== ".");
      const file = resolve(path,name);
      if (options.create) await fs.appendFile(file,new Uint8Array());
      const stat = await fs.stat(file).catch(() => {throw domError("NotFoundError");});
      if (!stat.isFile()) throw domError("TypeMismatchError");
      return {
        name,kind:"file",
        async getFile() { return new File([await fs.readFile(file)],name); },
        async createWritable() {
          if (fault.write && file.endsWith(sep + addon.id + sep + "Core.lua")) { fault.write = false; throw new Error("Simulated disk failure"); }
          let data;
          return { async write(bytes) { data=bytes; }, async close() { await fs.writeFile(file,data); }, async abort() {} };
        }
      };
    },
    async *entries() {
      for (const entry of await fs.readdir(path,{withFileTypes:true})) {
        yield [entry.name, entry.isDirectory() ? directory(resolve(path,entry.name),fault) : await this.getFileHandle(entry.name)];
      }
    },
    async removeEntry(name) {
      const target = resolve(path,name);
      assert.ok(target.startsWith(fixtureRoot + sep),"Deletion escaped test fixtures");
      if (fault.remove && name === addon.id) {
        fault.remove = false;
        await fs.unlink(resolve(target,"Old.lua"));
        throw new Error("Simulated interrupted recursive removal");
      }
      await fs.rm(target,{recursive:true});
    }
  };
}
async function fixture(fn, fault = {}) {
  const temp = await fs.mkdtemp(resolve(fixtureRoot,"case-"));
  try {
    const retail = resolve(temp,"World of Warcraft/_retail_");
    await fs.mkdir(resolve(retail,"Interface/AddOns/OtherAddon"),{recursive:true});
    await fs.mkdir(resolve(retail,"WTF/Account"),{recursive:true});
    await fs.writeFile(resolve(retail,"Wow.exe"),"test fixture");
    await fs.writeFile(resolve(retail,"Interface/AddOns/OtherAddon/Keep.lua"),"keep");
    await fs.writeFile(resolve(retail,"WTF/Account/Keep.lua"),"settings");
    await fn({temp,retail,root:directory(retail,fault)});
    assert.equal(await fs.readFile(resolve(retail,"Interface/AddOns/OtherAddon/Keep.lua"),"utf8"),"keep");
    assert.equal(await fs.readFile(resolve(retail,"WTF/Account/Keep.lua"),"utf8"),"settings");
  } finally {
    assert.ok(temp.startsWith(fixtureRoot + sep));
    await fs.rm(temp,{recursive:true});
  }
}
async function oldAddon(retail, version = "0.9.0") {
  const path = resolve(retail,"Interface/AddOns",addon.id);
  await fs.mkdir(resolve(path,"Empty"),{recursive:true});
  await fs.writeFile(resolve(path,addon.id+".toc"),"## Version: "+version);
  await fs.writeFile(resolve(path,"Old.lua"),"old");
}
test("rejects altered catalog signatures",async()=>{
  const damaged = {...envelope,signature:btoa("x".repeat(64))};
  await assert.rejects(verifyCatalog(damaged),/signature verification failed/);
});
test("blocks traversal, device names and duplicate file paths",()=>{
  for (const path of ["../x.lua","a/../../b.lua","a\\b.lua","C:/x.lua","a/CON.lua","a/nul.txt","a//b.lua","a/b."]) assert.throws(()=>safePath(path));
  const bad = structuredClone(catalog);bad.addons[0].files.push({...bad.addons[0].files[0]});
  assert.throws(()=>validateCatalog(bad),/duplicate/);
});
test("accepts WoW root and rejects Classic or fake Retail",async()=>fixture(async({temp,retail})=>{
  assert.equal((await resolveRetail(directory(dirname(retail)))).name,"_retail_");
  const classic=resolve(temp,"_classic_");await fs.mkdir(classic);
  await assert.rejects(resolveRetail(directory(classic)),/Choose World/);
  await fs.unlink(resolve(retail,"Wow.exe"));
  await assert.rejects(resolveRetail(directory(retail)),/not a WoW Retail/);
}));
test("installs actual release files and preserves unrelated data",async()=>fixture(async({retail,root})=>{
  await installVerified(root,addon,files);
  for (const [name,bytes] of files) assert.deepEqual(new Uint8Array(await fs.readFile(resolve(retail,"Interface/AddOns",addon.id,name))),bytes);
}));
test("upgrades without retained copies and removes stale files",async()=>fixture(async({retail,root})=>{
  await oldAddon(retail);
  const result=await installVerified(root,addon,files);
  assert.equal(result.backupPath,undefined);
  await assert.rejects(fs.stat(resolve(retail,"Interface/AddOns/.darkwhispers-web-backups")));
  await assert.rejects(fs.stat(resolve(retail,"Interface/AddOns",addon.id,"Old.lua")));
}));
test("rejects corrupt buffers and does not overwrite an existing addon",async()=>fixture(async({retail,root})=>{
  await oldAddon(retail);
  const damaged=new Map(files);damaged.set("Core.lua",new Uint8Array([1,2,3]));
  await assert.rejects(installVerified(root,addon,damaged),/integrity/);
  assert.equal(await fs.readFile(resolve(retail,"Interface/AddOns",addon.id,"Old.lua"),"utf8"),"old");
}));
test("blocks downgrades and unrecognized existing folders",async()=>fixture(async({retail,root})=>{
  await oldAddon(retail,"99.0.0");
  await assert.rejects(installVerified(root,addon,files),/Downgrade/);
  await fs.unlink(resolve(retail,"Interface/AddOns",addon.id,addon.id+".toc"));
  await assert.rejects(installVerified(root,addon,files),/unrecognized/);
}));
test("restores previous addon on a live write failure",async()=>fixture(async({retail,root})=>{
  await oldAddon(retail);
  await assert.rejects(installVerified(root,addon,files),/previous addon was restored/);
  assert.equal(await fs.readFile(resolve(retail,"Interface/AddOns",addon.id,"Old.lua"),"utf8"),"old");
  const restored=await snapshotTree(await (await root.getDirectoryHandle("Interface")).getDirectoryHandle("AddOns").then(d=>d.getDirectoryHandle(addon.id)));
  assert.equal(restored.size,2);
},{write:true}));
test("restores after partial recursive deletion failure",async()=>fixture(async({retail,root})=>{
  await oldAddon(retail);
  await assert.rejects(installVerified(root,addon,files),/previous addon was restored/);
  assert.equal(await fs.readFile(resolve(retail,"Interface/AddOns",addon.id,"Old.lua"),"utf8"),"old");
},{remove:true}));
test("removes only incomplete new install if the disk write fails",async()=>fixture(async({retail,root})=>{
  await assert.rejects(installVerified(root,addon,files),/Simulated disk failure/);
  await assert.rejects(fs.stat(resolve(retail,"Interface/AddOns",addon.id)));
},{write:true}));
test("download hash verification rejects corrupted content",async()=>{
  const previous = globalThis.fetch;
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));
  try {await assert.rejects(verifyAddonFiles(addon),/SHA-256/);}
  finally {globalThis.fetch=previous;}
});
