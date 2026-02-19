'use strict';

/* ─── UTILS ─────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function isMac() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

/* ─── LIVE RUN ───────────────────────────────────────── */
function run() {
  var out = $('output');
  out.contentDocument.open();
  out.contentDocument.write(
    '<!DOCTYPE html><html><head><style>' + $('css-code').value +
    '</style></head><body>' + $('html-code').value +
    '<scr' + 'ipt>' + $('js-code').value + '<\/scr' + 'ipt></body></html>');
  out.contentDocument.close();
}

/* ─── TOAST ─────────────────────────────────────────── */
function showToast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
}

/* ─── FULLSCREEN ─────────────────────────────────────── */
function openFS() {
  var fr = $('fs-frame'); $('fs-overlay').classList.add('active');
  fr.contentDocument.open();
  fr.contentDocument.write(
    '<!DOCTYPE html><html><head><style>' + $('css-code').value +
    '</style></head><body>' + $('html-code').value +
    '<scr' + 'ipt>' + $('js-code').value + '<\/scr' + 'ipt></body></html>');
  fr.contentDocument.close();
}
function closeFS() { $('fs-overlay').classList.remove('active'); }

/* ─── MOBILE TABS ────────────────────────────────────── */
function switchTab(tab) {
  ['html', 'css', 'js'].forEach(function (id) {
    $('block-' + id).classList.toggle('active', tab === id);
  });
  $('output-col').classList.toggle('active', tab === 'out');
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active-tab', b.dataset.tab === tab);
  });
}

/* ═══════════════════════════════════════════════════════
   HISTORY MANAGER  — the ONLY source of truth for undo/redo
   ───────────────────────────────────────────────────────
   Design decisions that make this work correctly:

   1. We NEVER use execCommand('insertText') — it creates a
      parallel native undo stack that fights our custom one.
      All mutations use  ta.value = newString  directly.

   2. We NEVER use execCommand('undo'/'redo').

   3. Each textarea has TWO stacks:
        past[]   — states we can undo back to
        future[] — states we can redo forward to

   4. Snapshot structure: { v: string, ss: number, se: number }
        v  = full textarea value
        ss = selectionStart
        se = selectionEnd

   5. saveSnap(taId):
        • Pushes current state onto past[]
        • Does NOT touch future[] — saving does NOT clear redo!

   6. setValue(taId, val, ss, se):
        • Directly assigns ta.value
        • Restores cursor
        • Sets a suppression flag so the input event doesn't
          accidentally push a duplicate snapshot

   7. doUndo / doRedo:
        • Push current state to the OTHER stack before switching
        • Pop from own stack and restore
═══════════════════════════════════════════════════════ */

var H = {};   /* H[taId] = { past:[], future:[], suppress:false } */
['html-code', 'css-code', 'js-code'].forEach(function (id) {
  H[id] = { past: [], future: [], suppress: false };
});

/* Save snapshot of current state onto past[] */
function saveSnap(taId) {
  var ta = $(taId);
  var h = H[taId];
  if (h.suppress) return;
  var snap = { v: ta.value, ss: ta.selectionStart, se: ta.selectionEnd };
  if (h.past.length > 0) {
    var last = h.past[h.past.length - 1];
    if (last.v === snap.v) return;
  }
  h.past.push(snap);
  if (h.past.length > 300) h.past.shift();
}

/* Restore a value into the textarea without triggering saveSnap */
function setValue(taId, snap) {
  var ta = $(taId);
  var h = H[taId];
  h.suppress = true;
  ta.value = snap.v;
  try { ta.setSelectionRange(snap.ss, snap.se); } catch (e) { }
  h.suppress = false;
}

/* Capture current state as a snapshot object (without saving it) */
function currentSnap(taId) {
  var ta = $(taId);
  return { v: ta.value, ss: ta.selectionStart, se: ta.selectionEnd };
}

/* ─── UNDO ───────────────────────────────────────────── */
function doUndo(taId) {
  var h = H[taId];
  if (!h.past.length) {
    showToast('Nothing more to undo');
    flashId('undo-' + taId.replace('-code', ''));
    return;
  }
  h.future.push(currentSnap(taId));
  setValue(taId, h.past.pop());
  run();
  flashId('undo-' + taId.replace('-code', ''));
}

/* ─── REDO ───────────────────────────────────────────── */
function doRedo(taId) {
  var h = H[taId];
  if (!h.future.length) {
    showToast('Nothing more to redo');
    flashId('redo-' + taId.replace('-code', ''));
    return;
  }
  h.past.push(currentSnap(taId));
  setValue(taId, h.future.pop());
  run();
  flashId('redo-' + taId.replace('-code', ''));
}

