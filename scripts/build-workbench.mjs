import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(join(root,path),'utf8');
const template = await read('design/preview.html');
const files = ['design/admin-tools.js','design/admin-tools-ui.js','design/dark-ui.js'];
const scripts = await Promise.all(files.map(read));
const css = await read('design/dark.css');
for (const script of scripts) if (/<\/script/i.test(script)) throw new Error('Unsafe inline script delimiter');
if (/<\/style/i.test(css)) throw new Error('Unsafe inline style delimiter');
// Place the theme after the management UI's dynamic style; keep all business rules unchanged.
const additions = scripts.slice(0,2).map((text,i)=>`<script id="admin-extension-${i}">\n${text}\n</script>`).join('\n')
  + `\n<style id="jessie-night">\n${css}\n</style>\n<script id="night-ui">\n${scripts[2]}\n</script>`;
const html = template.replace('content="#f6f4ef"','content="#100d12"').replace('</body>',additions+'\n</body>');
if (!html.includes('admin-extension-1') || !html.includes('id="night-ui"')) throw new Error('Missing insertion point');
if (!html.includes('<script id="local-branding" type="application/json">{}</script>')) throw new Error('Do not publish personal branding in build artifacts');
if (/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{30}/.test(html)) throw new Error('Embedded personal image');
const out = join(root,'artifacts');
await mkdir(out,{recursive:true});
await writeFile(join(out,'JessieMessage.html'),html);
await writeFile(join(out,'SHA256.txt'),createHash('sha256').update(html).digest('hex')+'  JessieMessage.html\n');
await writeFile(join(out,'LIRE-EN-PREMIER.txt'),`JESSIEMESSAGE — NUIT V2 (ATELIER 0.3)\n\nOuvrir JessieMessage.html dans un navigateur. Aucun terminal, compte ou serveur nécessaire.\nAccueil / Messages / Admin permettent de tester les interfaces.\nSur mobile, la conversation occupe l’écran et les outils administrateur sont regroupés en bas.\nLa maquette adapte sa hauteur au viewport ; le clavier doit encore être essayé sur de vrais appareils.\nLes comptes et invitations sont fictifs ; toutes les saisies disparaissent au rechargement.\nAucun e-mail, Web Push ni envoi réel. Pas de base de données ni authentification.\nLa déclaration 18+ ne vérifie pas la majorité. Les pages légales sont des brouillons.\nAucune photographie personnelle dans l’archive GitHub : Photo charge une référence localement.\nNe pas publier cet atelier comme messagerie de production.\n`);
console.info('Atelier Nuit créé : artifacts/JessieMessage.html (sans données réelles)');
