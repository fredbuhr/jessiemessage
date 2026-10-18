import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const html = readFileSync(new URL('../design/preview.html', import.meta.url), 'utf8');
const modelSource = html.match(/<script id="demo-model">([\s\S]*?)<\/script>/)?.[1];
const uiSource = html.match(/<script id="demo-ui">([\s\S]*?)<\/script>/)?.[1];
const sandbox = createContext({});
new Script(modelSource).runInContext(sandbox);
const { initialState, plan, dispatch } = sandbox.JessieDemo;
const plain = value => JSON.parse(JSON.stringify(value));

test('preview scripts parse and need no production credentials', () => {
  assert.ok(modelSource && uiSource);
  new Script(uiSource);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(modelSource + uiSource, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
});
test('public design source has no embedded personal reference images', () => {
  assert.match(html, /<script id="local-branding" type="application\/json">\{\}<\/script>/);
  assert.doesNotMatch(html, /data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{30}/);
});
test('declared age is not recorded as verified age', () => {
  const s = initialState();
  assert.equal(s.ageDeclared, false);
  assert.equal('ageVerified' in s, false);
  assert.match(html, /Cette case n’est pas une vérification d’âge/);
});
test('initial delivery history agrees with the message history', () => {
  const s = initialState();
  for (const c of s.clients) {
    const delivered = [...new Set(s.messages[c.id].filter(m => m.from === 'jessie').flatMap(m => m.media))];
    assert.deepEqual(plain(c.sent), plain(delivered));
  }
});
test('planning excludes inactive users and skips fully duplicate deliveries', () => {
  const s = initialState();
  const before = JSON.stringify(s);
  assert.deepEqual(plain(plan(s, {mediaIds:['m2']})), [
    {clientId:'alex',mediaIds:['m2'],duplicates:0,skip:false},
    {clientId:'liam',mediaIds:['m2'],duplicates:0,skip:false},
    {clientId:'hugo',mediaIds:[],duplicates:1,skip:true}
  ]);
  assert.equal(JSON.stringify(s), before);
});
test('a private tag segment and communication preference both apply', () => {
  const s = initialState();
  assert.deepEqual(plain(plan(s, {group:'FR',purpose:'marketing',text:'News'}).map(r=>r.clientId)), ['alex']);
  assert.deepEqual(plain(plan(s, {group:'FR',purpose:'service',text:'Requested'}).map(r=>r.clientId)), ['alex','hugo']);
});
test('partial duplicates are removed without excluding new content', () => {
  const s = initialState();
  const alex = plan(s, {group:'VIP',mediaIds:['m1','m1','m2']})[0];
  assert.deepEqual(plain(alex.mediaIds), ['m2']);
  assert.equal(alex.duplicates, 1);
  assert.equal(alex.skip, false);
});
test('unknown assets and purposes are rejected; empty drafts have no recipients', () => {
  const s = initialState();
  assert.throws(()=>plan(s,{mediaIds:['unknown']}), /Unknown media/);
  assert.throws(()=>plan(s,{purpose:'unknown',text:'test'}), /Invalid purpose/);
  assert.deepEqual(plain(plan(s,{})), []);
});
test('a campaign creates separate messages and is idempotent', () => {
  const s = initialState();
  const options = {mediaIds:['m2'],text:'A new moment'};
  assert.equal(dispatch(s, options, 'one'), 2);
  assert.equal(dispatch(s, options, 'one'), 0);
  const a=s.messages.alex.at(-1), b=s.messages.liam.at(-1);
  assert.notEqual(a,b);
  assert.notEqual(a.media,b.media);
  assert.equal(s.messages.hugo.length,1);
  assert.equal(s.messages.max.length,0);
  assert.deepEqual(plain(s.clients.find(c=>c.id==='alex').sent), ['m1','m2']);
  assert.equal(dispatch(s, options, 'two'), 0, 'fresh key still respects asset history');
});
test('explicit re-send override remains possible and deduplicates the ledger', () => {
  const s=initialState();
  assert.equal(dispatch(s,{group:'VIP',mediaIds:['m1'],skipDuplicates:false},'override'),1);
  assert.deepEqual(plain(s.clients.find(c=>c.id==='alex').sent), ['m1']);
});
