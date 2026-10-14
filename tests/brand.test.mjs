import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createAppServer } from '../server/index.mjs';
const bytes = name => readFileSync(new URL('../public/'+name, import.meta.url));
const text = name => bytes(name).toString('utf8');
const registry = JSON.parse(text('brand/asset-manifest.json'));
let server,base;
before(async()=>{server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const pngInfo = data => {
  assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return {width:data.readUInt32BE(16),height:data.readUInt32BE(20),colourType:data[25]};
};
test('all declared assets match their locked SHA-256',()=>{
  assert.equal(registry.revision,'approved-2026-10-14');
  for(const asset of registry.assets) assert.equal(createHash('sha256').update(bytes(asset.file.slice(1))).digest('hex'),asset.sha256,asset.file);
});
test('approved transparent PNGs retain their exact sizes and alpha',()=>{
  for(const size of [16,32,48,64,128,192,512]) assert.deepEqual(pngInfo(bytes(`brand/icon-${size}.png`)),{width:size,height:size,colourType:6});
});
test('favicon is multi-size ICO, not a disguised PNG',()=>{
  const data=bytes('favicon.ico');assert.equal(data.readUInt16LE(0),0);assert.equal(data.readUInt16LE(2),1);
  const sizes=Array.from({length:data.readUInt16LE(4)},(_,i)=>data[6+i*16]||256);
  for(const n of [16,32,48]) assert.ok(sizes.includes(n));
});
test('apple and maskable variants are opaque without changing the emblem concept',()=>{
  assert.deepEqual(pngInfo(bytes('apple-touch-icon.png')),{width:180,height:180,colourType:2});
  assert.deepEqual(pngInfo(bytes('brand/icon-maskable-512.png')),{width:512,height:512,colourType:2});
  assert.ok(registry.maskableEmblemMaxRadius<512*.4);
});
test('manifest uses the approved brand and explicit independent masking purpose',()=>{
  const m=JSON.parse(text('manifest.webmanifest'));
  assert.equal(m.name,'JessieMessage');assert.equal(m.short_name,'Jessie');assert.equal(m.id,'/');
  assert.equal(m.theme_color,'#100d12');assert.equal(m.background_color,'#100d12');
  for(const icon of m.icons){const info=pngInfo(bytes(icon.src.slice(1)));assert.equal(icon.sizes,`${info.width}x${info.height}`);assert.equal(icon.type,'image/png');}
  assert.equal(m.icons.filter(icon=>icon.purpose==='maskable').length,1);
});
test('visible brand uses live Jessie text, no raster wordmark or old J tile',()=>{
  const html=text('index.html');
  assert.match(html,/<span class="brand-name">Jessie<\/span>/);
  assert.match(html,/src="\/brand\/icon-128.png"/);
  assert.doesNotMatch(html,/\/icon\.svg|brand-accent/);
  assert.match(text('brand/brand.css'),/object-fit:contain/);
  assert.match(text('brand/brand.css'),/text-shadow:none/);
});
test('Jessie fallback avatar preserves the icon while portrait cropping stays separate',()=>{
  const html = readFileSync(new URL('../design/preview.html', import.meta.url), 'utf8');
  const source = html.split('\n').find(line=>line.startsWith('function avatar('));
  const fallback = runInNewContext(source+'; avatar("Jessie", true)', {portrait:'', esc:value=>value});
  assert.match(fallback, /class="avatar brand-avatar"/);
  assert.match(fallback, /icon-64\.png/);
  const portrait = runInNewContext(source+'; avatar("Jessie", true)', {portrait:'blob:local-portrait', esc:value=>value});
  assert.doesNotMatch(portrait, /brand-avatar/);
  const client = runInNewContext(source+'; avatar("Alex")', {portrait:'', esc:value=>value});
  assert.doesNotMatch(client, /brand-avatar/);
  assert.match(text('brand/brand.css'), /\.avatar\.brand-avatar img \{ object-fit:contain; object-position:center; transform:none; \}/);
});
test('served favicon, apple icon and declared image routes return exact approved bytes',async()=>{
  for(const asset of registry.assets){const response=await fetch(base+asset.file);assert.equal(response.status,200,asset.file);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes(asset.file.slice(1)));assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
});
test('manifest and shared brand styles are reachable over the public server',async()=>{
  for(const [path,type] of [['/manifest.webmanifest','application/manifest+json'],['/brand/brand.css','text/css']]){
    const response=await fetch(base+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type));
  }
});
test('legacy icon and non-whitelisted brand/private resources remain inaccessible',async()=>{
  for(const path of ['/icon.svg','/brand/asset-manifest.json','/brand/.env','/design/preview.html','/artifacts/JessieMessage.html','/brand/../server/index.mjs'])assert.equal((await fetch(base+path)).status,404,path);
});
test('favicon cache revision does not change the chosen graphic',async()=>{
  const response=await fetch(base+'/favicon.ico?v=identity-01');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes('favicon.ico'));
});
