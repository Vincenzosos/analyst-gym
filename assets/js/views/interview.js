// Interviews: question bank with guidance, STAR story bank, video room, commercial-awareness builder.
import { h, esc, md, fmtTime, pick, rng, newSeed, shuffle } from '../util.js';
import { content } from '../content.js';
import { load, upsert, remove, logAttempt, logSession } from '../store.js';
import { go } from './common.js';

const CATS = [['all', 'Tutte'], ['motivation', 'Motivazione'], ['competency', 'Competenze'], ['strengths', 'Strengths'], ['banking-specific', 'Banking'], ['technical-explain', 'Spiega un concetto'], ['curveball', 'Curveball']];
const COMPS = ['teamwork', 'leadership', 'conflict', 'failure', 'pressure', 'detail', 'persuasion', 'initiative', 'ethics', 'adaptability', 'client', 'analytical'];

export function interviewView(root, sub, q) {
  const tabs = [['domande', 'Domande'], ['storie', 'Le mie storie (STAR)'], ['video', 'Video room'], ['commercial', 'Commercial awareness']];
  const cur = sub || 'domande';
  root.append(h('div', { class: 'page-h' }, h('h1', {}, 'Colloqui'), h('div', { class: 'seg' }, tabs.map(([k, t]) => h('a', { class: 'segbtn' + (k === cur ? ' on' : ''), href: `#/colloqui/${k}` }, t)))));
  if (cur === 'storie') return stories(root);
  if (cur === 'video') return videoRoom(root, { questionId: q.q });
  if (cur === 'commercial') return commercial(root);
  return questions(root, q.cat || 'all');
}

function questions(root, cat) {
  const C = content();
  const qs = C.behavioural.filter(x => cat === 'all' || x.category === cat);
  root.append(h('div', { class: 'chips-row' }, CATS.map(([k, t]) => h('a', { class: 'chip' + (k === cat ? ' on' : ''), href: `#/colloqui/domande?cat=${k}` }, t))));
  if (!qs.length) { root.append(h('p', { class: 'muted' }, 'Domande non ancora caricate.')); return; }
  const list = h('div', { class: 'qbank' });
  for (const x of qs) {
    const d = h('details', { class: 'qcard' });
    d.append(h('summary', {}, h('span', { class: 'chip' }, (CATS.find(c => c[0] === x.category) || [0, x.category])[1]), ' ', h('b', {}, x.q)));
    d.append(h('div', { class: 'q-body' },
      h('div', { class: 'q-tests' }, h('b', {}, 'Cosa vogliono capire: '), x.tests || ''),
      x.structure ? h('div', {}, h('div', { class: 'expl-h' }, 'Struttura'), h('ol', {}, x.structure.map(s => h('li', {}, s)))) : '',
      x.good ? h('div', {}, h('div', { class: 'expl-h' }, 'Cosa la rende forte'), h('ul', {}, x.good.map(s => h('li', {}, s)))) : '',
      x.pitfalls ? h('div', {}, h('div', { class: 'expl-h' }, 'Errori tipici'), h('ul', { class: 'pit' }, x.pitfalls.map(s => h('li', {}, s)))) : '',
      x.skeleton ? h('div', { class: 'skeleton' }, h('div', { class: 'expl-h' }, 'Scheletro (EN)'), h('p', {}, x.skeleton)) : '',
      h('div', { class: 'row-end' }, h('button', { class: 'primary small', onclick: () => go(`#/colloqui/video?q=${encodeURIComponent(x.id)}`) }, '🎥 Allenati in video'))));
    list.append(d);
  }
  root.append(list);
}

