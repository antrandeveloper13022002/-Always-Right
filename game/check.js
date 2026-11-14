'use strict';
// Self-check: `node game/check.js`. Validates content and the pure rules.
const assert = require('assert');
const data = require('./data.js');
const L = require('./logic.js');

const KINDS = ['sense', 'logic', 'fact'];

// ---- Content integrity -------------------------------------------------
const factIds = new Set();
for (const entry of data.entries) {
  for (const fact of entry.facts) {
    assert(fact.id.startsWith(entry.id + '.'), `fact ${fact.id} must start with ${entry.id}.`);
    assert(!factIds.has(fact.id), `duplicate fact ${fact.id}`);
    factIds.add(fact.id);
  }
}

assert(data.cases.length >= L.SHIFT_SIZE, 'not enough cases for a shift');
assert.strictEqual(data.ranks.length, L.SHIFT_SIZE + 1, 'one rank per possible clean count');
assert(data.accused.length, 'needs lines for a wrongly flagged sentence');
assert(data.citations.length >= L.SHIFT_SIZE, 'needs a citation line for every request in a shift');
for (const kind of ['happy', 'missed', 'accused', 'comeback']) assert(data.replies[kind].length, `needs customer replies for ${kind}`);
const variantsOfKind = { sense: 0, logic: 0, fact: 0 };
for (const c of data.cases) {
  assert(c.segs.length >= 2, `${c.id}: needs at least 2 sentences`);
  assert(c.who && c.meta && c.ask && c.win, `${c.id}: needs who, meta, ask and win`);
  assert(c.look && c.look.skin && c.look.top && c.look.hair, `${c.id}: needs a look`);
  const kindsHere = new Set();
  c.segs.forEach((seg, i) => {
    assert(seg.bad.length, `${c.id}[${i}]: needs a wrong variant`);
    for (const bad of seg.bad) {
      const where = `${c.id}[${i}] "${bad.text.slice(0, 24)}…"`;
      assert(KINDS.includes(bad.kind), `${where}: unknown kind ${bad.kind}`);
      assert.notStrictEqual(bad.text, seg.ok, `${where}: equals the right text`);
      assert(bad.boom, `${where}: missing boom`);
      if (bad.kind === 'fact') {
        // The encyclopedia must be able to disprove every knowledge error.
        assert(bad.facts && bad.facts.length, `${where}: fact error needs a proving fact`);
      } else {
        // Sense and logic errors must be explainable without the encyclopedia.
        assert(bad.why, `${where}: needs a why`);
      }
      for (const id of bad.facts || []) assert(factIds.has(id), `${where}: unknown fact ${id}`);
      variantsOfKind[bad.kind] += 1;
      kindsHere.add(bad.kind);
    }
  });
  // Every request can be failed without opening the encyclopedia at all.
  assert(kindsHere.has('sense') || kindsHere.has('logic'), `${c.id}: needs a sense or logic error`);
}

// ---- Rules -------------------------------------------------------------
const seen = { 0: 0, 1: 0, 2: 0 };
const plantedOfKind = { sense: 0, logic: 0, fact: 0 };
const firstCases = new Set();

for (let run = 0; run < 2000; run++) {
  const shift = L.newShift(data);
  assert.strictEqual(shift.cases.length, L.SHIFT_SIZE);
  assert.strictEqual(new Set(shift.cases.map((c) => c.def.id)).size, L.SHIFT_SIZE, 'no repeats in a shift');
  firstCases.add(shift.cases[0].def.id);

  for (const live of shift.cases) {
    const wrong = live.segs.filter((s) => s.variant);
    assert(wrong.length <= 2);
    seen[wrong.length] += 1;
    for (const seg of wrong) plantedOfKind[seg.variant.kind] += 1;
    assert.strictEqual(L.judge(live).isClean, wrong.length === 0, 'untouched request is clean only without errors');

    // Flagging every wrong sentence, and nothing else, makes the request clean.
    for (const seg of wrong) L.toggleFlag(seg);
    const flagged = L.judge(live);
    assert(flagged.isClean);
    assert.strictEqual(flagged.points, L.CLEAN_POINTS, 'flags alone earn no bonus');

    // The right card on a knowledge error earns the bonus.
    const provable = wrong.filter((s) => s.variant.facts);
    for (const seg of provable) L.attach(seg, seg.variant.facts[0]);
    assert.strictEqual(L.judge(live).points, L.CLEAN_POINTS + provable.length * L.PROOF_BONUS);
  }
}
assert.strictEqual(firstCases.size, data.cases.length, 'every case can open a shift');
const total = seen[0] + seen[1] + seen[2];
assert(seen[0] / total > 0.1 && seen[1] / total > 0.3 && seen[2] / total > 0.2, 'error counts follow the odds');
const planted = plantedOfKind.sense + plantedOfKind.logic + plantedOfKind.fact;
// At least half of all errors must be catchable without the encyclopedia.
assert((plantedOfKind.sense + plantedOfKind.logic) / planted > 0.5, 'too many errors need the encyclopedia');
for (const kind of KINDS) assert(plantedOfKind[kind] / planted > 0.15, `${kind} errors are too rare`);

// Avoided cases are only used when nothing fresh is left.
{
  const avoid = data.cases.slice(0, data.cases.length - L.SHIFT_SIZE).map((c) => c.id);
  const shift = L.newShift(data, Math.random, avoid);
  assert(shift.cases.every((c) => !avoid.includes(c.def.id)), 'previous shift is avoided');
}

