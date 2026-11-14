'use strict';
// Self-check for the campaign: `node game/check-story.js` (also run by check.js).
// Validates story content against the book and the models, then plays the
// campaign along scripted paths and asserts each reaches its ending.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const data = require('./data.js');
const story = require('./story.js');
const L = require('./logic.js');

const factIds = new Set(data.entries.flatMap((e) => e.facts.map((f) => f.id)));
const entryNight = new Map(data.entries.flatMap((e) => e.facts.map((f) => [f.id, e.night || 0])));
const modelExists = (name) => fs.existsSync(path.join(__dirname, 'models', `${name}.glb`));
const list = (v) => [].concat(v || []);

// ---- Content integrity -----------------------------------------------------
const setFlags = new Set();
const usedFlags = new Set();
const useConditions = (item) => [...list(item.if), ...list(item.unless), ...list(item.ifAny)].forEach((f) => usedFlags.add(f));

for (const [id, def] of Object.entries(story.cases)) {
  assert.strictEqual(def.id, id, `${id}: id must match its key`);
  assert(def.story, `${id}: story cases need story: true`);
  assert(def.who && def.ask, `${id}: needs who and ask`);
  if (def.look) assert(modelExists(def.look.model), `${id}: missing model ${def.look.model}.glb`);
  for (const v of def.variants || []) useConditions(v);
  if (def.type === 'choice') {
    assert(def.prompt && def.options.length, `${id}: choice needs a prompt and options`);
    for (const o of def.options) {
      assert(o.label && o.reply, `${id}: option needs label and reply`);
      list(o.set).forEach((f) => setFlags.add(f));
      useConditions(o);
    }
    continue;
  }
  assert(['legal', 'illegal', 'grey'].includes(def.request || 'legal'), `${id}: unknown request type`);
  assert(def.segs.length >= 3, `${id}: needs at least 3 sentences`);
  if ((def.request || 'legal') !== 'illegal') {
    assert(def.plant, `${id}: lawful story drafts script their errors (plant)`);
    assert(def.win, `${id}: needs a win line`);
  }
  for (const [at, variant] of Object.entries(def.plant || {})) {
    const bad = def.segs[at] && def.segs[at].bad[variant];
    assert(bad, `${id}: plant ${at}:${variant} points at no variant`);
    assert(bad.boom, `${id}: planted variant needs a boom`);
    if (bad.kind === 'fact') {
      assert(bad.facts && bad.facts.length, `${id}: fact error needs a proof`);
      for (const f of bad.facts) assert(factIds.has(f), `${id}: unknown fact ${f}`);
    } else {
      assert(bad.why, `${id}: sense/logic error needs a why`);
    }
  }
  for (const [outcome, effect] of Object.entries(def.outcomes || {})) {
    assert(['clean', 'missed', 'accused', 'refused', 'refusedWrongly', 'abetted', 'good', 'bad'].includes(outcome), `${id}: unknown outcome ${outcome}`);
    list(effect.set).forEach((f) => setFlags.add(f));
  }
  if (def.request === 'illegal') {
    assert(def.outcomes.refused && def.outcomes.abetted, `${id}: illegal requests need refused and abetted outcomes`);
    assert(def.outcomes.abetted.headline, `${id}: abetting needs a news headline`);
  }
}
story.nights.forEach((night, n) => {
  assert(night.title && night.memo.length, `night ${n}: needs a title and memo`);
  for (const slot of night.visitors) {
    useConditions(slot);
    if (slot.arc) assert(story.sideArcs.includes(slot.arc), `night ${n}: unknown arc ${slot.arc}`);
    if (slot.story) {
      const def = story.cases[slot.story];
      assert(def, `night ${n}: unknown story case ${slot.story}`);
      // A fact cited in a story case must already be in the book that night.
      for (const [at, v] of Object.entries(def.plant || {})) {
        for (const f of def.segs[at].bad[v].facts || []) assert(entryNight.get(f) <= n, `${slot.story}: fact ${f} not in the book by night ${n}`);
      }
    }
  }
});
story.papers.forEach((p) => { useConditions(p); assert(p.night > 0 && p.night < story.nights.length, 'paper night out of range'); });
story.endings.forEach(useConditions);
assert(!story.endings[story.endings.length - 1].if, 'last ending must be the unconditional default');
for (const flag of usedFlags) assert(setFlags.has(flag), `flag "${flag}" is checked but never set`);
for (const c of data.cases) assert(!c.look.model || modelExists(c.look.model), `${c.id}: missing model ${c.look.model}.glb`);

// ---- Rules: refuse / sign by request type ---------------------------------------
{
  const shift = L.newNight(story, data, L.newCampaign());
  const illegal = shift.cases.find((c) => c.def.request === 'illegal');
  shift.index = shift.cases.indexOf(illegal);
  assert.strictEqual(L.submit(shift, data, Math.random, 'refuse').outcome, 'refused');
  shift.index = shift.cases.indexOf(illegal);
  const abetted = L.submit(shift, data, Math.random, 'sign');
  assert.strictEqual(abetted.outcome, 'abetted');
  assert(!abetted.citation, 'abetting is found out later, not cited on the spot');
  const lawful = shift.cases.find((c) => !c.def.request && c.def.type !== 'choice');
  shift.index = shift.cases.indexOf(lawful);
  const wrongRefusal = L.submit(shift, data, Math.random, 'refuse');
  assert.strictEqual(wrongRefusal.outcome, 'refusedWrongly');
  assert(wrongRefusal.citation, 'refusing a lawful request is cited');
  // Scripted drafts are deterministic.
  const thu = shift.cases.find((c) => c.def.id === 'thu-1');
  assert.deepStrictEqual(thu.segs.map((s) => Boolean(s.variant)), [true, false, false, false, true]);
}

