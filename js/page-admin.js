// 管理画面（admin.html の #app に描く）。運営だけが使う。合言葉は sessionStorage にだけ入れる（URL・画面のHTML・コンソールには出さない）
(function (root) {
  'use strict';

  // ---- DOMを使わない部分（テストあり）----

  function nfkc(s) { return String(s == null ? '' : s).normalize('NFKC').trim(); }

  // 一覧の DUPR 表示：「3.45」「仮 3.00」「なし」
  function formatDupr(p) {
    function num(n) {
      var s = String(n);
      if (!/^\d+(\.\d+)?$/.test(s)) return s;
      var frac = s.split('.')[1];
      return frac && frac.length >= 2 ? s : n.toFixed(2);
    }
    if (p && typeof p.dupr === 'number') return num(p.dupr);
    if (p && typeof p.provisionalDupr === 'number') return '仮 ' + num(p.provisionalDupr);
    return 'なし';
  }

  // 仮DUPRを入れられるのは、DUPR が無い（null）人だけ。入れられる枠（1＝代表、2＝ペア）を返す
  function provisionalSlots(entry) {
    var slots = [];
    if (entry && entry.p1 && entry.p1.dupr == null) slots.push(1);
    if (entry && entry.p2 && entry.p2.dupr == null) slots.push(2);
    return slots;
  }

  function parseCapacity(text) {
    var t = nfkc(text);
    if (/^\d{1,4}$/.test(t)) return { value: parseInt(t, 10), error: '' };
    return { value: null, error: '定員は0以上の整数で入力してください。' };
  }

  function parseProvisional(text) {
    var t = nfkc(text), n = /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
    if (t.length <= 20 && n > 0 && n < 10) return { value: n, error: '' };
    return { value: null, error: '仮DUPRは0より大きく10未満の数字で入力してください。' };
  }

  // お知らせの入力確認（サーバーと同じ範囲）。errors: [{field, message}]
  function validateNotice(title, body) {
    var t = String(title == null ? '' : title).trim(), b = String(body == null ? '' : body).trim(), errors = [];
    if (t.length < 1) errors.push({ field: 'title', message: 'タイトルを入力してください。' });
    else if (t.length > 100) errors.push({ field: 'title', message: 'タイトルは100文字以内で入力してください。' });
    if (b.length < 1) errors.push({ field: 'body', message: '本文を入力してください。' });
    else if (b.length > 5000) errors.push({ field: 'body', message: '本文は5000文字以内で入力してください。' });
    return { title: t, body: b, errors: errors };
  }

  function intIn(text, min, max) {
    var t = nfkc(text);
    if (!/^\d{1,4}$/.test(t)) return null;
    var n = parseInt(t, 10);
    return n >= min && n <= max ? n : null;
  }
  function timeOf(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(nfkc(text));
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2];
  }

  // 試算の入力確認。raw は画面の文字のまま：
  //   { courts, slotMinutes, sessions: [{ name, start, categories: [{ name, pairs }] }] }
  // 戻り値：{ input（Rules.estimate に渡せる形。errors があるときは使わない）, errors: [{field, message}] }
  //   field は 'courts' 'slotMinutes' 's0.start' 's0.c1.pairs' の形
  var LIMITS = { courts: [1, 50], slot: [5, 120], pairs: [0, 200] };
  function validateEstimate(raw) {
    var errors = [], input = { courts: 0, slotMinutes: 0, sessions: [] };
    var c = intIn(raw && raw.courts, LIMITS.courts[0], LIMITS.courts[1]);
    if (c === null) errors.push({ field: 'courts', message: 'コート数は' + LIMITS.courts[0] + '〜' + LIMITS.courts[1] + 'の整数で入力してください。' });
    else input.courts = c;
    var m = intIn(raw && raw.slotMinutes, LIMITS.slot[0], LIMITS.slot[1]);
    if (m === null) errors.push({ field: 'slotMinutes', message: '1試合の時間枠は' + LIMITS.slot[0] + '〜' + LIMITS.slot[1] + '分の整数で入力してください。' });
    else input.slotMinutes = m;
    ((raw && raw.sessions) || []).forEach(function (s, i) {
      var start = timeOf(s.start);
      if (start === null) errors.push({ field: 's' + i + '.start', message: '開始時刻は「09:30」のように、時:分で入力してください。' });
      var cats = [];
      (s.categories || []).forEach(function (cat, j) {
        var n = intIn(cat.pairs, LIMITS.pairs[0], LIMITS.pairs[1]);
        if (n === null) errors.push({ field: 's' + i + '.c' + j + '.pairs', message: '組数は' + LIMITS.pairs[0] + '〜' + LIMITS.pairs[1] + 'の整数で入力してください。' });
        else cats.push({ name: cat.name, pairs: n });
      });
      input.sessions.push({ name: s.name, start: start || '', categories: cats });
    });
    if (!input.sessions.length) errors.push({ field: '', message: '試算するカテゴリがありません。' });
    return { input: input, errors: errors };
  }

  function statusCounts(entries) {
    var c = { '確定': 0, 'キャンセル待ち': 0, 'キャンセル': 0, '取消（他で確定）': 0 };
    (entries || []).forEach(function (e) { if (Object.prototype.hasOwnProperty.call(c, e.status)) c[e.status]++; });
    return c;
  }

  // '2027-02-01T21:00:00+09:00' → '2/1 21:00'
  function shortDate(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? (+m[1]) + '/' + (+m[2]) + ' ' + m[3] + ':' + m[4] : '';
  }

  // ログアウトさせる（合言葉・名前が通らない）コード。business の 'locked'（組み合わせ確定済み）は含めない
  var AUTH_CODES = ['badPass', 'authLocked', 'notConfigured', 'actorRequired'];
  function isAuthCode(code) { return AUTH_CODES.indexOf(code) >= 0; }

  root.AdminLogic = {
    isAuthCode: isAuthCode,
    formatDupr: formatDupr, provisionalSlots: provisionalSlots, parseCapacity: parseCapacity, parseProvisional: parseProvisional,
    validateNotice: validateNotice, validateEstimate: validateEstimate, statusCounts: statusCounts, shortDate: shortDate
  };
  if (!root.document) return;   // テスト用（node）

  // ---- 画面 ----
  var CFG = root.CONFIG || {};
  var PF = root.PersonFields;
  var doc = root.document;
  var app = doc.getElementById('app');
  var BUSY_TEXT = '混雑しています。そのままお待ちください（入力し直しは不要です）';
  var KEY_PASS = 'moa.admin.pass', KEY_ACTOR = 'moa.admin.actor';
  var NET_MSG = '届いたか分かりません。一覧（とお知らせ）で確かめてから、必要ならもう一度操作してください';
  var WRITE_OPS = ['cancel', 'setCapacity', 'changeMember', 'setProvisionalDupr', 'sendNotice'];

  var api = null;
  var cred = null;          // { pass, actor }。メモリの中だけ（保存先は sessionStorage のみ）
  var state = null;         // list の返事
  var curCat = '';
  var sending = false;
  var dlgOpener = null, dlgOnClose = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }

  // sessionStorage は使えない端末がある。読み書きは必ず try/catch（使えなければ毎回入力）
  function stGet(k) { try { return root.sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function stSet(k, v) { try { root.sessionStorage.setItem(k, v); } catch (e) { /* 保存できない端末 */ } }
  function stDel(k) { try { root.sessionStorage.removeItem(k); } catch (e) { /* 無視 */ } }

  // ---- 通信 ----
  // 送信中は、画面のボタンをすべて押せなくする（二重送信を防ぐ）。戻り値は必ず返事のオブジェクト
  function lock(on) {
    doc.querySelectorAll('#app button').forEach(function (b) {
      if (on) { b.dataset.was = b.disabled ? '1' : '0'; b.disabled = true; }
      else if (b.dataset.was !== undefined) { b.disabled = b.dataset.was === '1'; delete b.dataset.was; }
    });
  }
  function call(op, args) {
    if (sending) return Promise.resolve({ ok: false, skipped: true, message: '送信中です。少しお待ちください。' });
    sending = true; lock(true);
    var body = { action: 'admin', pass: cred.pass, actor: cred.actor, op: op, args: args || {} };
    function done(res) {
      sending = false; lock(false); $('#busy').hidden = true;
      if (res && res.ok === false && root.AdminLogic.isAuthCode(res.code)) {
        logout(res.message || '認証できませんでした。');
        return { ok: false, auth: true, message: res.message };
      }
      return res && typeof res === 'object' ? res : { ok: false, message: 'サーバーの返事を読めませんでした。' };
    }
    var write = WRITE_OPS.indexOf(op) >= 0;
    return api.post(body, { retryOnNetworkError: !write, onRetry: function () { $('#busy').hidden = false; } }).then(done, function (err) {
      if (write && err && err.code === 'network') {
        // 届いたか分からない：自動では送り直さず、一覧を取り直して確かめてもらう
        var r = done({ ok: false, auth: true, netUnknown: true, message: NET_MSG });   // auth:true＝呼び出し側は何も表示しなくてよい
        closeDialog(true);
        setNote(false, NET_MSG);
        fetchList().then(function (l) { if (l.ok) { render(); setNote(false, NET_MSG); } });
        return r;
      }
      return done({ ok: false, message: err && err.message ? err.message : '通信できませんでした。もう一度お試しください。' });
    });
  }

  // ---- ログイン・ログアウト ----
  function logout(message) {
    cred = null; state = null;
    stDel(KEY_PASS);              // 合言葉は消す（名前は残す）
    closeDialog(true);
    showLogin(message || '');
  }

  function showLogin(message) {
    app.innerHTML =
      '<section class="frame" id="v-login" style="max-width:520px;margin-left:auto;margin-right:auto"><h1>管理画面</h1>' +
      '<p class="muted">運営だけが使います。合言葉と、操作の記録に残す名前を入力してください。</p>' +
      '<form id="login-form" novalidate>' +
      '<div class="field"><label for="a-pass">合言葉<span class="req">必須</span></label><input type="password" id="a-pass" data-k="pass" autocomplete="off"><p class="err" data-err="pass"></p></div>' +
      '<div class="field"><label for="a-actor">あなたの名前<span class="req">必須</span></label><input type="text" id="a-actor" data-k="actor" maxlength="20" autocomplete="off"><p class="hint">操作の記録に残ります（20文字まで）。</p><p class="err" data-err="actor"></p></div>' +
      '<div class="alert" id="login-alert" role="alert"></div>' +
      '<button class="btn" type="submit" id="login-btn">ログイン</button></form></section>' + shell();
    $('#login-alert').textContent = message;
    $('#a-actor').value = stGet(KEY_ACTOR);
    $('#login-form').addEventListener('submit', onLogin);
    clearOnInput($('#login-form'));
    ($('#a-actor').value ? $('#a-pass') : $('#a-actor')).focus();
  }

  function onLogin(ev) {
    ev.preventDefault();
    if (sending) return;
    var form = $('#login-form'), pass = $('#a-pass').value, actor = $('#a-actor').value.trim(), errors = [];
    PF.clearAll(form, $('#login-alert'));
    if (!pass) errors.push({ field: 'pass', message: '合言葉を入力してください。' });
    if (actor.length < 1 || actor.length > 20) errors.push({ field: 'actor', message: '名前は1〜20文字で入力してください。' });
    if (errors.length) { keyErrors(form, errors, $('#login-alert')); return; }
    cred = { pass: pass, actor: actor };
    stSet(KEY_ACTOR, actor);      // 名前は秘密ではない。合言葉をまちがえたときに入力し直さなくてよいように
    $('#a-pass').value = '';
    fetchList().then(function (res) {
      if (res.auth) return;     // logout() が画面を作り直し済み
      if (!res.ok) { cred = null; showLogin(res.message || '読み込めませんでした。'); return; }
      stSet(KEY_PASS, pass);
      buildMain();
      render();
    });
  }

  // ---- 共通の入力欄まわり（data-k と data-err を対応させる）----
  function keyErrors(scope, errors, alertEl) {
    PF.showErrors(scope, errors, alertEl, function (field) {
      var el = field ? $('[data-k="' + field + '"]', scope) : null;
      return el ? [el] : null;
    });
  }
  function clearOnInput(scope) {
    scope.addEventListener('input', function (ev) {
      var el = ev.target;
      if (el.getAttribute('data-p')) { PF.clearErr(scope, el); return; }
      el.classList.remove('invalid');
      var slot = el.getAttribute('data-k') && $('[data-err="' + el.getAttribute('data-k') + '"]', scope);
      if (slot) slot.textContent = '';
    });
  }

  // ---- 全体の組み立て ----
  function shell() {
    return '<div class="overlay" id="busy" hidden role="status"><div class="dialog"><div class="spin"></div>' +
      '<p style="font-weight:700;font-size:18px;margin:0">' + BUSY_TEXT + '</p>' +
      '<p class="muted">画面を閉じたり、もう一度ボタンを押したりしなくて大丈夫です。</p></div></div>';
  }

  function buildMain() {
    app.innerHTML =
      '<section class="frame" id="s-head"><div class="head-row"><div><h1>管理画面</h1><p class="muted" id="who"></p></div>' +
      '<button class="btn sub mini" type="button" id="logout">ログアウト</button></div><div id="note" role="status"></div></section>' +
      '<section class="frame" id="s-list"></section>' +
      '<section class="frame" id="s-notice"></section>' +
      '<section class="frame" id="s-est"></section>' +
      '<div id="dlg"></div>' + shell();
    $('#who').textContent = '操作する人：' + cred.actor + '（操作の記録に残ります）';
    $('#logout').addEventListener('click', function () { if (!sending) logout(''); });
    $('#s-list').addEventListener('click', onListClick);
    clearOnInput($('#s-list'));
    $('#s-list').addEventListener('change', function (ev) {
      if (ev.target.id === 'acat') { curCat = ev.target.value; renderList(); }
    });
    buildNotice();
    buildEstimate();
  }

  function fetchList() {
    return call('list').then(function (res) {
      if (res.ok) {
        state = { tournament: res.tournament, categories: (res.categories || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }), entries: res.entries || [], notices: res.notices || [] };
        if (!findCat(curCat)) curCat = state.categories.length ? state.categories[0].id : '';
      }
      return res;
    });
  }

  function setNote(ok, text) {
    var n = $('#note');
    if (!n) return;
    n.innerHTML = text ? '<div class="' + (ok ? 'banner open' : 'alert') + '" style="margin-top:12px">' + esc(text) + '</div>' : '';
    if (text) root.scrollTo(0, 0);
  }

  // 操作のあとは一覧を取り直す。ok のときだけ成功の知らせを出す
  function afterWrite(okText) {
    setNote(true, okText);
    return fetchList().then(function (res) {
      if (res.auth) return;
      if (res.ok) render();
      else setNote(false, okText + '（一覧を読み込み直せませんでした：' + (res.message || '通信エラー') + '）');
    });
  }

  function findCat(id) {
    if (!state) return null;
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i];
    return null;
  }
  function findEntry(no) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].no === no) return state.entries[i];
    return null;
  }

  function render() { renderList(); renderPastNotices(); }

  // ---- 申し込み一覧 ----
  function catEntries(id) { return state.entries.filter(function (e) { return e.categoryId === id; }); }
  function catLabel(c) {
    var n = root.AdminLogic.statusCounts(catEntries(c.id));
    return { main: c.name, small: '確定' + n['確定'] + '／' + c.capacity + '・待ち' + n['キャンセル待ち'] };
  }
  function chip(status) {
    var cls = status === '確定' ? 'ok' : status === 'キャンセル待ち' ? 'wait' : 'gray';
    return '<span class="chip ' + cls + '">' + esc(status) + '</span>';
  }

  function rowHtml(e) {
    var L = root.AdminLogic, active = e.status === '確定' || e.status === 'キャンセル待ち';
    var c1 = e.p1.club || '', c2 = e.p2.club || '';
    var ops = '<button class="btn sub mini" type="button" data-op="detail" data-no="' + esc(e.no) + '">詳細・操作</button>';
    return '<tr' + (active ? '' : ' class="cancelled"') + '><td>' + esc(e.no) + '</td><td>' + chip(e.status) + '</td><td>' + esc(e.position == null ? '-' : e.position) + '</td>' +
      '<td class="wrapok">' + esc(e.p1.name) + '</td><td class="wrapok">' + esc(e.p2.name) + '</td>' +
      '<td class="wrapok">' + esc(c1) + (c2 && c2 !== c1 ? ' / ' + esc(c2) : '') + '</td>' +
      '<td class="wrapok">' + esc(L.formatDupr(e.p1)) + ' / ' + esc(L.formatDupr(e.p2)) + '</td><td class="wrapok">' + esc(L.shortDate(e.createdAt)) + '</td><td>' + ops + '</td></tr>';
  }

  function renderList() {
    var L = root.AdminLogic, cats = state.categories, cur = findCat(curCat), box = $('#s-list');
    if (!cur) { box.innerHTML = '<h2>申し込み一覧</h2><p class="muted">カテゴリがありません。</p>'; return; }
    var rows = catEntries(cur.id), n = L.statusCounts(rows);
    // 状態の順（確定・キャンセル待ち・それ以外）、同じ状態では受付番号の順
    var rank = { '確定': 0, 'キャンセル待ち': 1 };
    rows = rows.slice().sort(function (a, b) {
      var ra = rank[a.status] == null ? 2 : rank[a.status], rb = rank[b.status] == null ? 2 : rank[b.status];
      return ra - rb || a.no - b.no;
    });
    box.innerHTML =
      '<h2 style="margin-top:0">申し込み一覧</h2><p class="muted">DUPR が空の人は「仮DUPR」（運営が仮で入れた値）を表示します。DUPRも仮DUPRも無い人は「なし」です。</p>' +
      '<div class="field only-sp"><label for="acat">カテゴリ</label><select id="acat">' + cats.map(function (c) {
        var l = catLabel(c);
        return '<option value="' + esc(c.id) + '"' + (c.id === cur.id ? ' selected' : '') + '>' + esc(l.main + '（' + l.small + '）') + '</option>';
      }).join('') + '</select></div>' +
      '<nav class="tabs only-pc" aria-label="カテゴリ">' + cats.map(function (c) {
        var l = catLabel(c);
        return '<button type="button" class="tab' + (c.id === cur.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '"' + (c.id === cur.id ? ' aria-current="page"' : '') + '>' + esc(l.main) + '<small>' + esc(l.small) + '</small></button>';
      }).join('') + '</nav>' +
      '<div class="admin-stat"><span class="chip ok">確定 ' + n['確定'] + '</span><span class="chip wait">キャンセル待ち ' + n['キャンセル待ち'] + '</span><span class="chip gray">キャンセル ' + n['キャンセル'] + '</span>' +
      (n['取消（他で確定）'] ? '<span class="chip gray">取消（他で確定） ' + n['取消（他で確定）'] + '</span>' : '') + '</div>' +
      '<h3>' + esc(cur.name) + '（' + esc(cur.session) + '・定員' + esc(cur.capacity) + '）</h3>' +
      '<div class="cap-row"><div class="field"><label for="cap">定員（組）</label><input type="text" id="cap" inputmode="numeric" data-k="cap" autocomplete="off" value="' + esc(cur.capacity) + '"></div>' +
      '<button class="btn sub" type="button" id="cap-save">定員を保存</button></div><p class="err" data-err="cap" id="cap-err" role="alert"></p>' +
      '<div class="tablewrap"><table class="atable"><thead><tr><th>受付番号</th><th>状態</th><th>待ち順</th><th>代表</th><th>ペア</th><th>所属</th><th>DUPR（代表 / ペア）</th><th>受付日時</th><th>操作</th></tr></thead><tbody>' +
      (rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="9" style="white-space:normal">このカテゴリの申し込みはまだありません。</td></tr>') +
      '</tbody></table></div>' +
      '<p class="muted"><span class="only-sp">表は横にスクロールできます。</span></p>';
  }

  function onListClick(ev) {
    var t = ev.target.closest('button');
    if (!t || sending) return;
    if (t.getAttribute('data-cat')) { curCat = t.getAttribute('data-cat'); renderList(); return; }
    if (t.id === 'cap-save') { saveCapacity(); return; }
    var no = +t.getAttribute('data-no'), op = t.getAttribute('data-op'), e = no ? findEntry(no) : null;
    if (!e) return;
    if (op === 'detail') detailDialog(e, t);
  }

  // ---- 詳細（個人情報を含む）と操作 ----
  function personBlock(title, p) {
    var L = root.AdminLogic;
    function row(k, v) { return '<dt>' + k + '</dt><dd>' + (v === '' || v == null ? '<span class="muted">（なし）</span>' : esc(v)) + '</dd>'; }
    return '<h3>' + title + '</h3><dl class="sum">' + row('氏名', p.name) + row('フリガナ', p.kana) + row('電話', p.phone) + row('メール', p.email) +
      row('生年月日', p.birth) + row('所属', p.club) + row('DUPR', p.dupr == null ? '' : L.formatDupr({ dupr: p.dupr })) + row('仮DUPR', p.provisionalDupr == null ? '' : L.formatDupr({ dupr: null, provisionalDupr: p.provisionalDupr }).replace('仮 ', '')) + row('DUPR ID', p.duprId) + '</dl>';
  }
  function detailDialog(e, opener) {
    var active = e.status === '確定' || e.status === 'キャンセル待ち', cat = findCat(e.categoryId);
    var ops = active
      ? '<div class="btn-row"><button class="btn danger" type="button" data-dop="cancel">キャンセル</button><button class="btn sub" type="button" data-dop="member">メンバー変更</button>' +
        (root.AdminLogic.provisionalSlots(e).length ? '<button class="btn sub" type="button" data-dop="prov">仮DUPR</button>' : '') + '</div>'
      : '<p class="muted">この申し込みは「' + esc(e.status) + '」のため、操作はできません。</p>';
    var dlg = openDialog('<h2 id="dlg-t">受付番号 ' + esc(e.no) + '</h2><p>' + chip(e.status) + (e.position != null ? ' ' + esc(e.position) + '番目' : '') + '　' + esc(cat ? cat.name : '') + '　受付 ' + esc(root.AdminLogic.shortDate(e.createdAt)) + '</p>' +
      '<div class="fgrid">' + '<div>' + personBlock('代表', e.p1) + '</div><div>' + personBlock('ペア', e.p2) + '</div></div>' + ops +
      '<div class="btn-row"><button class="btn sub" type="button" id="dt-close">閉じる</button></div>', opener, true);
    $('#dt-close', dlg).addEventListener('click', function () { if (!sending) closeDialog(); });
    dlg.querySelectorAll('[data-dop]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (sending) return;
        var op = b.getAttribute('data-dop');
        if (op === 'cancel') askCancel(e, opener); else if (op === 'member') memberDialog(e, opener); else provDialog(e, opener);
      });
    });
  }

  // ---- ダイアログ ----
  function closeDialog(silent) {
    var d = $('#dlg');
    if (d) d.innerHTML = '';
    var op = dlgOpener; dlgOpener = null; dlgOnClose = null;
    if (!silent && op && op.focus && doc.body.contains(op)) op.focus();
  }
  function openDialog(html, opener, wide) {
    dlgOpener = opener || null;
    $('#dlg').innerHTML = '<div class="overlay"><div class="dialog' + (wide ? ' form' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t" tabindex="-1">' + html + '</div></div>';
    var dlg = $('#dlg .dialog');
    dlg.focus();
    return dlg;
  }
  doc.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !sending && $('#dlg') && $('#dlg').firstChild) closeDialog();
  });

  // 確認ダイアログ。onOk は押したあとの処理（通信）を返す
  function confirmDialog(o) {
    var dlg = openDialog('<p id="dlg-t" style="font-weight:700;font-size:18px;margin:0 0 4px">' + esc(o.title) + '</p>' + o.bodyHtml +
      '<div class="alert" id="dlg-alert" role="alert"></div>' +
      '<div class="btn-row"><button class="btn sub" type="button" id="dlg-no">やめる</button><button class="btn" type="button" id="dlg-ok"' + (o.danger ? ' style="background:var(--ng)"' : '') + '>' + esc(o.okLabel) + '</button></div>', o.opener, o.wide);
    $('#dlg-no', dlg).addEventListener('click', function () { if (!sending) closeDialog(); });
    $('#dlg-ok', dlg).addEventListener('click', function () { if (!sending) o.onOk(); });
  }

  // ---- キャンセル ----
  function askCancel(e, opener) {
    confirmDialog({
      title: '受付番号 ' + e.no + ' をキャンセルしますか？', opener: opener, okLabel: 'キャンセルする', danger: true,
      bodyHtml: '<p>' + esc(e.p1.name) + ' ／ ' + esc(e.p2.name) + '</p><p class="muted">キャンセルすると元に戻せません。確定の人だった場合は、キャンセル待ちの先頭の人が繰り上がり、メールが送られます。</p>',
      onOk: function () {
        call('cancel', { no: e.no }).then(function (res) {
          if (res.auth) return;
          if (res.ok) { closeDialog(true); afterWrite('受付番号 ' + e.no + ' をキャンセルしました。'); return; }
          $('#dlg-alert').textContent = res.message || 'キャンセルできませんでした。';
        });
      }
    });
  }

  // ---- 定員 ----
  function saveCapacity() {
    var p = root.AdminLogic.parseCapacity($('#cap').value), err = $('#cap-err'), cur = findCat(curCat);
    err.textContent = ''; $('#cap').classList.remove('invalid');
    if (p.error) { err.textContent = p.error; $('#cap').classList.add('invalid'); $('#cap').focus(); return; }
    call('setCapacity', { categoryId: cur.id, capacity: p.value }).then(function (res) {
      if (res.auth) return;
      if (res.ok) { afterWrite(cur.name + ' の定員を ' + p.value + ' 組にしました。'); return; }
      var e2 = $('#cap-err');   // サーバーの文言をそのまま出す
      if (e2) { e2.textContent = res.message || '定員を変更できませんでした。'; $('#cap').classList.add('invalid'); }
    });
  }

  // ---- メンバー変更 ----
  function memberDialog(e, opener) {
    var dlg = openDialog('<h2 id="dlg-t">受付番号 ' + esc(e.no) + '：メンバー変更</h2>' +
      '<form id="m-form" novalidate><div class="field" role="group" aria-labelledby="m-sl"><div class="lbl" id="m-sl">変更する人<span class="req">必須</span></div>' +
      '<div class="seg"><label><input type="radio" name="m-slot" value="1"><span>代表：' + esc(e.p1.name) + '</span></label><label><input type="radio" name="m-slot" value="2"><span>ペア：' + esc(e.p2.name) + '</span></label></div>' +
      '<p class="err" data-err="slot"></p></div>' +
      PF.html('m', '変更後のメンバー', false) +
      '<div class="alert" id="m-alert" role="alert"></div>' +
      '<div class="btn-row"><button class="btn sub" type="button" id="m-no">やめる</button><button class="btn" type="submit" id="m-ok">メンバーを変更する</button></div></form>', opener, true);
    var form = $('#m-form', dlg);
    PF.bind(form);
    clearOnInput(form);
    form.addEventListener('change', function (ev) { if (ev.target.name === 'm-slot') { $('[data-err="slot"]', form).textContent = ''; } });
    $('#m-no', dlg).addEventListener('click', function () { if (!sending) closeDialog(); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); if (!sending) submitMember(e, form); });
  }

  function submitMember(e, form) {
    var alertEl = $('#m-alert', form), chosen = $('input[name="m-slot"]:checked', form);
    PF.clearAll(form, alertEl);
    var errors = [], cat = findCat(e.categoryId) || {};
    if (!chosen) { keyErrors(form, [{ field: 'slot', message: '変更する人（代表かペア）を選んでください。' }], alertEl); return; }
    var slot = +chosen.value, mine = 'p' + slot, other = slot === 1 ? 'p2' : 'p1';
    var r = PF.read(form, 'm');
    // 変更しない側は保存済みの内容。DUPR が無い（null）人は「なし」に戻して、サーバーと同じ検査にかける
    var keep = JSON.parse(JSON.stringify(e[other]));
    if (keep.dupr == null) keep.dupr = root.Rules.DUPR_NONE;
    var pair = {}; pair[mine] = r.person; pair[other] = keep;
    root.Rules.validateEntryInput(pair, cat, state.tournament.date).forEach(function (x) {
      if (x.field.indexOf(mine + '.') === 0) {
        if (x.field === mine + '.birth' && r.birthErr) return;
        errors.push({ field: 'm.' + x.field.slice(mine.length + 1), message: x.message });
      } else errors.push({ field: '', message: x.message });
    });
    if (r.birthErr) errors.push({ field: 'm.birth', message: r.birthErr });
    errors.sort(function (a, b) { return PF.fieldOrder(a.field.slice(2)) - PF.fieldOrder(b.field.slice(2)); });
    if (errors.length) { PF.showErrors(form, errors, alertEl); return; }
    call('changeMember', { no: e.no, slot: slot, person: r.person }).then(function (res) {
      if (res.auth) return;
      if (res.ok) { closeDialog(true); afterWrite('受付番号 ' + e.no + ' の' + (slot === 1 ? '代表' : 'ペア') + 'を変更しました。'); return; }
      var f = $('#m-form');
      if (!f) return;
      if (res.code === 'invalid' && res.errors && res.errors.length) {
        PF.showErrors(f, res.errors.map(function (x) {
          return x.field.indexOf(mine + '.') === 0 ? { field: 'm.' + x.field.slice(mine.length + 1), message: x.message } : { field: '', message: x.message };
        }), $('#m-alert', f));
        return;
      }
      $('#m-alert', f).textContent = res.message || 'メンバーを変更できませんでした。';
    });
  }

  // ---- 仮DUPR ----
  function provDialog(e, opener) {
    var L = root.AdminLogic, slots = L.provisionalSlots(e);
    if (!slots.length) return;
    function who(s) { var p = s === 1 ? e.p1 : e.p2; return (s === 1 ? '代表：' : 'ペア：') + esc(p.name) + '（' + esc(L.formatDupr(p)) + '）'; }
    var dlg = openDialog('<h2 id="dlg-t">受付番号 ' + esc(e.no) + '：仮DUPR</h2>' +
      '<p class="muted">DUPR が無い人にだけ、仮の数字を入れられます（0より大きく10未満）。</p>' +
      '<form id="v-form-prov" novalidate><div class="field" role="group" aria-labelledby="pv-sl"><div class="lbl" id="pv-sl">入れる人</div><div class="seg">' +
      slots.map(function (s, i) { return '<label><input type="radio" name="pv-slot" value="' + s + '"' + (i === 0 ? ' checked' : '') + '><span>' + who(s) + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="pv-val">仮DUPR<span class="req">必須</span></label><input type="text" id="pv-val" inputmode="decimal" data-k="pv" placeholder="例：3.00" autocomplete="off"><p class="err" data-err="pv"></p></div>' +
      '<div class="alert" id="pv-alert" role="alert"></div>' +
      '<div class="btn-row"><button class="btn sub" type="button" id="pv-no">やめる</button><button class="btn" type="submit">仮DUPRを保存</button></div></form>', opener, true);
    var form = $('#v-form-prov', dlg);
    clearOnInput(form);
    $('#pv-no', dlg).addEventListener('click', function () { if (!sending) closeDialog(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sending) return;
      var alertEl = $('#pv-alert', form), p = L.parseProvisional($('#pv-val', form).value), slot = +$('input[name="pv-slot"]:checked', form).value;
      PF.clearAll(form, alertEl);
      if (p.error) { keyErrors(form, [{ field: 'pv', message: p.error }], alertEl); return; }
      call('setProvisionalDupr', { no: e.no, slot: slot, value: p.value }).then(function (res) {
        if (res.auth) return;
        if (res.ok) { closeDialog(true); afterWrite('受付番号 ' + e.no + ' の' + (slot === 1 ? '代表' : 'ペア') + 'に、仮DUPR ' + p.value + ' を入れました。'); return; }
        var f = $('#v-form-prov');
        if (f) $('#pv-alert', f).textContent = res.message || '仮DUPRを保存できませんでした。';
      });
    });
  }

  // ---- お知らせ ----
  function buildNotice() {
    var box = $('#s-notice');
    box.innerHTML = '<h2 style="margin-top:0">お知らせを送る</h2>' +
      '<p class="muted">確定している申し込みの代表者へメールで送り、大会ページにも載せます。送ったあとは取り消せません。</p>' +
      '<form id="n-form" novalidate><div class="field"><label for="n-title">タイトル<span class="req">必須</span></label><input type="text" id="n-title" data-k="title" maxlength="100" autocomplete="off"><p class="err" data-err="title"></p></div>' +
      '<div class="field"><label for="n-body">本文<span class="req">必須</span></label><textarea id="n-body" data-k="body" maxlength="5000"></textarea><p class="err" data-err="body"></p></div>' +
      '<div class="alert" id="n-alert" role="alert"></div>' +
      '<button class="btn pc-center" type="submit">送る前に確認する</button></form><div id="n-past"></div>';
    clearOnInput($('#n-form'));
    $('#n-form').addEventListener('submit', onNoticeSubmit);
  }

  function onNoticeSubmit(ev) {
    ev.preventDefault();
    if (sending) return;
    var form = $('#n-form'), v = root.AdminLogic.validateNotice($('#n-title').value, $('#n-body').value);
    PF.clearAll(form, $('#n-alert'));
    if (v.errors.length) { keyErrors(form, v.errors, $('#n-alert')); return; }
    var opener = form.querySelector('button[type="submit"]');
    call('mailStatus').then(function (ms) {
      if (ms.auth) return;
      if (!ms.ok) { $('#n-alert').textContent = ms.message || '送れる人数を確認できませんでした。'; return; }
      var targets = state.entries.filter(function (e) { return e.status === '確定'; }).length;
      var over = targets > ms.remaining;
      confirmDialog({
        title: 'このお知らせを送りますか？', opener: opener, okLabel: '送る', wide: true,
        bodyHtml: '<p><b>' + esc(v.title) + '</b></p><p style="white-space:pre-wrap">' + esc(v.body) + '</p>' +
          '<p class="warn">今日あと <b>' + esc(ms.remaining) + '人</b> に送れます／送信待ち <b>' + esc(ms.queued) + '件</b><br>確定している ' + targets + ' 組の代表者に送ります。' +
          (over ? '<br>今日送れる人数を超えています。超えた分は送信待ちのまま残り、あとで順に送られます。' : '') + '</p>' +
          '<p class="muted">送ったあとは取り消せません。</p>',
        onOk: function () {
          call('sendNotice', { title: v.title, body: v.body }).then(function (res) {
            if (res.auth) return;
            if (res.ok) {
              closeDialog(true);
              $('#n-title').value = ''; $('#n-body').value = '';
              afterWrite('お知らせを送りました（' + res.recipients + '件をメール送信待ちに入れました）。');
              return;
            }
            $('#dlg-alert').textContent = res.message || 'お知らせを送れませんでした。';
          });
        }
      });
    });
  }

  function renderPastNotices() {
    var box = $('#n-past');
    if (!box || !state) return;
    box.innerHTML = state.notices.length
      ? '<h3>これまでのお知らせ</h3><ul class="plain">' + state.notices.slice().reverse().map(function (n) { return '<li>' + esc(root.AdminLogic.shortDate(n.at)) + '　' + esc(n.title) + '</li>'; }).join('') + '</ul>'
      : '';
  }

  // ---- 試算 ----
  function sessionsOf(cats) {
    var names = [], map = {};
    cats.forEach(function (c) {
      if (!map[c.session]) { map[c.session] = []; names.push(c.session); }
      map[c.session].push(c);
    });
    return names.map(function (n) { return { name: n, cats: map[n] }; });
  }

  function buildEstimate() {
    var sess = sessionsOf(state.categories);
    $('#s-est').innerHTML = '<h2 style="margin-top:0">定員の試算</h2>' +
      '<p class="muted">コート数・1試合の時間枠・各部の開始時刻・カテゴリごとの組数から、試合数と終了予定時刻を計算します（組数は、いまの定員を入れてあります。変えて試せます）。</p>' +
      '<form id="e-form" novalidate><div class="fgrid">' +
      '<div class="field"><label for="e-courts">コート数<span class="req">必須</span></label><input type="text" id="e-courts" inputmode="numeric" data-k="courts" autocomplete="off"><p class="hint">1〜50</p><p class="err" data-err="courts"></p></div>' +
      '<div class="field"><label for="e-slot">1試合の時間枠（分）<span class="req">必須</span></label><input type="text" id="e-slot" inputmode="numeric" data-k="slotMinutes" autocomplete="off"><p class="hint">5〜120。試合と入れ替えを合わせた時間</p><p class="err" data-err="slotMinutes"></p></div></div>' +
      sess.map(function (s, i) {
        return '<fieldset><legend>' + esc(s.name) + '</legend><div class="fgrid"><div class="field"><label for="e-s' + i + '">開始時刻<span class="req">必須</span></label><input type="text" id="e-s' + i + '" inputmode="numeric" data-k="s' + i + '.start" placeholder="例：09:30" autocomplete="off"><p class="err" data-err="s' + i + '.start"></p></div>' +
          s.cats.map(function (c, j) {
            return '<div class="field"><label for="e-s' + i + 'c' + j + '">' + esc(c.name) + '（組）</label><input type="text" id="e-s' + i + 'c' + j + '" inputmode="numeric" data-k="s' + i + '.c' + j + '.pairs" value="' + esc(c.capacity) + '" autocomplete="off"><p class="err" data-err="s' + i + '.c' + j + '.pairs"></p></div>';
          }).join('') + '</div></fieldset>';
      }).join('') +
      '<div class="alert" id="e-alert" role="alert"></div><button class="btn pc-center" type="submit">試算する</button></form><div id="e-result"></div>';
    clearOnInput($('#e-form'));
    $('#e-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = $('#e-form'), raw = { courts: $('#e-courts').value, slotMinutes: $('#e-slot').value, sessions: [] };
      sess.forEach(function (s, i) {
        raw.sessions.push({ name: s.name, start: $('#e-s' + i).value, categories: s.cats.map(function (c, j) { return { name: c.name, pairs: $('#e-s' + i + 'c' + j).value }; }) });
      });
      var v = root.AdminLogic.validateEstimate(raw);
      PF.clearAll(form, $('#e-alert'));
      $('#e-result').innerHTML = '';
      if (v.errors.length) { keyErrors(form, v.errors, $('#e-alert')); return; }
      $('#e-result').innerHTML = estimateHtml(root.Rules.estimate(v.input));
    });
  }

  function estimateHtml(est) {
    var warns = [];
    var html = '<h3>試算の結果</h3><div class="tablewrap"><table><thead><tr><th>部</th><th>予選の試合数</th><th>予選の終わり</th><th>トーナメントの試合数</th><th>全部で何コマ</th><th>終了予定</th></tr></thead><tbody>' +
      est.sessions.map(function (s) {
        return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.leagueMatches) + '</td><td>' + esc(s.leagueEnd) + '</td><td>' + esc(s.tournamentMatches) + '</td><td>' + esc(s.slots) + '</td><td><b>' + esc(s.end) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="tablewrap"><table><thead><tr><th>部</th><th>カテゴリ</th><th>組の分け方（1組の人数）</th><th>予選の試合数</th><th>トーナメントの試合数</th></tr></thead><tbody>' +
      est.sessions.map(function (s) {
        return s.categories.map(function (c) {
          if (c.warning) warns.push(c.name + '：' + c.warning);
          return '<tr><td>' + esc(s.name) + '</td><td>' + esc(c.name) + '</td><td>' + (c.groups.length ? esc(c.groups.join('・')) : '-') + '</td><td>' + esc(c.leagueMatches) + '</td><td>' + esc(c.tournamentMatches) + '</td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div>';
    if (warns.length) html += '<div class="warn"><b>注意</b><ul class="plain">' + warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    return html;
  }

  // ---- 起動 ----
  function init() {
    if (!CFG.API_URL) {
      app.innerHTML = '<section class="frame"><h1>ただいま準備中です</h1><p>エントリーのしくみの設定がまだ終わっていないため、この画面は使えません。</p></section>';
      return;
    }
    api = root.ApiClient.create({
      url: CFG.API_URL,
      fetch: function (u, o) { return root.fetch(u, o); },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      random: Math.random
    });
    var pass = stGet(KEY_PASS), actor = stGet(KEY_ACTOR);
    if (!pass || !actor) { showLogin(''); return; }
    // 同じタブで開き直したとき：保存してある合言葉で入る
    app.innerHTML = '<section class="frame"><p class="muted">読み込み中…</p></section>' + shell();
    cred = { pass: pass, actor: actor };
    fetchList().then(function (res) {
      if (res.auth) return;
      if (!res.ok) { cred = null; showLogin(res.message || '読み込めませんでした。'); return; }
      buildMain();
      render();
    });
  }

  init();
})(this);