/* ─── COPY ───────────────────────────────────────────── */
function doCopy(taId) {
  var ta = $(taId), txt = ta.value;
  if (!txt.trim()) { showToast('⚠️  Nothing to copy!'); return; }
  var btnId = 'copy-' + taId.replace('-code', '');
  function ok() { showToast('✅  Copied!'); flashId(btnId); }
  function fail() { showToast('⚠️  Copy failed — use Ctrl+C / ⌘C'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(ok).catch(function () {
      ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { fail(); }
    });
  } else {
    ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { fail(); }
  }
}

/* Flash a button by id */
function flashId(id) {
  var el = $(id); if (!el) return;
  el.classList.add('flash');
  clearTimeout(el._ft);
  el._ft = setTimeout(function () { el.classList.remove('flash'); }, 700);
}

/* ─── PER-CHARACTER UNDO (MS Word style) ─────────────── */
/* We intercept keydown BEFORE the browser inserts the char,
   save the pre-keystroke snapshot, then the input event just
   clears the redo stack. This gives one undo step per char,
   just like MS Word / VS Code.                              */
var _snapTimers = {};

/* Called from the input event handler */
function scheduleSnap(taId) {
  /* Clear redo stack — new typing kills forward history */
  H[taId].future = [];
  /* The actual snapshot was already saved in the keydown
     handler below, BEFORE the character was inserted.    */
}

/* Save snapshot BEFORE character insertion */
function _attachCharSnap(ta) {
  ta.addEventListener('keydown', function (e) {
    var mod = isMac() ? e.metaKey : e.ctrlKey;
    if (mod) return;
    if (e.altKey) return;
    var k = e.key;
    var isPrintable = (k.length === 1);
    var isDelete = (k === 'Delete' || k === 'Backspace');
    if (!isPrintable && !isDelete) return;
    if (k === 'Tab' || k === 'Enter') return;
    if ('([{\'"`.'.indexOf(k) !== -1) return;
    if (!H[ta.id].suppress) saveSnap(ta.id);
  }, true);
}

/* ─── GLOBAL KEYBOARD SHORTCUTS ─────────────────────── */
document.addEventListener('keydown', function (e) {
  var mod = isMac() ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  var focus = document.activeElement;
  var taId = (focus && focus.tagName === 'TEXTAREA') ? focus.id : null;
  var key = e.key.toLowerCase();

  if (key === 'z' && !e.shiftKey) {
    if (taId) { e.preventDefault(); doUndo(taId); }
    return;
  }
  if (key === 'y' || (key === 'z' && e.shiftKey)) {
    if (taId) { e.preventDefault(); doRedo(taId); }
    return;
  }
  if (key === 'c') {
    if (taId) { flashId('copy-' + taId.replace('-code', '')); }
  }
});

/* ═══════════════════════════════════════════════════════
   MUTATE HELPER
   ─────────────────────────────────────────────────────
   ALL programmatic text insertions go through here.
═══════════════════════════════════════════════════════ */
function mutate(ta, selStart, selEnd, text, newCursor) {
  var h = H[ta.id];
  saveSnap(ta.id);
  h.future = [];
  clearTimeout(_snapTimers[ta.id]);
  h.suppress = true;
  var v = ta.value;
  ta.value = v.slice(0, selStart) + text + v.slice(selEnd);
  var cur = (newCursor !== undefined) ? newCursor : (selStart + text.length);
  try { ta.setSelectionRange(cur, cur); } catch (e) { }
  h.suppress = false;
}

/* ═══════════════════════════════════════════════════════
   SMART KEY HANDLER
═══════════════════════════════════════════════════════ */
var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
var CLOSERS = { ')': 1, ']': 1, '}': 1, '"': 1, "'": 1, '`': 1 };
var BLOCK_OPENERS = { '(': ')', '[': ']', '{': '}' };

function keyHandler(e) {
  var ta = e.target;
  var key = e.key;
  var mod = isMac() ? e.metaKey : e.ctrlKey;
  if (mod) return;

  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  var val = ta.value;

  /* 1. Skip over existing closing char */
  if (CLOSERS[key] && start === end && val[start] === key) {
    e.preventDefault();
    ta.setSelectionRange(start + 1, start + 1);
    return;
  }

  /* 2. Auto-close bracket/quote */
  if (PAIRS[key]) {
    e.preventDefault();
    var sel = val.slice(start, end);
    mutate(ta, start, end, key + sel + PAIRS[key], start + 1);
    run();
    return;
  }

  /* 3. Enter — smart indent for ALL bracket types */
  if (key === 'Enter') {
    e.preventDefault();
    var before = val.slice(0, start);
    var after = val.slice(end);
    var lines = before.split('\n');
    var curLine = lines[lines.length - 1];
    var baseIndent = curLine.match(/^(\s*)/)[1];
    var lastChar = curLine.trimEnd().slice(-1);
    var firstAfter = after.charAt(0);
    var isExpand = BLOCK_OPENERS[lastChar] && firstAfter === BLOCK_OPENERS[lastChar];

    if (isExpand) {
      var inner = baseIndent + '  ';
      var ins = '\n' + inner + '\n' + baseIndent;
      mutate(ta, start, end, ins, start + 1 + inner.length);
    } else {
      var extra = BLOCK_OPENERS[lastChar] ? '  ' : '';
      var nl = '\n' + baseIndent + extra;
      mutate(ta, start, end, nl, start + nl.length);
    }
    run();
    return;
  }

  /* 4. Tab → 2 spaces */
  if (key === 'Tab') {
    e.preventDefault();
    mutate(ta, start, end, '  ', start + 2);
    run();
  }
}

/* ─── HTML TAG AUTO-COMPLETE ─────────────────────────── */
var VOID_TAGS = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1,
  input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
};