// ---- Playthroughs ----------------------------------------------------------------
// policy(def) -> 'refuse' | 'perfect' | 'sign-as-is' | option index (choices).
function play(policy) {
  const state = L.newCampaign();
  while (!L.isOver(story, state)) {
    const shift = L.newNight(story, data, state);
    do {
      const live = L.current(shift);
      const move = policy(live.def, state);
      let result;
      if (live.def.type === 'choice') {
        const allowed = live.def.options.map((o, i) => [o, i]).filter(([o]) => L.passes(o, state));
        const wanted = allowed.find(([, i]) => i === move) || allowed[0];
        result = L.choose(shift, wanted[1]);
      } else {
        if (move === 'perfect') for (const seg of live.segs) if (seg.variant) L.toggleFlag(seg);
        result = L.submit(shift, data, Math.random, move === 'refuse' ? 'refuse' : 'sign');
      }
      if (live.def.story) L.applyOutcome(state, result);
    } while (L.next(shift));
    L.closeNight(state, shift, []);
  }
  return { state, ending: L.pickEnding(story, state) };
}

// The careful reviewer: refuses unlawful and grey requests, fixes every draft,
// reports the bribe, keeps the card and goes to the press.
const careful = play((def) => {
  if (def.type === 'choice') return { 'khai-2': 2, 'vy-1': 0, final: 0 }[def.id] ?? 0;
  return def.request === 'illegal' || def.request === 'grey' ? 'refuse' : 'perfect';
});
assert.strictEqual(careful.ending.id, 'nguoi-giu-so');
for (const f of ['khai.refused', 'hung.card', 'khai.reported', 'phuc.warned', 'mira.noticed', 'hanh.refused', 'thu.supported', 'thu.drawing', 'vy.card'])
  assert(L.hasFlag(careful.state, f), `careful run should set ${f}`);

// The rubber stamp: signs everything unread, takes the envelope.
const stamp = play((def) => (def.type === 'choice' ? { 'khai-2': 1 }[def.id] ?? 0 : 'sign-as-is'));
assert.strictEqual(stamp.ending.id, 'tong-pham');
assert(L.hasFlag(stamp.state, 'arrested'));

// Careful, but hands the card to Đoàn: ally (clean record) — and silence.
const toDoan = play((def) => {
  if (def.type === 'choice') return { 'khai-2': 0, 'vy-1': 0, 'doan-2': 1, final: 1 }[def.id] ?? 0;
  return def.request === 'illegal' ? 'refuse' : 'perfect';
});
assert.strictEqual(toDoan.ending.id, 'dong-minh');
// Signs everything unread (many citations) but earned Đoàn's trust over the radio.
const trusted = play((def) => {
  if (def.type === 'choice') return { 'khai-2': 0, 'vy-1': 0, 'doan-2': 0, final: 1 }[def.id] ?? 0;
  return def.request === 'illegal' ? 'refuse' : 'sign-as-is';
});
assert.strictEqual(trusted.ending.id, 'dong-minh-tin');
const silent = play((def) => {
  if (def.type === 'choice') return { 'khai-2': 0, 'vy-1': 0, final: 2 }[def.id] ?? 0;
  return def.request === 'illegal' ? 'refuse' : 'perfect';
});
assert.strictEqual(silent.ending.id, 'giam-sat');
const declined = play((def) => {
  if (def.type === 'choice') return { 'khai-2': 0, 'vy-1': 1 }[def.id] ?? 0;
  return def.request === 'illegal' ? 'refuse' : 'perfect';
});
assert.strictEqual(declined.ending.id, 'khong-biet');

// Random side arcs: 2 per run, skipped slots refilled, nights keep their size.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seenArcs = new Set();
  for (let run = 0; run < 30; run++) {
    const state = L.newCampaign(story, rnd);
    assert.strictEqual(state.arcs.length, story.sideArcsPerRun);
    state.arcs.forEach((a) => seenArcs.add(a));
    const all = L.newCampaign();
    for (let n = 0; n < story.nights.length; n++) {
      state.night = all.night = n;
      const defs = L.planNight(story, data, state, rnd);
      const full = L.planNight(story, data, all, rnd).length;
      assert(defs.length >= Math.min(L.MIN_VISITORS, full) && defs.length <= full, `night ${n}: ${defs.length} visitors`);
      const slotArc = new Map(story.nights[n].visitors.filter((s) => s.story).map((s) => [s.story, s.arc]));
      for (const d of defs) if (d.story && slotArc.get(d.id)) assert(state.arcs.includes(slotArc.get(d.id)), `${d.id} played outside its arc`);
    }
  }
  assert.strictEqual(seenArcs.size, story.sideArcs.length, 'every side arc can be picked');
}

// Book pages unlock night by night.
assert(!L.entriesFor(data, 0).some((e) => e.id === 'luadao'));
assert(L.entriesFor(data, 1).some((e) => e.id === 'luadao'));

console.log(`STORY OK — ${story.nights.length} nights, ${Object.keys(story.cases).length} story cases, ` +
  `${setFlags.size} flags, ${story.papers.length} paper lines, ${story.endings.length} endings; endings reached: ` +
  [careful, stamp, toDoan, trusted, silent, declined].map((r) => r.ending.id).join(', '));
