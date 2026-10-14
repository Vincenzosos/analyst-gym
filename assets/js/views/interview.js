// Interviews: question bank with guidance, STAR story bank, video room.
import { h, esc, md, fmtTime, pick, rng, newSeed, shuffle } from '../util.js';
import { content } from '../content.js';
import { load, upsert, remove, logAttempt, logSession } from '../store.js';
import { go, pageHead, tabs as tabBar } from './common.js';

const CATS = [['all', 'All'], ['motivation', 'Motivation'], ['competency', 'Competencies'], ['strengths', 'Strengths'], ['banking-specific', 'Banking'], ['technical-explain', 'Explain a concept'], ['curveball', 'Curveball']];
const COMPS = ['teamwork', 'leadership', 'conflict', 'failure', 'pressure', 'detail', 'persuasion', 'initiative', 'ethics', 'adaptability', 'client', 'analytical'];

export function interviewView(root, sub, q) {
  if (sub === 'commercial') { go('#/news/notes'); return; }
  const cur = ['stories', 'video'].includes(sub) ? sub : 'questions';
  root.append(pageHead({ kicker: 'Interviews', title: 'Speak like', accent: 'an analyst', sub: '80 questions with a structure and an answer skeleton, your STAR stories, and the video room for HireVue and Sonru.' }));
  root.append(tabBar([['questions', 'Questions', '#/interviews'], ['stories', 'My stories (STAR)', '#/interviews/stories'], ['video', 'Video room', '#/interviews/video']], cur));
  if (cur === 'stories') return stories(root);
  if (cur === 'video') return videoRoom(root, { questionId: q.q });
  return questions(root, q.cat || 'all');
}

function questions(root, cat) {
  const C = content();
  const qs = C.behavioural.filter(x => cat === 'all' || x.category === cat);
  root.append(h('div', { class: 'chips-row' }, CATS.map(([k, t]) => h('a', { class: 'chip' + (k === cat ? ' on' : ''), href: `#/interviews?cat=${k}` }, t))));
  if (!qs.length) { root.append(h('p', { class: 'muted' }, 'Questions not loaded yet.')); return; }
  const list = h('div', { class: 'qbank' });
  for (const x of qs) {
    const d = h('details', { class: 'qcard' });
    d.append(h('summary', {}, h('span', { class: 'chip' }, (CATS.find(c => c[0] === x.category) || [0, x.category])[1]), ' ', h('b', {}, x.q)));
    d.append(h('div', { class: 'q-body' },
      h('div', { class: 'q-tests' }, h('b', {}, 'What they want to find out: '), x.tests || ''),
      x.structure ? h('div', {}, h('div', { class: 'expl-h' }, 'Structure'), h('ol', {}, x.structure.map(s => h('li', {}, s)))) : '',
      x.good ? h('div', {}, h('div', { class: 'expl-h' }, 'What makes it strong'), h('ul', {}, x.good.map(s => h('li', {}, s)))) : '',
      x.pitfalls ? h('div', {}, h('div', { class: 'expl-h' }, 'Common mistakes'), h('ul', { class: 'pit' }, x.pitfalls.map(s => h('li', {}, s)))) : '',
      x.skeleton ? h('div', { class: 'skeleton' }, h('div', { class: 'expl-h' }, 'Answer skeleton'), h('p', { lang: 'en' }, x.skeleton)) : '',
      h('div', { class: 'row-end' }, h('button', { class: 'btn primary small', onclick: () => go(`#/interviews/video?q=${encodeURIComponent(x.id)}`) }, 'Practise on video'))));
    list.append(d);
  }
  root.append(list);
}

