import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { execFileSync } from 'node:child_process';
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const css=read('design/dark.css');
const code=read('design/dark-ui.js');
function luminance(hex) {
  const rgb=hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }

test('dark presentation parses without dependencies, networking or persistence',()=>{
  new Script(code);
  assert.doesNotMatch(code,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(css,/@import|url\(/);
});
test('dark state is namespaced, not a collision with demo navigation selectors',()=>{
  assert.match(code,/dataset\.nightView/);
  assert.doesNotMatch(code,/document\.body\.dataset\.view\s*=/);
  assert.match(css,/data-night-view="client"/);
});
test('core reading colours exceed 4.5:1, including muted and button text',()=>{
  const pairs=[['#f5eef2','#100d12'],['#bcaebb','#1b161e'],['#f9eef5','#422638'],['#f4edf4','#2d2833'],['#fff8fc','#71354f'],['#d8b999','#211824'],['#b7a3b6','#171219']];
  for(const [text,background] of pairs){assert.ok(css.includes(text)&&css.includes(background));assert.ok(contrast(text,background)>=4.5,`${text}/${background}: ${contrast(text,background)}`);}
});
test('mobile layout handles safe areas, visual viewport and reduced motion',()=>{
  assert.match(css,/safe-area-inset-bottom/); assert.match(css,/safe-area-inset-left/);
  assert.match(css,/--app-height,100dvh/); assert.match(code,/visualViewport/);
  assert.match(code,/viewport\.scale-1/); assert.match(css,/prefers-reduced-motion:reduce/);
});
test('mobile text and primary controls remain thumb friendly',()=>{
  assert.match(css,/font-size:16px/); assert.match(css,/min-height:44px/);
  assert.match(css,/min-width:48px/); assert.match(code,/growComposer/);
  assert.doesNotMatch(read('design/preview.html'),/user-scalable=no|maximum-scale=1/);
});
test('message content remains escaped and media is restricted to current demo thread',()=>{
  assert.match(code,/esc\(message\.text\)/);
  assert.match(code,/state\.messages\[ui\.client\]\.some/);
  assert.match(code,/from-jessie/); assert.match(code,/from-client/);
  assert.doesNotMatch(code,/ageVerified\s*[:=]\s*true/);
});
test('a thread rerender preserves position while reading earlier messages',()=>{
  assert.match(code,/sameThread && !newMessage && !nearEnd \? scrollTop/);
  assert.match(code,/lastClient===ui\.client/);
});
test('built artifact includes all layers with private branding excluded',()=>{
  execFileSync(process.execPath,[new URL('../scripts/build-workbench.mjs',import.meta.url).pathname]);
  const html=read('artifacts/JessieMessage.html');
  assert.ok(html.indexOf('id="jessie-night"')>html.indexOf('id="admin-extension-1"'));
  assert.ok(html.indexOf('id="night-ui"')>html.indexOf('id="jessie-night"'));
  assert.match(html,/content="#100d12"/);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/<script id="local-branding" type="application\/json">\{\}<\/script>/);
  assert.doesNotMatch(html,/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{30}/);
});