// ---------- STAR stories ----------
function stories(root) {
  const S = load();
  root.append(h('p', { class: 'muted' }, 'Costruisci 8 storie che coprano tutte le competenze: le riusi in ogni colloquio. Restano solo in questo browser (non vengono pubblicate). Rispetta l’NDA: settore e continente, niente nomi o cifre dei clienti.'));
  const covered = new Set(S.stories.flatMap(s => s.comps || []));
  root.append(h('div', { class: 'chips-row' }, COMPS.map(c => h('span', { class: 'chip' + (covered.has(c) ? ' on' : '') }, `${covered.has(c) ? '✓ ' : ''}${c}`))));
  const list = h('div', { class: 'stories' });
  const render = () => {
    list.innerHTML = '';
    for (const st of load().stories) list.append(storyCard(st, render));
    list.append(h('button', { class: 'ghost', onclick: () => { upsert('stories', { title: 'Nuova storia', situation: '', task: '', action: '', result: '', learned: '', comps: [] }); render(); } }, '+ Aggiungi storia'));
  };
  render();
  root.append(list);
}
function storyCard(st, rerender) {
  const f = (k, label, rows = 2) => h('label', { class: 'fld' }, h('span', {}, label), h('textarea', { rows, oninput: e => { st[k] = e.target.value; upsert('stories', st); } }, st[k] || ''));
  const comps = h('div', { class: 'chips-row' }, COMPS.map(c => h('button', { class: 'chip' + ((st.comps || []).includes(c) ? ' on' : ''), onclick: e => { st.comps = (st.comps || []).includes(c) ? st.comps.filter(x => x !== c) : [...(st.comps || []), c]; upsert('stories', st); e.target.classList.toggle('on'); } }, c)));
  return h('details', { class: 'story' }, h('summary', {}, h('b', {}, st.title || 'Senza titolo'), h('span', { class: 'muted small' }, ` · ${(st.comps || []).join(', ')}`)),
    h('div', { class: 'story-b' },
      h('label', { class: 'fld' }, h('span', {}, 'Titolo'), h('input', { value: st.title || '', oninput: e => { st.title = e.target.value; upsert('stories', st); } })),
      f('situation', 'Situazione (contesto in 1-2 frasi)'), f('task', 'Task (il tuo obiettivo)'), f('action', 'Azioni (cosa hai fatto TU, con numeri)', 4), f('result', 'Risultato (misurabile)'), f('learned', 'Cosa hai imparato / cosa rifaresti'),
      h('div', { class: 'muted small' }, 'Competenze coperte:'), comps,
      h('div', { class: 'row-end' }, h('button', { class: 'ghost small danger', onclick: () => { if (confirmDelete()) { remove('stories', st.id); rerender(); } } }, 'Elimina'))));
}
function confirmDelete() { return window.confirm('Eliminare questa voce?'); }

