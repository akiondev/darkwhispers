import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,existsSync,rmSync} from "node:fs";
import {resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createPublicKey,generateKeyPairSync,verify} from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const output = resolve(root,"website/build/catalog-publisher-tests");
mkdirSync(output,{recursive:true});
test("catalog publication preserves trust, rejects wrong keys, and requires explicit initialization",()=>{
  const project = mkdtempSync(resolve(output,"fixture-"));
  try {
  const helper = resolve(project,"launcher/build-tools/publish-catalog.mjs");
  mkdirSync(dirname(helper),{recursive:true});
  cpSync(resolve(root,"launcher/build-tools/publish-catalog.mjs"),helper);
  const addonBase = existsSync(resolve(root,"addons")) ? resolve(root,"addons") : root;
  cpSync(resolve(addonBase,"DarkWhisperRaidTools"),resolve(project,"DarkWhisperRaidTools"),{recursive:true});
  mkdirSync(resolve(project,"website/public/downloads"),{recursive:true});
  const envelope = JSON.parse(readFileSync(resolve(root,"website/public/api/v1/catalog.json"),"utf8"));
  const payload = JSON.parse(Buffer.from(envelope.payload,"base64"));
  const name = "DarkWhisperRaidTools-"+payload.addons[0].version+".zip";
  cpSync(resolve(root,"out/addons",name),resolve(project,"website/public/downloads",name));
  const run = (args=[],extra={}) => spawnSync(process.execPath,[helper,...args],{
    cwd:project,encoding:"utf8",env:{...process.env,DARKWHISPERS_SIGNING_KEY:resolve(project,".tools/test-key.pem"),...extra}
  });
  assert.notEqual(run().status,0);
  assert.throws(()=>readFileSync(resolve(project,".tools/test-key.pem")),{code:"ENOENT"});
  const initialized = run(["--init-key"]);
  assert.equal(initialized.status,0,initialized.stderr);
  const publicFile = resolve(project,"launcher/crates/addon-core/src/catalog-public-key.bin");
  const publicBytes = readFileSync(publicFile);
  const key = createPublicKey(readFileSync(resolve(project,".tools/test-key.pem")));
  assert.equal(publicBytes.length,32);
  const signedFile = resolve(project,"website/public/api/v1/catalog.json");
  const signed = readFileSync(signedFile);
  const data = JSON.parse(signed);
  assert.equal(verify(null,Buffer.from(data.payload,"base64"),key,Buffer.from(data.signature,"base64")),true);
  assert.equal(run().status,0);
  assert.deepEqual(readFileSync(publicFile),publicBytes);
  const replacement = generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"});
  writeFileSync(resolve(project,".tools/wrong-key.pem"),replacement);
  assert.notEqual(run([],{DARKWHISPERS_SIGNING_KEY:resolve(project,".tools/wrong-key.pem")}).status,0);
  assert.deepEqual(readFileSync(publicFile),publicBytes);
  assert.deepEqual(readFileSync(signedFile),signed);
  } finally {
    assert.ok(resolve(project).startsWith(resolve(output)+sep), "Fixture cleanup outside test directory refused");
    rmSync(project,{recursive:true,force:true});
  }
});