$('html-code').addEventListener('keydown', function (e) {
  if (e.key !== '>') return;
  var ta = this, start = ta.selectionStart;
  var before = ta.value.slice(0, start);
  var match = before.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<]*)?\s*$/);
  if (!match) return;
  var tag = match[1].toLowerCase();
  if (VOID_TAGS[tag] || before.trimEnd().endsWith('/')) return;
  setTimeout(function () {
    var curVal = ta.value, curPos = ta.selectionStart;
    var closing = '</' + tag + '>';
    if (curVal.slice(curPos, curPos + closing.length) === closing) return;
    saveSnap('html-code');
    H['html-code'].future = [];
    H['html-code'].suppress = true;
    ta.value = curVal.slice(0, curPos) + closing + curVal.slice(curPos);
    try { ta.setSelectionRange(curPos, curPos); } catch (er) { }
    H['html-code'].suppress = false;
    run();
  }, 0);
});

/* ─── WIRE UP ────────────────────────────────────────── */
document.querySelectorAll('textarea').forEach(function (ta) {
  ta.addEventListener('keydown', keyHandler);
  ta.addEventListener('input', function () {
    if (!H[ta.id].suppress) scheduleSnap(ta.id);
    run();
  });
  _attachCharSnap(ta);
});

/* ─── DOWNLOAD ZIP ───────────────────────────────────── */
function downloadZip() {
  var html = $('html-code').value.trim();
  var css = $('css-code').value.trim();
  var js = $('js-code').value.trim();
  if (!html && !css && !js) { showToast('✏️  Nothing to download! Write some code first.'); return; }
  var full = ['<!DOCTYPE html>', '<html lang="en">', '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width,initial-scale=1.0" />',
    '  <title>My Project</title>',
    '  <link rel="stylesheet" href="style.css" />',
    '</head>', '<body>', html,
    '<script src="script.js"><\/script>', '</body>', '</html>'].join('\n');
  var files = [
    { name: 'index.html', data: enc(full) },
    { name: 'style.css', data: enc(css || '/* styles */') },
    { name: 'script.js', data: enc(js || '// scripts') }
  ];
  var blob = new Blob([buildZip(files)], { type: 'application/zip' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'codeforge-project.zip';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  showToast('✅  ZIP downloaded!');
}
function enc(s) { return new TextEncoder().encode(s); }
function buildZip(files) {
  var lP = [], cP = [], off = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i], nb = enc(f.name), d = f.data, cr = crc32(d), mod = dosDate();
    var lh = new Uint8Array(30 + nb.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); lv.setUint32(10, mod, true); lv.setUint32(14, cr, true);
    lv.setUint32(18, d.length, true); lv.setUint32(22, d.length, true);
    lv.setUint16(26, nb.length, true); lv.setUint16(28, 0, true); lh.set(nb, 30); lP.push(lh, d);
    var cd = new Uint8Array(46 + nb.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint32(12, mod, true);
    cv.setUint32(16, cr, true); cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
    cv.setUint32(42, off, true); cd.set(nb, 46); cP.push(cd);
    off += 30 + nb.length + d.length;
  }
  var cdO = off, cdS = cP.reduce(function (s, p) { return s + p.length; }, 0);
  var eo = new Uint8Array(22), ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdS, true); ev.setUint32(16, cdO, true); ev.setUint16(20, 0, true);
  var all = lP.concat(cP).concat([eo]), tot = all.reduce(function (s, p) { return s + p.length; }, 0);
  var res = new Uint8Array(tot), pos = 0;
  all.forEach(function (p) { res.set(p, pos); pos += p.length; });
  return res;
}
function crc32(b) {
  var t = new Uint32Array(256);
  for (var i = 0; i < 256; i++) { var c = i; for (var j = 0; j < 8; j++)c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < b.length; i++)crc = t[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dosDate() {
  var d = new Date();
  var dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  var tm = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return ((dt << 16) | tm) >>> 0;
}

run();
