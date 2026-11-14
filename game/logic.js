'use strict';
// Pure game rules (docs/business/business-rule.md). No DOM in this file.

const GameLogic = (() => {
  // Provisional tuning — expected to change after play-testing.
  const SHIFT_SIZE = 4;       // requests in a free (non-campaign) shift
  const MIN_VISITORS = 5;     // a campaign night refills skipped arc slots up to this
  const LOOKUPS = 5;          // new encyclopedia pages per shift
  const CLEAN_POINTS = 100;
  const REFUSE_POINTS = 150;  // refusing an unlawful request
  const GREY_REFUSE_POINTS = 50;
  const PROOF_BONUS = 25;     // per error flagged with the right evidence card
  const LEFTOVER_BONUS = 20;  // per unused lookup at the end of the shift
  const TRAY_MAX = 5;
  const ERROR_ODDS = [0.2, 0.45, 0.35]; // chance of 0, 1, 2 errors in a request

  const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

  function shuffle(list, rnd) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function rollErrorCount(rnd) {
    let roll = rnd();
    for (let count = 0; count < ERROR_ODDS.length; count++) {
      roll -= ERROR_ODDS[count];
      if (roll < 0) return count;
    }
    return ERROR_ODDS.length - 1;
  }

  // BR-RND-03/04: plant 0–2 errors. Each error first picks its kind (sense /
  // logic / fact) evenly, so no kind dominates just because it has more variants.
  // Story cases script their draft instead: plant = { sentenceIndex: variantIndex }.
  function makeLive(def, rnd) {
    if (def.type === 'choice') return { def, segs: [] };
    const planted = new Map(); // sentence index -> wrong variant
    if (def.plant) {
      for (const [at, variant] of Object.entries(def.plant)) planted.set(Number(at), def.segs[at].bad[variant]);
    } else {
      const count = rollErrorCount(rnd);
      for (let n = 0; n < count; n++) {
        const options = [];
        def.segs.forEach((seg, at) => {
          if (!planted.has(at)) for (const variant of seg.bad) options.push({ at, variant });
        });
        if (!options.length) break;
        const kind = pick([...new Set(options.map((o) => o.variant.kind))], rnd);
        const chosen = pick(options.filter((o) => o.variant.kind === kind), rnd);
        planted.set(chosen.at, chosen.variant);
      }
    }
    const segs = def.segs.map((segDef, at) => (
      { def: segDef, variant: planted.get(at) || null, isFlagged: false, card: null }));
    return { def, segs };
  }

  function buildShift(defs, rnd) {
    return {
      lookups: LOOKUPS, score: 0, index: 0,
      citations: [], opened: new Set(), tray: [], results: [],
      cases: defs.map((def) => makeLive(def, rnd)),
    };
  }

  // BR-RND-02: no repeats in a shift; cases from the previous shift come last.
  function newShift(data, rnd = Math.random, avoidIds = []) {
    const fresh = data.cases.filter((c) => !avoidIds.includes(c.id));
    const stale = data.cases.filter((c) => avoidIds.includes(c.id));
    return buildShift([...shuffle(fresh, rnd), ...shuffle(stale, rnd)].slice(0, SHIFT_SIZE), rnd);
  }

  const current = (shift) => shift.cases[shift.index];
  const segText = (seg) => (seg.variant ? seg.variant.text : seg.def.ok);

  // BR-LOOK-02. Returns 'free' | 'paid' | 'empty'.
  function openEntry(shift, entryId) {
    if (shift.opened.has(entryId)) return 'free';
    if (shift.lookups <= 0) return 'empty';
    shift.opened.add(entryId);
    shift.lookups -= 1;
    return 'paid';
  }

  // BR-FIX-06. Returns 'pinned' | 'dup' | 'full'.
  function pin(shift, factId) {
    if (shift.tray.includes(factId)) return 'dup';
    if (shift.tray.length >= TRAY_MAX) return 'full';
    shift.tray.push(factId);
    return 'pinned';
  }

  const unpin = (shift, factId) => { shift.tray = shift.tray.filter((id) => id !== factId); };

  // BR-FIX-02: a flag says "this sentence is wrong". Nothing is judged until submit.
  function toggleFlag(seg) {
    seg.isFlagged = !seg.isFlagged;
    if (!seg.isFlagged) seg.card = null;
  }

  // BR-FIX-03: attaching evidence flags the sentence too.
  function attach(seg, factId) {
    seg.isFlagged = true;
    seg.card = factId;
  }

  const detach = (seg) => { seg.card = null; };

  // ok: right, left alone | fixed: wrong, flagged | proved: wrong, flagged with
  // the right card | missed: wrong, not flagged | accused: right, but flagged.
  function segStatus(seg) {
    if (!seg.variant) return seg.isFlagged ? 'accused' : 'ok';
    if (!seg.isFlagged) return 'missed';
    return (seg.variant.facts || []).includes(seg.card) ? 'proved' : 'fixed';
  }

  function judge(live) {
    const statuses = live.segs.map(segStatus);
    const isClean = !statuses.some((s) => s === 'missed' || s === 'accused');
    const proofs = statuses.filter((s) => s === 'proved').length;
    return { statuses, isClean, points: isClean ? CLEAN_POINTS + proofs * PROOF_BONUS : 0 };
  }

  // BR-JDG-02/04, BR-REF-*. decision: 'sign' | 'refuse'. The request type
  // (def.request) is 'legal' (default), 'illegal' or 'grey'.
  // outcome: clean | missed | accused | refused | refusedWrongly | abetted.
  function decide(live, decision) {
    const request = live.def.request || 'legal';
    const neutral = live.segs.map(() => 'ok');
    if (decision === 'refuse') {
      if (request === 'legal') return { statuses: neutral, isClean: false, points: 0, outcome: 'refusedWrongly' };
      return { statuses: neutral, isClean: true, points: request === 'illegal' ? REFUSE_POINTS : GREY_REFUSE_POINTS, outcome: 'refused' };
    }
    if (request === 'illegal') return { statuses: neutral, isClean: false, points: 0, outcome: 'abetted' };
    const result = judge(live);
    result.outcome = result.isClean ? 'clean' : result.statuses.includes('missed') ? 'missed' : 'accused';
    return result;
  }

  // Outcomes that earn an immediate citation. Abetting is found out later.
  const CITED = ['missed', 'accused', 'refusedWrongly'];

  // Scores the current request; a citation (biên bản) gets a supervisor line
  // not used yet this shift, while any are left.
  function submit(shift, data, rnd = Math.random, decision = 'sign') {
    const live = current(shift);
    const result = decide(live, decision);
    result.live = live;
    result.decision = decision;
    shift.score += result.points;
    if (CITED.includes(result.outcome)) {
      const unused = data.citations.filter((line) => !shift.citations.includes(line));
      result.citation = pick(unused.length ? unused : data.citations, rnd);
      shift.citations.push(result.citation);
    }
    shift.results.push(result);
    return result;
  }

  // A story choice (no form): records the option, scores nothing.
  function choose(shift, optionIndex) {
    const live = current(shift);
    const result = { live, outcome: 'choice', option: live.def.options[optionIndex], isClean: true, points: 0, statuses: [] };
    shift.results.push(result);
    return result;
  }

  // Moves to the next request. False when the shift is over.
  function next(shift) {
    shift.index += 1;
    shift.tray = [];
    return shift.index < shift.cases.length;
  }

  const judged = (shift) => shift.results.filter((r) => r.outcome !== 'choice');
  const cleanCount = (shift) => judged(shift).filter((r) => r.isClean).length;
  const judgedCount = (shift) => shift.cases.filter((c) => c.def.type !== 'choice').length;
  const leftoverBonus = (shift) => shift.lookups * LEFTOVER_BONUS;
  const finalScore = (shift) => shift.score + leftoverBonus(shift);

  // ---- Campaign (BR-CAM-*) -------------------------------------------------
  // With a story, picks this run's side arcs (BR-CAM-06). Without one (old
  // saves, tests) arcs stays undefined and every arc plays.
  function newCampaign(story, rnd = Math.random) {
    const state = { night: 0, flags: [], score: 0, citations: 0, seen: [], headlines: [] };
    if (story) state.arcs = shuffle(story.sideArcs, rnd).slice(0, story.sideArcsPerRun);
    return state;
  }

  const playsArc = (state, arc) => !arc || !state.arcs || state.arcs.includes(arc);

  const hasFlag = (state, flag) => state.flags.includes(flag);
  const list = (value) => [].concat(value || []);

  // `if` flags must all be set, `unless` flags all unset, and at least one
  // of `ifAny` set (when given).
  const passes = (item, state) => list(item.if).every((f) => hasFlag(state, f))
    && !list(item.unless).some((f) => hasFlag(state, f))
    && (!item.ifAny || list(item.ifAny).some((f) => hasFlag(state, f)));

  function setFlags(state, flags) {
    for (const flag of list(flags)) if (!hasFlag(state, flag)) state.flags.push(flag);
  }

  // Story visitors in order, random cases filling the { random: n } slots
  // (cases already met in earlier nights come last).
  function planNight(story, data, state, rnd = Math.random) {
    const night = story.nights[state.night];
    const fresh = shuffle(data.cases.filter((c) => !state.seen.includes(c.id)), rnd);
    const pool = fresh.concat(shuffle(data.cases.filter((c) => state.seen.includes(c.id)), rnd));
    const defs = [];
    const playing = night.visitors.filter((s) => passes(s, state) && playsArc(state, s.arc));
    let refill = MIN_VISITORS - playing.reduce((n, s) => n + (s.random || 1), 0);
    for (const slot of night.visitors) {
      if (!passes(slot, state)) continue;
      if (!playsArc(state, slot.arc)) {
        if (refill > 0 && pool.length) { defs.push(pool.shift()); refill -= 1; }
      } else if (slot.random) {
        for (let i = 0; i < slot.random && pool.length; i++) defs.push(pool.shift());
      } else {
        const def = story.cases[slot.story];
        // A case may change with the flags: the first matching variant patches it.
        const variant = (def.variants || []).find((v) => passes(v, state));
        defs.push(variant ? { ...def, ...variant.patch } : def);
      }
    }
    return defs;
  }

  function newNight(story, data, state, rnd = Math.random) {
    const shift = buildShift(planNight(story, data, state, rnd), rnd);
    shift.night = state.night;
    return shift;
  }

  // What a story case's result means for the campaign (flags to set).
  function applyOutcome(state, result) {
    if (result.outcome === 'choice') {
      setFlags(state, result.option.set);
      return result.option;
    }
    const outcomes = result.live.def.outcomes || {};
    const effect = outcomes[result.outcome] || (result.isClean ? outcomes.good : outcomes.bad) || null;
    if (effect) setFlags(state, effect.set);
    return effect;
  }

  // Closes a night: totals carry over, met random cases are remembered.
  function closeNight(state, shift, headlines) {
    state.score += finalScore(shift);
    state.citations += shift.citations.length;
    for (const live of shift.cases) if (!live.def.story && !state.seen.includes(live.def.id)) state.seen.push(live.def.id);
    state.headlines = headlines;
    state.night += 1;
  }

  const isOver = (story, state) => state.night >= story.nights.length;
  const morningPaper = (story, state) => story.papers.filter((p) => p.night === state.night && passes(p, state));
  const pickEnding = (story, state) => story.endings.find((e) => passes(e, state) && (e.maxCitations === undefined || state.citations <= e.maxCitations));
  // Encyclopedia entries unlock night by night (entry.night, default 0).
  const entriesFor = (data, night) => data.entries.filter((e) => (e.night || 0) <= night);

  return {
    SHIFT_SIZE, MIN_VISITORS, LOOKUPS, CLEAN_POINTS, REFUSE_POINTS, GREY_REFUSE_POINTS, PROOF_BONUS, LEFTOVER_BONUS, TRAY_MAX,
    newShift, current, segText, openEntry, pin, unpin, toggleFlag, attach, detach,
    segStatus, judge, submit, choose, next, cleanCount, judgedCount, leftoverBonus, finalScore,
    newCampaign, playsArc, hasFlag, passes, setFlags, planNight, newNight, applyOutcome, closeNight, isOver,
    morningPaper, pickEnding, entriesFor,
  };
})();

if (typeof module !== 'undefined') module.exports = GameLogic;
