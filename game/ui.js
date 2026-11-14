'use strict';
// The only file that touches the page DOM. Rules live in logic.js; story
// content in story.js; the 3D booth (scene3d.js) only plays what it is told.

(() => {
  const L = GameLogic;
  const D = GAME_DATA;
  const S = STORY;
  const $ = (id) => document.getElementById(id);
  const isNarrow = window.matchMedia('(max-width: 900px)');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const SAVE_KEY = 'kdv-campaign';
  // Voice pitch (Hz) per character model: by age and gender. Radio = trưởng ca Đoàn.
  const VOICES = {
    'ba-nam': 205, 'bao-ngoc': 235, chau: 132, 'gia-huy': 138, hanh: 225, 'hoang-long': 128, hung: 104,
    khai: 96, 'ngoc-lan': 245, 'quoc-bao': 122, tai: 108, 'thanh-son': 112, 'thanh-tra': 100,
    'thi-mai': 210, 'thu-ha': 232, thu: 262, 'van-phuc': 102, vy: 228, bin: 150, quang: 98,
    son: 110, lien: 215, tuan: 125,
  };
  const RADIO_PITCH = 112;

  // The current customer says text aloud (babble) and their mouth moves along.
  function voiceLine(text, isAngry, delay = 0) {
    const def = L.current(shift).def;
    const look = def.look;
    const seconds = GameAudio.voice(text, {
      pitch: look ? VOICES[look.model] || 150 : RADIO_PITCH, angry: isAngry, radio: !look, delay,
    });
    Scene3D.talk(seconds || Math.min(6, 1.2 + text.length * 0.045));
  }

  // Where every fact lives in the book: page number and section (§) number.
  const factText = new Map();
  const factCite = new Map();
  const pageOf = new Map();
  D.entries.forEach((entry, i) => {
    pageOf.set(entry.id, 9 + i * 6);
    entry.facts.forEach((fact, k) => {
      factText.set(fact.id, fact.text);
      factCite.set(fact.id, `${entry.title}, tr. ${pageOf.get(entry.id)}, §${k + 1}`);
    });
  });

  let campaign = loadCampaign();
  let nextShift = null;   // planned on the memo so its models load first
  let memoToken = 0;
  const allModels = [...D.cases, ...Object.values(S.cases)].map((c) => c.look && c.look.model).filter(Boolean);
  let shift = null;
  let serial = 0;
  let armedFact = null;   // note picked up by click, waiting for a sentence
  let openEntryId = null;
  let review = null;      // the submitted result while the form shows the review
  let intercomTimer = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function show(screenId) {
    for (const id of ['screen-start', 'screen-game', 'screen-end']) $(id).hidden = id !== screenId;
    document.querySelector('.app').classList.toggle('is-start', screenId !== 'screen-game');
    $('hud').hidden = screenId !== 'screen-game';
    $('speech').hidden = screenId !== 'screen-game';
    if (screenId !== 'screen-game') hideIntercom();
  }

  function replay(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(className);
  }

  function say(text) {
    $('toast').textContent = text;
    replay($('toast'), 'is-on');
  }

  function intercom(number, line) {
    clearTimeout(intercomTimer);
    const box = $('intercom');
    box.replaceChildren(el('b', '', `Bộ đàm · Trưởng ca Đoàn · biên bản số ${number}`), document.createElement('br'), line);
    box.hidden = false;
    replay(box, 'is-new');
    intercomTimer = setTimeout(hideIntercom, 9000);
  }

  function hideIntercom() {
    clearTimeout(intercomTimer);
    $('intercom').hidden = true;
  }

  // Lowercase, no diacritics — so "hoc phi" finds "Học phí".
  const plain = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

  function shiftTime(index) {
    const minutes = 22 * 60 + index * 41;
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }

  // ---- Campaign save (per browser; a convenience, not critical state) ------
  function loadCampaign() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && Array.isArray(saved.flags)) return { ...L.newCampaign(S), ...saved };
    } catch (error) { /* no or broken save: start fresh */ }
    return L.newCampaign(S);
  }

  function saveCampaign() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(campaign)); } catch (error) { /* storage blocked */ }
  }

  // ---- Speech bubble follows the customer's head -------------------------
  function placeSpeech(anchor) {
    const bubble = $('speech');
    // In the close-up (or on the radio) the line becomes a subtitle, so it never covers the face.
    const isCloseUp = Scene3D.focusLevel() > 0.35;
    bubble.classList.toggle('is-subtitle', isCloseUp || bubble.dataset.radio === '1');
    $('stage').classList.toggle('is-raging', isCloseUp);
    if (!anchor || bubble.hidden || isNarrow.matches || isCloseUp) return;
    const view = $('stage-view');
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const isFlipped = anchor.x + 64 + width > view.clientWidth - 12;
    const x = isFlipped ? anchor.x - 64 - width : anchor.x + 64;
    const y = Math.min(Math.max(anchor.y - 36, 10), view.clientHeight - height - 10);
    bubble.style.setProperty('--x', `${Math.round(x)}px`);
    bubble.style.setProperty('--y', `${Math.round(y)}px`);
    bubble.classList.toggle('is-flipped', isFlipped);
  }

  // ---- HUD ---------------------------------------------------------------
  function renderHud(isLookupSpent) {
    const total = shift.cases.length;
    $('hud-clock').textContent = shiftTime(Math.min(shift.index, total - 1));
    $('progress').textContent = `${pad(Math.min(shift.index + 1, total))}/${pad(total)}`;
    $('lookups').textContent = `${shift.lookups}/${L.LOOKUPS}`;
    $('lookup-pips').replaceChildren(...Array.from({ length: L.LOOKUPS }, (_, i) => el('span', i < shift.lookups ? 'pip' : 'pip is-used')));
    $('hud-lookups').classList.toggle('is-empty', shift.lookups === 0);
    if (isLookupSpent) replay($('hud-lookups'), 'is-bump');
    $('score').textContent = String(campaign.score + shift.score).padStart(4, '0');
    const cited = campaign.citations + shift.citations.length;
    if (Number($('citations').textContent) < cited) replay($('citations').parentElement, 'is-hit');
    $('citations').textContent = cited;
    $('citations').classList.toggle('is-warn', cited > 0);
    $('ribbons').replaceChildren(...Array.from({ length: L.LOOKUPS }, (_, i) => el('span', i < shift.lookups ? 'ribbon' : 'ribbon is-used')));
  }

  // ---- The reply form ----------------------------------------------------
  const isChoice = () => L.current(shift).def.type === 'choice';

  function renderForm(isNew) {
    const def = L.current(shift).def;
    $('form-no').textContent = `07-${pad(serial + shift.index, 4)}`;
    $('form-time').textContent = shiftTime(shift.index);
    $('form-who').textContent = `${def.who} · ${def.meta}`;
    $('form-ask').textContent = `“${def.ask}”`;
    $('tray-box').hidden = Boolean(review) || isChoice();
    $('answer-head').hidden = isChoice();
    $('sign').textContent = review && !isChoice() ? 'KDV · Quầy 07' : '';
    if (isChoice()) renderChoice();
    else renderLines(isNew);
    renderStamp();
    renderNote();
    renderTray();
    const isLast = shift.index === shift.cases.length - 1;
    $('btn-send').textContent = review ? (isLast ? 'Kết thúc ca' : 'Gọi khách tiếp theo') : 'Ký duyệt và trao phiếu';
    $('btn-send').hidden = isChoice() && !review;
    $('btn-refuse').hidden = Boolean(review) || isChoice();
    $('foot-hint').textContent = review
      ? (isChoice() ? '' : 'Bút đỏ là phần chữa của trưởng ca.')
      : isChoice() ? 'Chọn một cách xử lý.' : 'Bấm vào câu sai để gạch. Câu hỏi vi phạm pháp luật thì từ chối phục vụ.';
  }

  function renderChoice() {
    const def = L.current(shift).def;
    const box = el('li', 'choice');
    box.append(el('p', 'choice-prompt', def.prompt));
    if (review) {
      box.append(el('p', 'choice-picked', `→ ${review.option.label}`));
    } else {
      def.options.forEach((option, i) => {
        if (L.passes(option, campaign)) box.append(button('choice-option', option.label, () => chooseOption(i)));
      });
    }
    $('answer').replaceChildren(box);
  }

  const MARGIN = {
    ok: ['✓', 'is-ok is-muted'],
    fixed: ['bắt được ✓', 'is-ok'],
    proved: [`có dẫn chứng +${L.PROOF_BONUS}`, 'is-ok'],
    missed: ['LỌT!', ''],
    accused: ['gạch nhầm!', ''],
  };
  // Refusals and unlawful requests are judged as a whole, not line by line.
  const isWholeVerdict = (r) => ['refused', 'refusedWrongly', 'abetted'].includes(r.outcome);

  function proofText(variant) {
    if (!variant.facts) return `Lý do: ${variant.why}`;
    const id = variant.facts[0];
    return `Sổ tay Công vụ — ${factCite.get(id)}: “${factText.get(id)}”${variant.why ? ` ${variant.why}` : ''}`;
  }

  function renderLines(isNew) {
    const live = L.current(shift);
    const rows = live.segs.map((seg, i) => {
      const row = el('li', 'line');
      row.classList.toggle('is-flagged', !review && seg.isFlagged);
      if (isNew) {
        row.classList.add('is-new');
        row.style.animationDelay = `${1.4 + i * 0.22}s`;
      }
      const body = el('div', 'line-body');
      const margin = el('p', 'margin');

      if (review && isWholeVerdict(review)) {
        body.append(el('p', 'line-btn', L.segText(seg)));
      } else if (review) {
        const status = review.statuses[i];
        if (status === 'ok' || status === 'accused') {
          body.append(el('p', 'line-btn', seg.def.ok));
          if (status === 'accused') body.append(el('p', 'line-proof', 'Câu này MIRA nói đúng, không được gạch.'));
        } else {
          body.append(el('del', '', seg.variant.text), el('p', 'line-fix', `→ ${seg.def.ok}`),
            el('p', 'line-proof', proofText(seg.variant)));
        }
        margin.textContent = MARGIN[status][0];
        margin.className = `margin ${MARGIN[status][1]}`;
      } else {
        const line = button('line-btn', undefined, () => {
          L.toggleFlag(seg);
          renderLines();
          if (seg.isFlagged) coachEvent('flag');
        });
        line.append(el('span', 'line-text', L.segText(seg)));
        line.setAttribute('aria-pressed', String(seg.isFlagged));
        line.title = seg.isFlagged ? 'Bấm để bỏ gạch' : 'Bấm để gạch câu này là sai';
        body.append(line);
        if (seg.card) {
          const note = el('div', 'line-note');
          const remove = button('', '✕', () => { L.detach(seg); renderLines(); });
          remove.setAttribute('aria-label', 'Gỡ ghi chú khỏi câu này');
          note.append(el('span', '', `Dẫn chứng: ${factCite.get(seg.card)}`), remove);
          body.append(note);
        }
        if (armedFact) body.append(button('attach', 'Đính ghi chú vào câu này', () => attachTo(i, armedFact)));
        if (seg.isFlagged) margin.textContent = 'sai ✗';
        row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('is-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('is-over'));
        row.addEventListener('drop', (event) => {
          event.preventDefault();
          row.classList.remove('is-over');
          const factId = event.dataTransfer.getData('text/plain');
          if (factText.has(factId)) attachTo(i, factId);
        });
      }
      row.append(el('span', 'line-no', pad(i + 1)), body, margin);
      return row;
    });
    $('answer').replaceChildren(...rows);
  }

  const STAMPS = {
    clean: ['Đã duyệt', 'is-good'], missed: ['Lọt lỗi', 'is-bad'], accused: ['Gạch nhầm', 'is-bad'],
    refused: ['Từ chối phục vụ', 'is-refused'], refusedWrongly: ['Từ chối nhầm', 'is-bad'], abetted: ['Đã duyệt', 'is-bad'],
  };

  function renderStamp() {
    const stamp = $('stamp');
    stamp.hidden = !review || review.outcome === 'choice';
    if (stamp.hidden) return;
    const [label, tone] = STAMPS[review.outcome];
    const small = review.citation ? `Lập biên bản số ${campaign.citations + shift.citations.length}` : `Quầy 07 · ${shiftTime(shift.index)}`;
    stamp.className = `stamp ${tone}`;
    stamp.replaceChildren(label, el('small', '', small));
  }

  function renderNote() {
    const note = $('verdict');
    note.hidden = !review;
    if (!review) return;
    const effectNote = review.effect && review.effect.note;
    if (review.outcome === 'choice') {
      note.className = 'supervisor-note is-good';
      note.replaceChildren(el('p', 'clipping', review.option.reply));
      return;
    }
    note.className = `supervisor-note ${review.isClean ? 'is-good' : ''}`;
    if (review.isClean) {
      const proofs = review.statuses.filter((s) => s === 'proved').length;
      const head = review.outcome === 'refused' ? `Đúng quy chế. +${review.points} hiệu suất.` : `Tốt. +${review.points} hiệu suất${proofs ? `, có ${proofs} dẫn chứng` : ''}.`;
      note.replaceChildren(el('p', 'hand', head), el('p', 'clipping', effectNote || review.live.def.win || 'Khách rời quầy.'));
      return;
    }
    const parts = [];
    if (review.citation) parts.push(el('p', 'hand', `Biên bản số ${campaign.citations + shift.citations.length}. ${review.citation}`));
    if (effectNote) parts.push(el('p', 'hand', effectNote));
    if (review.outcome === 'refusedWrongly') parts.push(el('p', 'clipping', 'Câu hỏi này hoàn toàn hợp pháp. Khách cần được trả lời, không phải bị từ chối.'));
    if (review.headlines.length) {
      const clipping = el('div', 'clipping');
      clipping.append(el('b', '', 'Bản tin Tân Cảng · sáng mai'));
      for (const line of review.headlines) clipping.append(el('p', '', line));
      parts.push(clipping);
    }
    note.replaceChildren(...parts);
  }

  // BR-JDG-01: no hint about whether the note is right — that shows on submit.
  function attachTo(index, factId) {
    L.attach(L.current(shift).segs[index], factId);
    armedFact = null;
    coachEvent('flag');
    say('Đã đính ghi chú và gạch câu này.');
    renderLines();
    renderTray();
  }

  // ---- Notes copied from the book ----------------------------------------
  function renderTray() {
    $('tray-count').textContent = `(${shift.tray.length}/${L.TRAY_MAX})`;
    $('tray-hint').textContent = armedFact
      ? 'Chọn câu muốn đính ghi chú (bấm lại ghi chú để bỏ chọn).'
      : shift.tray.length
        ? 'Kéo ghi chú vào câu sai, hoặc bấm ghi chú rồi chọn câu. Dẫn chứng đúng được cộng hiệu suất.'
        : 'Không bắt buộc. Trong Sổ tay, bấm "chép" ở một điều khoản để có ghi chú làm dẫn chứng.';

    $('tray').replaceChildren(...shift.tray.map((factId) => {
      const note = el('div', 'note');
      note.draggable = true;
      note.classList.toggle('is-armed', armedFact === factId);
      note.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', factId);
        event.dataTransfer.effectAllowed = 'copy';
      });
      const main = button('note-main', factText.get(factId), () => {
        armedFact = armedFact === factId ? null : factId;
        renderTray();
        if (!isChoice()) renderLines();
      });
      main.append(el('small', '', factCite.get(factId)));
      main.setAttribute('aria-pressed', String(armedFact === factId));
      const remove = button('note-x', '✕', () => {
        L.unpin(shift, factId);
        if (armedFact === factId) armedFact = null;
        renderTray();
        if (!isChoice()) renderLines();
        renderEntry();
      });
      remove.setAttribute('aria-label', 'Bỏ ghi chú này');
      note.append(main, remove);
      return note;
    }));
  }

  // ---- The reference book ------------------------------------------------
  const bookEntries = () => L.entriesFor(D, shift.night);

  function renderToc() {
    const query = plain($('search').value.trim());
    const matches = bookEntries().filter((entry) =>
      !query || plain(entry.title).includes(query) || plain(entry.tag).includes(query)
      || entry.facts.some((f) => plain(f.text).includes(query)));
    if (!matches.length) {
      $('entries').replaceChildren(el('p', 'toc-empty', 'Mục lục không có mục nào như vậy.'));
      return;
    }
    const parts = [];
    let chapter = null;
    const ordered = [...matches].sort((a, b) => a.tag.localeCompare(b.tag, 'vi') || pageOf.get(a.id) - pageOf.get(b.id));
    for (const entry of ordered) {
      if (entry.tag !== chapter) {
        chapter = entry.tag;
        parts.push(el('p', 'toc-chapter', chapter));
      }
      const isOpened = shift.opened.has(entry.id);
      const isNew = (entry.night || 0) === shift.night && shift.night > 0;
      const row = button('toc-row', undefined, () => openEntry(entry.id));
      row.classList.toggle('is-current', openEntryId === entry.id);
      row.classList.toggle('is-opened', isOpened);
      row.disabled = !isOpened && shift.lookups === 0;
      row.append(el('span', 'toc-title', isNew ? `${entry.title} · mới` : entry.title), el('span', 'toc-page', String(pageOf.get(entry.id))));
      row.setAttribute('aria-label', `${entry.title}, trang ${pageOf.get(entry.id)}${isNew ? ', mục mới' : ''}${isOpened ? ', đã đánh dấu' : row.disabled ? ', hết dải đánh dấu' : ''}`);
      parts.push(row);
    }
    $('entries').replaceChildren(...parts);
  }

  function openEntry(entryId) {
    const outcome = L.openEntry(shift, entryId);
    if (outcome === 'empty') {
      say('Hết dải đánh dấu cho ca này. Chỉ mở lại được các trang đã đánh dấu.');
      return;
    }
    if (outcome === 'paid') {
      say(shift.lookups ? `Đã kẹp một dải đánh dấu. Còn ${shift.lookups} dải.` : 'Đã dùng dải đánh dấu cuối cùng.');
      renderHud(true);
    }
    const isNewPage = openEntryId !== entryId;
    openEntryId = entryId;
    renderToc();
    renderEntry();
    if (isNewPage) {
      replay($('entry'), 'is-turning');
      GameAudio.sfx('page');
    }
  }

  function renderEntry() {
    const page = $('entry');
    const entry = bookEntries().find((e) => e.id === openEntryId);
    if (!entry) {
      const blank = el('div', 'entry-blank');
      blank.append(el('p', 'hand', 'Tin sổ, đừng tin máy.'),
        el('p', '', `Bản in giấy, biên soạn và đối chiếu bởi Sở Thông tin, không qua AI. Chọn một mục ở trang bên trái để tra. Mỗi trang mới cần kẹp một dải đánh dấu (còn ${shift.lookups}/${L.LOOKUPS} cho cả ca); trang đã kẹp thì mở lại tự do.`));
      page.replaceChildren(blank);
      page.scrollTop = 0;
      return;
    }
    const list = el('ol', 'facts');
    entry.facts.forEach((fact, k) => {
      const isCopied = shift.tray.includes(fact.id);
      const copy = button('copy', isCopied ? 'đã chép' : 'chép', () => {
        if (L.pin(shift, fact.id) === 'full') {
          say(`Đã có ${L.TRAY_MAX} ghi chú. Bỏ bớt một ghi chú trước.`);
          return;
        }
        coachEvent('pin');
        renderTray();
        renderEntry();
      });
      copy.disabled = isCopied || Boolean(review);
      copy.setAttribute('aria-label', `${isCopied ? 'Đã chép' : 'Chép thành ghi chú'}: ${fact.text}`);
      const item = el('li', 'fact');
      item.append(el('span', 'fact-no', `§${k + 1}`), el('span', '', fact.text), copy);
      list.append(item);
    });
    page.replaceChildren(el('span', 'entry-tag', entry.tag), el('h3', 'entry-title', entry.title),
      el('p', 'entry-folio', `Trang ${pageOf.get(entry.id)}`), list);
    page.scrollTop = 0;
  }

  // ---- A request ---------------------------------------------------------
  function renderCase() {
    const live = L.current(shift);
    armedFact = null;
    review = null;
    hideIntercom();
    $('who-name').textContent = live.def.who;
    $('who-meta').textContent = live.def.meta;
    $('ask').textContent = live.def.ask;
    $('speech-note').hidden = true;
    $('speech').dataset.radio = live.def.look ? '' : '1';
    $('speech').classList.remove('is-reply', 'is-angry');
    replay($('speech'), 'is-new');
    Scene3D.setClock(shiftTime(shift.index));
    Scene3D.enterCustomer(live.def.look);
    voiceLine(live.def.ask, false, live.def.look ? 1.5 : 0.2);
    renderHud();
    renderForm(true);
    renderToc();
    renderEntry();
    $('sheet-body').scrollTop = 0;
  }

  const REACTION = { clean: 'happy', missed: 'missed', accused: 'accused', refusedWrongly: 'accused', refused: 'refused', abetted: 'happy' };
  const REPLY_POOL = { clean: 'happy', missed: 'missed', accused: 'accused', refusedWrongly: 'accused', refused: 'accused', abetted: 'happy' };

  function send(decision) {
    coachEvent('submit');
    const result = L.submit(shift, D, Math.random, decision);
    GameAudio.sfx('stamp');
    const def = result.live.def;
    result.effect = def.story ? L.applyOutcome(campaign, result) : null;
    if (result.outcome === 'missed') {
      result.headlines = result.live.segs.filter((seg, i) => result.statuses[i] === 'missed').map((seg) => seg.variant.boom);
    } else if (result.outcome === 'accused') {
      result.headlines = [pick(D.accused)];
    } else if (result.outcome === 'refusedWrongly') {
      result.headlines = ['Một công dân bị Quầy 07 từ chối phục vụ dù câu hỏi hoàn toàn hợp pháp.'];
    } else {
      result.headlines = result.effect && result.effect.headline ? [result.effect.headline] : [];
    }
    review = result;
    armedFact = null;
    Scene3D.react(REACTION[result.outcome]);
    const reply = (def.replies && def.replies[result.outcome]) || pick(D.replies[REPLY_POOL[result.outcome]]);
    speak(reply, ['accused', 'refusedWrongly'].includes(result.outcome));
    if (result.citation) intercom(campaign.citations + shift.citations.length, result.citation);
    renderHud();
    renderForm();
    renderEntry();
    $('sheet-body').scrollTop = 0;
  }

  function chooseOption(index) {
    const result = L.choose(shift, index);
    result.effect = L.applyOutcome(campaign, result);
    result.headlines = [];
    review = result;
    GameAudio.sfx('stamp');
    speak(result.option.reply, false);
    renderForm();
  }

  // Swap the bubble's text for a reply, angry or not.
  function speak(text, isAngry, note) {
    $('ask').textContent = text;
    voiceLine(text, isAngry);
    $('speech-note').textContent = note || '';
    $('speech-note').hidden = !note;
    $('speech').classList.toggle('is-angry', Boolean(isAngry));
    $('speech').classList.remove('is-new');
    replay($('speech'), 'is-reply');
  }

  function proceed() {
    coachEvent('next');
    GameAudio.stopVoice();
    Scene3D.calmDown();
    if (review && review.outcome === 'missed' && review.live.def.look) comeBack(review, advance);
    else advance();
  }

  function advance() {
    if (L.next(shift)) renderCase();
    else showNightReport();
  }

  // A customer who left with a wrong answer comes back after acting on it.
  function comeBack(result, done) {
    const def = result.live.def;
    $('btn-send').disabled = true;
    $('who-name').textContent = def.who;
    $('who-meta').textContent = 'quay lại · 40 phút sau';
    speak(pick(D.replies.comeback), true, result.headlines[0]);
    const wait = Scene3D.storm(def.look) || 3500;
    setTimeout(() => {
      $('btn-send').disabled = false;
      done();
    }, wait + 1200);
  }

  // ---- First-request walkthrough -------------------------------------------
  // Shown on the first request of a new campaign until finished or skipped.
  // It never hints which sentence is wrong (BR-JDG-01). until = the player
  // action that moves it on by itself.
  const COACH_KEY = 'kdv-tutorial';
  const COACH = [
    { at: 'form-ask', text: 'Đây là câu hỏi của khách. Phần trả lời bên dưới do MIRA soạn: rất nhanh, rất tự tin, và hay có lỗi.' },
    { at: 'answer', until: 'flag', text: 'Đọc từng câu. Thấy câu nào sai thì bấm vào để gạch bút đỏ. Gạch nhầm câu đúng cũng bị lập biên bản.' },
    { at: 'book-cover', until: 'book', text: 'Không chắc một con số, một quy định? Mở Sổ tay Công vụ. Lỗi vô lý thì đọc là thấy, không cần tra.' },
    { at: 'entries', until: 'pin', text: 'Mỗi trang mới tốn một dải đánh dấu (5 dải mỗi ca). Bấm "chép" ở điều khoản hợp lý để có ghi chú, kéo vào câu sai để được cộng điểm. Không bắt buộc.' },
    { at: 'btn-send', until: 'submit', text: 'Xong thì ký duyệt và trao phiếu. Nếu câu hỏi nhằm vi phạm pháp luật, bấm "Từ chối phục vụ" thay vì ký.' },
    { at: 'answer', until: 'next', text: 'Bút đỏ của trưởng ca chỉ ra chỗ bạn đúng và sai, kèm lý do. Xem xong thì gọi khách tiếp theo.' },
  ];
  let coachStep = -1;
  let coached = null;

  function coachDone() {
    try { return localStorage.getItem(COACH_KEY) === 'done'; } catch (error) { return false; }
  }

  function startCoach() {
    if (coachDone() || campaign.night !== 0 || shift.index !== 0) return;
    coachStep = 0;
    renderCoach();
  }

  function endCoach() {
    coachStep = -1;
    renderCoach();
    try { localStorage.setItem(COACH_KEY, 'done'); } catch (error) { /* storage blocked */ }
  }

  // A player action: jump past the first remaining step it completes.
  function coachEvent(name) {
    if (coachStep < 0) return;
    const hit = COACH.findIndex((s, i) => i >= coachStep && s.until === name);
    if (hit < 0) return;
    coachStep = hit + 1;
    if (coachStep >= COACH.length) endCoach();
    else renderCoach();
  }

  function renderCoach() {
    if (coached) coached.classList.remove('is-coached');
    coached = null;
    const box = $('coach');
    box.hidden = coachStep < 0;
    if (box.hidden) return;
    const step = COACH[coachStep];
    $('coach-step').textContent = `Hướng dẫn · ${coachStep + 1}/${COACH.length}`;
    $('coach-text').textContent = step.text;
    $('coach-next').textContent = coachStep === COACH.length - 1 ? 'Xong' : 'Tiếp';
    coached = $(step.at);
    coached.classList.add('is-coached');
    if (step.at === 'entries') setBookOpen(true);
    coached.scrollIntoView({ block: 'nearest' });
    placeCoach();
    setTimeout(placeCoach, 450);   // again once the book has finished opening
  }

  // Below the target when there is room, otherwise above; kept on screen.
  function placeCoach() {
    if (coachStep < 0 || !coached) return;
    const box = $('coach');
    const r = coached.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const below = r.bottom + 12;
    const y = below + h < window.innerHeight - 8 ? below : Math.max(8, r.top - h - 12);
    const x = Math.min(Math.max(16, r.left + Math.min(r.width, 360) / 2 - w / 2), window.innerWidth - w - 16);
    box.style.left = `${Math.round(x)}px`;
    box.style.top = `${Math.round(y)}px`;
  }

  // ---- Between nights ----------------------------------------------------
  function report(kicker, title, left, right, action) {
    const grid = el('div', 'report-grid');
    grid.append(left, right);
    left.append(action);
    const article = el('article', 'report');
    article.append(el('p', 'report-kicker', kicker), el('h2', '', title), grid);
    $('screen-end').replaceChildren(article);
    show('screen-end');
    $('screen-end').scrollTop = 0;
    action.focus({ preventScroll: true });
  }

  function tallyRow(label, value) {
    const li = el('li');
    li.append(el('span', '', label), el('span', '', value));
    return li;
  }

  function newsColumn(title, lines, empty) {
    const news = el('section', 'news');
    const head = el('h3', '', title);
    head.append(el('small', '', `Số ra sáng ngày ${14 + campaign.night} tháng 3 năm 2041`));
    const list = el('ul');
    for (const line of lines.length ? lines : [empty]) list.append(el('li', '', line));
    news.append(head, list);
    return news;
  }

  function showNightReport() {
    const judged = L.judgedCount(shift);
    const clean = L.cleanCount(shift);
    const rank = D.ranks[Math.round((clean / Math.max(1, judged)) * (D.ranks.length - 1))];
    const headlines = shift.results.flatMap((r) => r.headlines || []);
    const nightTitle = S.nights[shift.night].title;
    Scene3D.leaveCustomer();

    const tally = el('ul', 'tally');
    tally.append(
      tallyRow('Phiếu đạt', `${clean}/${judged}`),
      tallyRow('Hiệu suất đêm nay', String(shift.score)),
      tallyRow(`Dải đánh dấu còn thừa (${shift.lookups} × ${L.LEFTOVER_BONUS})`, `+${L.leftoverBonus(shift)}`),
      tallyRow('Biên bản đêm nay', String(shift.citations.length)),
    );
    L.closeNight(campaign, shift, headlines);
    saveCampaign();
    tally.append(tallyRow('Tổng hiệu suất cả chiến dịch', String(campaign.score)));
    const left = el('div');
    left.append(el('p', `rank ${clean / Math.max(1, judged) >= 0.75 ? 'is-good' : clean / Math.max(1, judged) <= 0.25 ? 'is-bad' : ''}`, rank.title), el('p', '', rank.line), tally);

    const isOver = L.isOver(S, campaign);
    const action = button('btn-ink', isOver ? 'Xem kết cục' : 'Sang đêm tiếp theo', () => (isOver ? showEnding() : showMemo()));
    report(`Báo cáo cuối ca · ${nightTitle}`, 'Đánh giá ca đêm', left, newsColumn('Tân Cảng Sáng Nay', headlines, 'Đêm qua không có sự cố nào liên quan đến Quầy 07.'), action);
  }

  function showEnding() {
    const ending = L.pickEnding(S, campaign);
    const left = el('div', 'ending');
    const text = el('div', 'ending-text');
    for (const line of ending.text) text.append(el('p', '', line));
    left.append(text);
    const stats = el('ul', 'tally');
    stats.append(
      tallyRow('Số đêm đã trực', String(S.nights.length)),
      tallyRow('Tổng hiệu suất', String(campaign.score)),
      tallyRow('Tổng biên bản', String(campaign.citations)),
    );
    const right = el('section', 'news');
    right.append(el('h3', '', 'Hồ sơ Kiểm duyệt viên Lâm'), stats);
    const again = button('btn-ink', 'Chơi lại từ đầu', restart);
    report('Kết cục', ending.title, left, right, again);
  }

  // ---- Night memo (handover letter) ---------------------------------------
  function showMemo() {
    if (L.isOver(S, campaign)) {
      showEnding();
      return;
    }
    const night = S.nights[campaign.night];
    $('memo-title').textContent = `Giấy giao ca · ${night.title}`;
    $('memo-date').textContent = `Tân Cảng, ngày ${14 + campaign.night} tháng 3 năm 2041`;
    $('memo-text').replaceChildren(...night.memo.map((line) => el('p', '', line)));
    const extra = [];
    if (night.note) extra.push(el('p', 'memo-note', night.note));
    const paper = [...L.morningPaper(S, campaign).slice(0, 4).map((p) => p.text), ...campaign.headlines.slice(0, 2)];
    if (paper.length) {
      const clip = el('div', 'memo-paper');
      clip.append(el('b', '', 'Tân Cảng Sáng Nay · kẹp kèm giấy giao ca'));
      for (const line of paper) clip.append(el('p', '', line));
      extra.push(clip);
    }
    $('memo-extra').replaceChildren(...extra);
    $('btn-restart').hidden = campaign.night === 0;
    show('screen-start');
    prepareNight(campaign.night === 0 ? 'Nhận ca' : `Nhận ca · ${night.title}`);
  }

  // Plans tonight's visitors and downloads their characters before the shift
  // starts (the rest load afterwards). A slow network can start after 15 s.
  function prepareNight(label) {
    nextShift = L.newNight(S, D, campaign);
    const names = nextShift.cases.map((c) => c.def.look && c.def.look.model).filter(Boolean);
    const startBtn = $('btn-start');
    const token = ++memoToken;
    const finish = () => {
      if (token !== memoToken || !startBtn.disabled) return;
      startBtn.disabled = false;
      startBtn.textContent = label;
      Scene3D.preload(allModels);
    };
    startBtn.disabled = true;
    startBtn.textContent = 'Đang tải nhân vật…';
    Scene3D.preload(names, (done, total) => {
      if (token === memoToken && startBtn.disabled) startBtn.textContent = `Đang tải nhân vật… ${done}/${total}`;
    }).then(finish);
    setTimeout(finish, 15000);
  }

  function startNight() {
    GameAudio.start();
    setBookOpen(false);
    shift = nextShift || L.newNight(S, D, campaign);
    nextShift = null;
    serial = 1000 + campaign.night * 400 + Math.floor(Math.random() * 300);
    openEntryId = null;
    $('search').value = '';
    Scene3D.reset();
    show('screen-game');
    renderCase();
    startCoach();
  }

  function restart() {
    campaign = L.newCampaign(S);
    saveCampaign();
    showMemo();
  }

  // ---- Book open/closed, music on/off ------------------------------------
  function setBookOpen(isOpen) {
    $('screen-game').classList.toggle('is-book-closed', !isOpen);
    $('book-cover').setAttribute('aria-expanded', String(isOpen));
    if (isOpen) GameAudio.sfx('page');
    if (isOpen) coachEvent('book');
  }

  function setMusic(isOn) {
    GameAudio.setMuted(!isOn);
    $('btn-sound').setAttribute('aria-pressed', String(isOn));
    const label = isOn ? 'Tắt nhạc' : 'Bật nhạc';
    $('btn-sound').setAttribute('aria-label', label);
    $('btn-sound').title = label;
    try { localStorage.setItem('kdv-music', isOn ? 'on' : 'off'); } catch (error) { /* storage blocked: keep in memory only */ }
  }

  // ---- Wiring ------------------------------------------------------------
  const has3d = Scene3D.init($('stage-view'), $('stage-canvas'));
  $('stage').classList.toggle('is-3d', has3d);
  Scene3D.watchCustomer(placeSpeech);
  showMemo();

  $('btn-start').addEventListener('click', startNight);
  $('coach-next').addEventListener('click', () => {
    coachStep += 1;
    if (coachStep >= COACH.length) endCoach();
    else renderCoach();
  });
  $('coach-skip').addEventListener('click', endCoach);
  window.addEventListener('resize', placeCoach);
  $('btn-restart').addEventListener('click', () => {
    if (window.confirm('Xóa tiến trình và chơi lại từ Đêm thứ nhất?')) restart();
  });
  $('btn-send').addEventListener('click', () => (review ? proceed() : send('sign')));
  $('btn-refuse').addEventListener('click', () => send('refuse'));
  $('search').addEventListener('input', renderToc);
  $('book-cover').addEventListener('click', () => {
    setBookOpen(true);
    $('search').focus({ preventScroll: true });
  });
  $('book-close').addEventListener('click', () => {
    setBookOpen(false);
    $('book-cover').focus();
  });
  $('btn-sound').addEventListener('click', () => {
    GameAudio.start();
    setMusic(GameAudio.isMuted());
  });
  let savedMusic = 'on';
  try { savedMusic = localStorage.getItem('kdv-music') || 'on'; } catch (error) { /* storage blocked */ }
  setMusic(savedMusic === 'on');
})();
