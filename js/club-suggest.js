// 所属サークル欄の入力候補。入力した文字に合う名前だけを、欄のすぐ下に出す（欄を押しただけでは何も出さない）
(function (root) {
  'use strict';

  var MAX = 5;   // 出す名前の最大数

  // ---- DOMを使わない部分（テストあり）----

  // 全角半角・大文字小文字・カタカナ／ひらがなの違いをなくした形にする
  function norm(s) {
    return String(s).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
  }

  // names（サークル名の配列）から、query で始まるもの（先頭一致）を、元の順で最大5件返す
  function match(names, query) {
    if (!Array.isArray(names)) return [];
    var raw = String(query == null ? '' : query).trim();
    var q = norm(raw);
    if (!q) return [];
    var found = [];
    names.forEach(function (n) {
      if (typeof n !== 'string' || !n || n === raw) return;   // 入力済みと同じ名前は出さない
      if (norm(n).indexOf(q) === 0) found.push(n);
    });
    return found.slice(0, MAX);
  }

  root.ClubSuggest = { match: match, attach: attach };
  if (!root.document) return;   // テスト用（node）

  var doc = root.document;

  // ---- 欄に候補のリストをつなぐ ----
  // getNames は、そのつど今の名前の配列を返す関数（新しい公開データに替わっても付け直さなくてよい）
  function attach(input, getNames) {
    if (!input) return;
    var listId = input.id + '-suggest';
    var list = doc.createElement('ul');
    list.className = 'suggest';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.parentNode.insertBefore(list, input.nextSibling);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');

    var active = -1;       // ハイライト中の項目（なければ -1）
    var choosing = false;  // 名前を選んだ直後の input イベントでは、リストを開き直さない
    var chosen = null;     // 選んだ名前（変換中に選んだとき、遅れて来る compositionend で開き直さないため）

    function setActive(i) {
      var items = list.children;
      for (var k = 0; k < items.length; k++) {
        if (k === i) items[k].setAttribute('aria-selected', 'true');
        else items[k].removeAttribute('aria-selected');
      }
      active = i;
      if (i >= 0) input.setAttribute('aria-activedescendant', items[i].id);
      else input.removeAttribute('aria-activedescendant');
    }

    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      setActive(-1);
    }

    function refresh() {
      if (choosing) return;
      var found = match(getNames(), input.value);
      list.textContent = '';
      found.forEach(function (name, k) {
        var li = doc.createElement('li');
        li.setAttribute('role', 'option');
        li.id = listId + '-' + k;
        li.textContent = name;   // 他の人が入力した名前なので textContent で入れる
        list.appendChild(li);
      });
      setActive(-1);
      list.hidden = !found.length;
      input.setAttribute('aria-expanded', found.length ? 'true' : 'false');
    }

    function choose(name) {
      choosing = true;
      chosen = name;
      input.value = name;
      hide();
      input.focus();
      input.dispatchEvent(new root.Event('input', { bubbles: true }));   // 既存の入力欄の処理（エラー消し）を動かす
      choosing = false;
    }

    // 押した瞬間に欄から focus が外れる（blur でリストが消える）のを防ぐ
    function keepFocus(e) { e.preventDefault(); }
    list.addEventListener('mousedown', keepFocus);
    list.addEventListener('pointerdown', keepFocus);
    list.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('li') : null;
      if (li && list.contains(li)) choose(li.textContent);
    });

    input.addEventListener('input', function () {      // 日本語変換の途中でも発生する
      if (!choosing && input.value !== chosen) chosen = null;
      refresh();
    });
    input.addEventListener('compositionend', function () {
      if (input.value !== chosen) refresh();
    });
    input.addEventListener('blur', hide);
    input.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;   // 変換中のキーは日本語入力に任せる
      var n = list.children.length;
      if (list.hidden || !n) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(active + 1, n - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
      } else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); choose(list.children[active].textContent); }
      } else if (e.key === 'Escape') {
        hide();
      }
    });
  }
})(this);