// One shift, rule by rule. Requests are built by hand so the outcome is known.
{
  const shift = L.newShift(data);
  const plant = (live, wanted) => {
    const kind = wanted.find((k) => live.def.segs.some((s) => s.bad.some((b) => b.kind === k)));
    for (const seg of live.segs) { seg.variant = null; seg.isFlagged = false; seg.card = null; }
    const at = live.segs.findIndex((s) => s.def.bad.some((b) => b.kind === kind));
    live.segs[at].variant = live.segs[at].def.bad.find((b) => b.kind === kind);
    return live.segs[at];
  };
  const factCase = (shift.cases.find((c) => c.def.segs.some((s) => s.bad.some((b) => b.kind === 'fact'))));
  shift.cases = [factCase, ...shift.cases.filter((c) => c !== factCase)];

  // Lookups are scarce: only new pages cost, and they run out.
  const ids = data.entries.map((e) => e.id);
  assert.strictEqual(L.openEntry(shift, ids[0]), 'paid');
  assert.strictEqual(L.openEntry(shift, ids[0]), 'free');
  assert.strictEqual(shift.lookups, L.LOOKUPS - 1);
  for (let i = 1; i < L.LOOKUPS; i++) assert.strictEqual(L.openEntry(shift, ids[i]), 'paid');
  assert.strictEqual(L.openEntry(shift, ids[L.LOOKUPS]), 'empty', 'the whole encyclopedia cannot be opened');
  assert.strictEqual(L.openEntry(shift, ids[0]), 'free');
  assert(L.LOOKUPS < data.entries.length / 2);

  // Tray: no duplicates, capped, emptied on the next request.
  const facts = [...factIds];
  assert.strictEqual(L.pin(shift, facts[0]), 'pinned');
  assert.strictEqual(L.pin(shift, facts[0]), 'dup');
  for (let i = 1; i < L.TRAY_MAX; i++) assert.strictEqual(L.pin(shift, facts[i]), 'pinned');
  assert.strictEqual(L.pin(shift, facts[L.TRAY_MAX]), 'full');
  L.unpin(shift, facts[0]);
  assert.strictEqual(shift.tray.length, L.TRAY_MAX - 1);

  // Request 1 — a knowledge error.
  const wrong = plant(L.current(shift), ['fact']);
  const right = L.current(shift).segs.find((s) => !s.variant);
  assert.strictEqual(L.segStatus(wrong), 'missed');
  assert.strictEqual(L.segStatus(right), 'ok');

  // Flagging a correct sentence is an accusation; un-flagging takes it back.
  L.toggleFlag(right);
  assert.strictEqual(L.segStatus(right), 'accused');
  assert.strictEqual(L.judge(L.current(shift)).isClean, false);
  L.toggleFlag(right);
  assert.strictEqual(L.segStatus(right), 'ok');

  // A card on a correct sentence is still an accusation, and removing the flag drops the card.
  L.attach(right, wrong.variant.facts[0]);
  assert.strictEqual(L.segStatus(right), 'accused');
  L.toggleFlag(right);
  assert.strictEqual(right.card, null);

  // The wrong card still counts as a flag, just without the bonus.
  const unrelated = facts.find((id) => !wrong.variant.facts.includes(id));
  L.attach(wrong, unrelated);
  assert.strictEqual(L.segStatus(wrong), 'fixed');
  L.attach(wrong, wrong.variant.facts[0]);
  assert.strictEqual(L.segStatus(wrong), 'proved');
  L.detach(wrong);
  assert.strictEqual(L.segStatus(wrong), 'fixed');

  // Submitting with the error flagged: points, no citation.
  assert.strictEqual(L.submit(shift, data).isClean, true);
  assert.strictEqual(shift.score, L.CLEAN_POINTS);
  assert.strictEqual(shift.citations.length, 0);
  assert(L.next(shift));
  assert.strictEqual(shift.tray.length, 0);

  // Request 2 — an error let through: no points, one citation.
  plant(L.current(shift), ['sense', 'logic']);
  const failed = L.submit(shift, data);
  assert.strictEqual(failed.isClean, false);
  assert.strictEqual(failed.points, 0);
  assert.strictEqual(shift.citations.length, 1);
  assert(L.next(shift));

  // Request 3 — error caught but a correct sentence accused too: still a failure.
  const caught = plant(L.current(shift), ['logic', 'sense']);
  L.toggleFlag(caught);
  L.toggleFlag(L.current(shift).segs.find((s) => !s.variant));
  assert.strictEqual(L.submit(shift, data).isClean, false);
  assert.strictEqual(shift.citations.length, 2);
  assert.notStrictEqual(shift.citations[0], shift.citations[1], 'citation lines do not repeat while unused ones remain');
  assert(L.next(shift));

  assert.strictEqual(L.cleanCount(shift), 1);
  assert.strictEqual(L.next(shift), false, 'shift ends after the last request');

  // Unused lookups become points.
  assert.strictEqual(L.finalScore(shift), shift.score);
  shift.lookups = 3;
  assert.strictEqual(L.finalScore(shift), shift.score + 3 * L.LEFTOVER_BONUS);
}

const share = (kind) => `${kind}=${Math.round(100 * plantedOfKind[kind] / planted)}%`;
console.log(`OK — ${data.entries.length} entries, ${factIds.size} facts, ${data.cases.length} cases, ` +
  `variants sense=${variantsOfKind.sense} logic=${variantsOfKind.logic} fact=${variantsOfKind.fact}.\n` +
  `Over ${total} requests: errors 0=${seen[0]} 1=${seen[1]} 2=${seen[2]}; planted ${KINDS.map(share).join(' ')}`);
require('./check-story.js');
