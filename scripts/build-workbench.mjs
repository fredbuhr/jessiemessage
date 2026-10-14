import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(join(root,path),'utf8');
const template = await read('design/preview.html');
const files = ['design/admin-tools.js','design/admin-tools-ui.js','design/dark-ui.js'];
const scripts = await Promise.all(files.map(read));
const css = await read('design/dark.css');
const brandCSS = await read('public/brand/brand.css');
for (const script of scripts) if (/<\/script/i.test(script)) throw new Error('Unsafe inline script delimiter');
for (const text of [css,brandCSS]) if (/<\/style/i.test(text)) throw new Error('Unsafe inline style delimiter');
const additions = scripts.slice(0,2).map((text,i)=>`<script id="admin-extension-${i}">\n${text}\n</script>`).join('\n')
  + `\n<style id="jessie-night">\n${css}\n</style>\n<style id="jessie-brand">\n${brandCSS}\n</style>\n<script id="night-ui">\n${scripts[2]}\n</script>`;
let html = template.replace('content="#f6f4ef"','content="#100d12"').replace('</body>',additions+'\n</body>');
if (!html.includes('admin-extension-1') || !html.includes('id="night-ui"')) throw new Error('Missing insertion point');
if (!html.includes('<script id="local-branding" type="application/json">{}</script>')) throw new Error('Do not publish personal branding in build artifacts');
// The only embedded images added by this build are the exact, approved public brand assets.
// Keep personal portraits, client photographs and all arbitrary image data out of the repository.
if (/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{30}/.test(html)) throw new Error('Embedded personal image');
const registry = JSON.parse(await read('public/brand/asset-manifest.json'));
const allowed = new Set();
for (const name of ['brand/icon-32.png','brand/icon-48.png','brand/icon-64.png','brand/icon-128.png','brand/icon-192.png','apple-touch-icon.png']) {
  const bytes = await readFile(join(root,'public',name));
  const record = registry.assets.find(item => item.file === '/'+name);
  if (!record || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Brand asset integrity mismatch: '+name);
  const uri = 'data:image/png;base64,'+bytes.toString('base64');
  allowed.add(uri);
  html = html.replaceAll('../public/'+name,uri);
}
for (const match of html.matchAll(/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+/g)) {
  if (!allowed.has(match[0])) throw new Error('Unexpected embedded image');
}
if (html.includes('../public/')) throw new Error('Unresolved offline asset');
const out = join(root,'artifacts');
await mkdir(out,{recursive:true});
// Atomic output keeps concurrent build/check invocations from exposing a partial HTML.
const atomicWrite = async (name, value) => {
  const tmp = join(out,`${name}.${process.pid}.tmp`);
  await writeFile(tmp,value);
  await rename(tmp,join(out,name));
};
await atomicWrite('JessieMessage.html',html);
await atomicWrite('SHA256.txt',createHash('sha256').update(html).digest('hex')+'  JessieMessage.html\n');
await atomicWrite('LIRE-EN-PREMIER.txt',`JESSIEMESSAGE — NUIT, ICÔNE VALIDÉE (0.3.1)\n\nOuvrir JessieMessage.html dans un navigateur. Aucun terminal, compte ou serveur nécessaire.\nLe symbole et ses couleurs sont conservés exactement depuis le pack PNG validé.\nLe nom visuel est Jessie. Le domaine et le nom technique JessieMessage ne changent pas.\nAccueil / Messages / Admin permettent de tester les interfaces.\nAucun compte réel, aucun e-mail, Web Push ou envoi entre appareils. Les données disparaissent au rechargement.\nLes icônes mobiles et le manifeste sont préparés séparément dans public/ pour un futur hébergement HTTPS.\nCette maquette HTML hors ligne n’est pas une application installable de production.\nAucun portrait personnel n’est inclus dans cet export public. Photo charge une référence locale.\nNe pas publier cet atelier comme messagerie de production.\n`);
console.info('Atelier Nuit créé avec les icônes approuvées : artifacts/JessieMessage.html');