// ---------- video room ----------
export function videoRoom(root, { questionId = null, questions = null, onDone = null, prep = 30, answer = 120 } = {}) {
  const C = content();
  const pool = C.behavioural.length ? C.behavioural : [{ id: 'fallback', q: 'Tell us about yourself and why you are applying for this role.', time: 90 }];
  let list = questions || (questionId ? pool.filter(x => x.id === questionId) : [pick(rng(newSeed()), pool)]);
  if (!list.length) list = [pick(rng(newSeed()), pool)];
  let i = 0, stream = null, rec = null, chunks = [], phase = 'idle', t0 = 0, tick = null;
  const box = h('div', { class: 'video-room' });
  root.append(box);
  const cleanup = () => { clearInterval(tick); if (rec && rec.state !== 'inactive') rec.stop(); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  window.addEventListener('hashchange', cleanup, { once: true });

  const settings = { prep, answer };
  const draw = () => {
    box.innerHTML = '';
    const qx = list[i];
    const qEl = h('div', { class: 'vr-q' }, h('div', { class: 'muted small' }, `Domanda ${i + 1}/${list.length}`), h('div', { class: 'vr-qt' }, qx.q));
    const vid = h('video', { class: 'vr-cam', autoplay: true, muted: true, playsinline: true });
    const timer = h('div', { class: 'vr-timer' }, '');
    const status = h('div', { class: 'vr-status' }, 'Pronto');
    const startBtn = h('button', { class: 'primary big', onclick: () => start() }, '▶ Inizia (preparazione 30 s)');
    const stopBtn = h('button', { class: 'ghost', onclick: () => stopRec() }, '■ Ho finito');
    const noCam = h('label', { class: 'small muted' }, h('input', { type: 'checkbox', id: 'nocam' }), ' Senza videocamera (solo timer)');
    const sel = h('div', { class: 'seg' }, [[30, 120], [30, 180], [60, 120]].map(([p, a]) => h('button', { class: p === settings.prep && a === settings.answer ? 'on' : '', onclick: e => { settings.prep = p; settings.answer = a; [...e.target.parentNode.children].forEach(b => b.classList.remove('on')); e.target.classList.add('on'); startBtn.textContent = `▶ Inizia (preparazione ${p} s)`; } }, `${p}s / ${a / 60}′`)));
    box.append(qEl, h('div', { class: 'vr-stage' }, vid, timer, status), h('div', { class: 'vr-ctrl' }, sel, noCam, startBtn));
    const rest = h('div', { class: 'vr-rest' }); box.append(rest);

    async function start() {
      startBtn.disabled = true;
      const useCam = !box.querySelector('#nocam').checked;
      if (useCam && !stream) {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); vid.srcObject = stream; }
        catch (e) { status.textContent = 'Videocamera non disponibile: uso solo il timer.'; }
      }
      phase = 'prep'; t0 = performance.now();
      status.textContent = 'Preparazione: organizza la risposta (apertura · 2-3 punti · chiusura)';
      clearInterval(tick);
      tick = setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        if (phase === 'prep') {
          timer.textContent = `⏳ ${Math.max(0, Math.ceil(settings.prep - el))}s`;
          if (el >= settings.prep) beginAnswer();
        } else if (phase === 'answer') {
          const left = settings.answer - el;
          timer.textContent = `🔴 ${fmtTime(left * 1000)}`;
          timer.classList.toggle('warn', left < 20);
          if (left <= 0) stopRec();
        }
      }, 200);
      box.querySelector('.vr-ctrl').replaceChildren(stopBtn);
    }
    function beginAnswer() {
      phase = 'answer'; t0 = performance.now(); chunks = [];
      status.textContent = 'Registrazione in corso: guarda in camera';
      if (stream && window.MediaRecorder) {
        try { rec = new MediaRecorder(stream); rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.start(); } catch { rec = null; }
      }
    }
    function stopRec() {
      if (phase === 'prep') { beginAnswer(); return; }
      const dur = (performance.now() - t0) / 1000;
      phase = 'done'; clearInterval(tick); timer.textContent = `✔ ${fmtTime(dur * 1000)}`;
      const finishUI = () => review(dur);
      if (rec && rec.state !== 'inactive') { rec.onstop = finishUI; rec.stop(); } else finishUI();
    }
    function review(dur) {
      status.textContent = 'Riguarda e valuta con onestà';
      box.querySelector('.vr-ctrl').replaceChildren();
      if (chunks.length) {
        const blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
        const url = URL.createObjectURL(blob);
        rest.append(h('div', { class: 'vr-play' }, h('video', { src: url, controls: true, class: 'vr-rec' }), h('a', { href: url, download: `risposta-${Date.now()}.webm`, class: 'ghost small btnlink' }, 'Scarica il video (resta sul tuo computer)')));
      }
      const crit = [['dir', 'Risposta diretta nella prima frase'], ['str', 'Struttura chiara (STAR o punto-motivi-chiusura)'], ['evi', 'Esempio concreto con numeri o fatti'], ['fit', 'Collegamento a banca, ruolo e team'], ['del', 'Delivery: ritmo, sguardo in camera, niente filler']];
      const scores = {};
      const timeOk = dur >= Math.min(45, settings.answer * 0.4) && dur <= settings.answer;
      const form = h('div', { class: 'rubric' }, h('div', { class: 'expl-h' }, `Autovalutazione · durata ${fmtTime(dur * 1000)} ${timeOk ? '✓' : '(punta a 60–120 s)'}`),
        crit.map(([k, t]) => h('div', { class: 'rub-row' }, h('span', {}, t), h('div', { class: 'seg small' }, [1, 2, 3, 4, 5].map(v => h('button', { onclick: e => { scores[k] = v; [...e.target.parentNode.children].forEach(b => b.classList.toggle('on', Number(b.textContent) <= v)); } }, String(v)))))));
      const qx2 = list[i];
      const guide = qx2.structure ? h('details', { class: 'qcard' }, h('summary', {}, 'Confronta con la struttura consigliata'), h('ol', {}, qx2.structure.map(s => h('li', {}, s))), qx2.skeleton ? h('p', { class: 'skeleton' }, qx2.skeleton) : '') : '';
      const save = h('button', { class: 'primary', onclick: () => {
        const vals = crit.map(([k]) => scores[k] || 0);
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        logAttempt({ id: `video:${qx2.id}`, skill: 'behavioural', level: 2, ok: avg >= 4, score: avg / 5, ms: dur * 1000, target: settings.answer, mode: 'video' });
        logSession({ kind: 'video', q: qx2.id, score: avg / 5, ms: dur * 1000 });
        if (i + 1 < list.length) { i++; draw(); } else { cleanup(); if (onDone) onDone(); else { box.innerHTML = ''; box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Salvato'), h('div', { class: 'muted' }, 'Rifai la stessa domanda finché tutti i criteri sono ≥4.')), h('button', { class: 'primary', onclick: () => { location.hash = `#/colloqui/video?r=${Date.now()}`; } }, 'Altra domanda'))); } }
      } }, i + 1 < list.length ? 'Salva e prossima domanda' : 'Salva');
      rest.append(form, guide, h('div', { class: 'row-end' }, h('button', { class: 'ghost', onclick: () => { rest.innerHTML = ''; draw(); } }, 'Rifai'), save));
    }
  };
  draw();
}