// ---------- STAR stories ----------
function stories(root) {
  const S = load();
  root.append(h('p', { class: 'muted' }, 'Build 8 stories that cover every competency: you reuse them in every interview. They stay in this browser only (never published). Respect your NDA: sector and region only, no client names or figures.'));
  const covered = new Set(S.stories.flatMap(s => s.comps || []));
  root.append(h('div', { class: 'chips-row' }, COMPS.map(c => h('span', { class: 'chip' + (covered.has(c) ? ' on' : '') }, `${covered.has(c) ? '✓ ' : ''}${c}`))));
  const list = h('div', { class: 'stories' });
  const render = () => {
    list.innerHTML = '';
    if (!load().stories.length) list.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'No stories yet'), h('div', { class: 'muted' }, 'Start with 3 stories: a team result, a mistake you learned from, a situation under pressure. Each covers several competencies.'))));
    for (const st of load().stories) list.append(storyCard(st, render));
    list.append(h('button', { class: 'btn ghost', onclick: () => { upsert('stories', { title: 'New story', situation: '', task: '', action: '', result: '', learned: '', comps: [] }); render(); } }, '+ Aggiungi storia'));
  };
  render();
  root.append(list);
}
function storyCard(st, rerender) {
  const f = (k, label, rows = 2) => h('label', { class: 'fld' }, h('span', {}, label), h('textarea', { rows, oninput: e => { st[k] = e.target.value; upsert('stories', st); } }, st[k] || ''));
  const comps = h('div', { class: 'chips-row' }, COMPS.map(c => h('button', { class: 'chip' + ((st.comps || []).includes(c) ? ' on' : ''), onclick: e => { st.comps = (st.comps || []).includes(c) ? st.comps.filter(x => x !== c) : [...(st.comps || []), c]; upsert('stories', st); e.target.classList.toggle('on'); } }, c)));
  return h('details', { class: 'story' }, h('summary', {}, h('b', {}, st.title || 'Untitled'), h('span', { class: 'muted small' }, ` · ${(st.comps || []).join(', ')}`)),
    h('div', { class: 'story-b' },
      h('label', { class: 'fld' }, h('span', {}, 'Title'), h('input', { value: st.title || '', oninput: e => { st.title = e.target.value; upsert('stories', st); } })),
      f('situation', 'Situation (context in 1-2 sentences)'), f('task', 'Task (your objective)'), f('action', 'Actions (what YOU did, with numbers)', 4), f('result', 'Result (measurable)'), f('learned', 'What you learned / what you would do differently'),
      h('div', { class: 'muted small' }, 'Competencies covered:'), comps,
      h('div', { class: 'row-end' }, h('button', { class: 'btn ghost small danger', onclick: () => { if (confirmDelete()) { remove('stories', st.id); rerender(); } } }, 'Delete'))));
}
export function confirmDelete() { return window.confirm('Delete this entry?'); }

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
    const qEl = h('div', { class: 'vr-q' }, h('div', { class: 'muted small' }, `Question ${i + 1}/${list.length}`), h('div', { class: 'vr-qt' }, qx.q));
    const vid = h('video', { class: 'vr-cam', autoplay: true, muted: true, playsinline: true });
    if (stream) vid.srcObject = stream; // keep the preview alive across questions and retakes
    const timer = h('div', { class: 'vr-timer' }, '');
    const status = h('div', { class: 'vr-status' }, stream ? 'Camera ready' : 'Ready: the camera switches on when you press Start');
    const idle = stream ? '' : h('div', { class: 'vr-idle' }, h('div', { class: 'vr-idle-ic', html: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 10 6-3v10l-6-3"/></svg>' }), h('div', {}, '30 seconds to think, then you record your answer. The video stays on this device only.'));
    const startBtn = h('button', { class: 'btn primary big', onclick: () => start() }, `Start (${settings.prep} s to prepare)`);
    const stopBtn = h('button', { class: 'btn ghost', onclick: () => stopRec() }, 'I’m done');
    const noCam = h('label', { class: 'small muted' }, h('input', { type: 'checkbox', id: 'nocam' }), ' No camera (timer only)');
    const sel = h('div', { class: 'seg' }, [[30, 120], [30, 180], [60, 120]].map(([p, a]) => h('button', { class: p === settings.prep && a === settings.answer ? 'on' : '', onclick: e => { settings.prep = p; settings.answer = a; [...e.target.parentNode.children].forEach(b => b.classList.remove('on')); e.target.classList.add('on'); startBtn.textContent = `Start (${p} s to prepare)`; } }, `${p}s / ${a / 60}′`)));
    box.append(qEl, h('div', { class: 'vr-stage' }, idle, vid, timer, status), h('div', { class: 'vr-ctrl' }, sel, noCam, startBtn));
    const rest = h('div', { class: 'vr-rest' }); box.append(rest);

    async function start() {
      startBtn.disabled = true;
      const useCam = !box.querySelector('#nocam').checked;
      if (!useCam && stream) { stream.getTracks().forEach(t => t.stop()); stream = null; vid.srcObject = null; }
      const idleEl = box.querySelector('.vr-idle'); if (idleEl) idleEl.remove();
      if (useCam && !stream) {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); vid.srcObject = stream; }
        catch (e) { status.textContent = 'Camera not available: using the timer only.'; }
      }
      phase = 'prep'; t0 = performance.now();
      status.textContent = 'Preparation: organise your answer (opening · 2-3 points · close)';
      clearInterval(tick);
      tick = setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        if (phase === 'prep') {
          timer.textContent = `Prepare ${Math.max(0, Math.ceil(settings.prep - el))}s`;
          if (el >= settings.prep) beginAnswer();
        } else if (phase === 'answer') {
          const left = settings.answer - el;
          timer.textContent = `${box.querySelector('#nocam')?.checked || !stream ? '⏱' : '● REC'} ${fmtTime(left * 1000)}`;
          timer.classList.toggle('warn', left < 20);
          if (left <= 0) stopRec();
        }
      }, 200);
      box.querySelector('.vr-ctrl').replaceChildren(stopBtn);
    }
    function beginAnswer() {
      phase = 'answer'; t0 = performance.now(); chunks = [];
      status.textContent = stream && !box.querySelector('#nocam').checked ? 'Recording: look at the camera' : 'Answer out loud: the timer is running';
      if (stream && window.MediaRecorder && !box.querySelector('#nocam').checked) {
        try { rec = new MediaRecorder(stream); rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.start(); } catch { rec = null; }
      }
    }
    function stopRec() {
      if (phase === 'prep') { beginAnswer(); return; }
      const dur = (performance.now() - t0) / 1000;
      phase = 'done'; clearInterval(tick); timer.textContent = `✓ ${fmtTime(dur * 1000)}`;
      const finishUI = () => review(dur);
      if (rec && rec.state !== 'inactive') { rec.onstop = finishUI; rec.stop(); } else finishUI();
    }
    function review(dur) {
      status.textContent = 'Watch it back and rate yourself honestly';
      box.querySelector('.vr-ctrl').replaceChildren();
      if (chunks.length) {
        const blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
        const url = URL.createObjectURL(blob);
        rest.append(h('div', { class: 'vr-play' }, h('video', { src: url, controls: true, class: 'vr-rec' }), h('a', { href: url, download: `risposta-${Date.now()}.webm`, class: 'btn ghost small' }, 'Download the video (it stays on your computer)')));
      }
      const crit = [['dir', 'Direct answer in the first sentence'], ['str', 'Clear structure (STAR or point, reasons, close)'], ['evi', 'Concrete example with numbers or facts'], ['fit', 'Link to the bank, the role and the team'], ['del', 'Delivery: pace, eye contact with the camera, no filler']];
      const scores = {};
      const timeOk = dur >= Math.min(45, settings.answer * 0.4) && dur <= settings.answer;
      const form = h('div', { class: 'rubric' }, h('div', { class: 'expl-h' }, `Self-assessment · length ${fmtTime(dur * 1000)} ${timeOk ? '✓' : '(aim for 60–120 s)'}`),
        crit.map(([k, t]) => h('div', { class: 'rub-row' }, h('span', {}, t), h('div', { class: 'seg small', role: 'group', 'aria-label': t }, [1, 2, 3, 4, 5].map(v => h('button', { 'aria-label': `${t}: ${v} su 5`, onclick: e => { scores[k] = v; [...e.target.parentNode.children].forEach(b => { b.classList.toggle('on', Number(b.textContent) <= v); b.setAttribute('aria-pressed', String(Number(b.textContent) === v)); }); const all = crit.every(([kk]) => scores[kk]); save.disabled = !all; missing.classList.toggle('hidden', all); } }, String(v)))))));
      const qx2 = list[i];
      const guide = qx2.structure ? h('details', { class: 'qcard' }, h('summary', {}, 'Compare with the suggested structure'), h('ol', {}, qx2.structure.map(s => h('li', {}, s))), qx2.skeleton ? h('p', { class: 'skeleton' }, qx2.skeleton) : '') : '';
      const missing = h('div', { class: 'muted small' }, 'Rate all 5 criteria to save.');
      const save = h('button', { class: 'btn primary', disabled: true, onclick: () => {
        const vals = crit.map(([k]) => scores[k] || 0);
        if (vals.some(v => !v)) return;
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        logAttempt({ id: `video:${qx2.id}`, skill: 'behavioural', level: 2, ok: avg >= 4, score: avg / 5, ms: dur * 1000, target: settings.answer, mode: 'video' });
        logSession({ kind: 'video', q: qx2.id, score: avg / 5, ms: dur * 1000 });
        if (i + 1 < list.length) { i++; draw(); } else { cleanup(); if (onDone) onDone(); else { box.innerHTML = ''; box.append(h('div', { class: 'cta' }, h('div', {}, h('div', { class: 'cta-t' }, 'Saved'), h('div', { class: 'muted' }, 'Redo the same question until every criterion is at least 4.')), h('button', { class: 'btn primary', onclick: () => { location.hash = `#/interviews/video?r=${Date.now()}`; } }, 'Another question'))); } }
      } }, i + 1 < list.length ? 'Save and next question' : 'Save');
      rest.append(form, guide, h('div', { class: 'row-end' }, missing, h('button', { class: 'btn ghost', onclick: () => { rest.innerHTML = ''; draw(); } }, 'Redo'), save));
    }
  };
  draw();
}