// ---------- commercial awareness builder ----------
function commercial(root) {
  root.append(h('div', { class: 'card' }, h('div', { class: 'md', html: md('Domanda tipica (BofA, JPM, HSBC): **"Tell us about a current event and how it affects markets and our business."** Rispondi in 3 passi, 60–90 secondi:\n\n1. **Evento**: cosa è successo, una frase, con un numero o una data.\n2. **Impatto sui mercati**: tassi, valute, credit spread, borse, settore. Spiega il meccanismo.\n3. **Collegamento al ruolo**: cosa cambia per i clienti della banca (M&A, finanziamenti, IPO) e cosa faresti tu da analyst.\n\nPrepara 3 eventi aggiornati ogni settimana. Le fonti vanno verificate da te: questo sito non si aggiorna da solo con le notizie.') })));
  const list = h('div', { class: 'stories' });
  const render = () => {
    list.innerHTML = '';
    for (const c of load().commercial) {
      const f = (k, label, rows = 2) => h('label', { class: 'fld' }, h('span', {}, label), h('textarea', { rows, oninput: e => { c[k] = e.target.value; upsert('commercial', c); } }, c[k] || ''));
      list.append(h('details', { class: 'story' }, h('summary', {}, h('b', {}, c.title || 'Nuovo evento'), h('span', { class: 'muted small' }, c.created ? ` · ${new Date(c.created).toLocaleDateString('it-IT')}` : '')),
        h('div', { class: 'story-b' }, h('label', { class: 'fld' }, h('span', {}, 'Titolo'), h('input', { value: c.title || '', oninput: e => { c.title = e.target.value; upsert('commercial', c); } })),
          f('event', '1 · Evento (cosa, quando, un numero)'), f('impact', '2 · Impatto sui mercati (meccanismo)', 3), f('link', '3 · Collegamento al ruolo / ai clienti', 3), f('source', 'Fonte (link)', 1),
          h('div', { class: 'row-end' }, h('button', { class: 'ghost small danger', onclick: () => { if (confirmDelete()) { remove('commercial', c.id); render(); } } }, 'Elimina')))));
    }
    list.append(h('button', { class: 'ghost', onclick: () => { upsert('commercial', { title: '', event: '', impact: '', link: '', source: '' }); render(); } }, '+ Aggiungi evento'));
  };
  render();
  root.append(list);
}
