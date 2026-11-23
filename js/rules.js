// 共通ルール：ブラウザ・Google Apps Script・Node のテストで同じファイルを使う
(function (root) {
  'use strict';

  var Rules = {};

  // DUPR を持っていない人が入れる値（画面とサーバーで同じ値を使う）
  Rules.DUPR_NONE = 'なし';

  function nfkc(s) {
    return String(s == null ? '' : s).normalize('NFKC');
  }

  // フリガナ：NFKC → ひらがなをカタカナに → 空白（全角・半角）を取る
  Rules.normalizeKana = function (s) {
    return nfkc(s)
      .replace(/[ぁ-ゖ]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 0x60);
      })
      .replace(/\s+/g, '');
  };

  Rules.normalizePhone = function (s) {
    return nfkc(s).replace(/\D/g, '');
  };

  Rules.normalizeEmail = function (s) {
    return nfkc(s).trim().toLowerCase();
  };

  Rules.personKey = function (p) {
    return Rules.normalizeKana(p.kana) + '|' + p.birth;
  };

  // 'YYYY-MM-DD' を {y, m, d} に。形式や実在しない日付ならnull
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nfkc(s).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  // 満年齢（on の日に誕生日を迎えていれば加算。2/29生まれは平年は3/1に加算）
  Rules.ageOn = function (birth, on) {
    var b = parseDate(birth), o = parseDate(on);
    if (!b || !o) return NaN;
    var age = o.y - b.y;
    if (o.m < b.m || (o.m === b.m && o.d < b.d)) age -= 1;
    return age;
  };


  function validatePerson(prefix, p, category, eventDate, errors) {
    function err(f, message) {
      errors.push({ field: prefix + '.' + f, message: message });
    }
    p = p || {};

    var name = nfkc(p.name).trim();
    if (!name) err('name', '氏名を入力してください');
    else if (name.length > 40) err('name', '氏名は40文字以内で入力してください');

    if (!Rules.normalizeKana(p.kana)) err('kana', 'フリガナを入力してください');

    var phone = Rules.normalizePhone(p.phone);
    if (!phone) err('phone', '電話番号を入力してください');
    else if (phone.length < 10 || phone.length > 11) err('phone', '電話番号は10〜11桁で入力してください');

    var email = Rules.normalizeEmail(p.email);
    if (!email) err('email', 'メールアドレスを入力してください');
    else if (email.indexOf('@') < 1 || email.indexOf('@') === email.length - 1 || /\s/.test(email)) {
      err('email', 'メールアドレスの形式を確認してください');
    }

    var birthRaw = nfkc(p.birth).trim();
    if (!birthRaw) err('birth', '生年月日を入力してください');
    else if (!parseDate(birthRaw)) err('birth', '生年月日は西暦で、実在する日付を入力してください');
    else if (category && category.minAge != null && Rules.ageOn(birthRaw, eventDate) < category.minAge) {
      err('birth', '大会当日に' + category.minAge + '歳以上の方が対象です');
    }

    if (!nfkc(p.club).trim()) err('club', '所属を入力してください（所属がない場合は「フリー」）');

    var dupr = nfkc(p.dupr).trim();
    if (!dupr) {
      err('dupr', 'DUPRの数字を入力するか、「持っていない（なし）」を選んでください');
    } else if (dupr !== Rules.DUPR_NONE) {
      var n = /^\d+(\.\d+)?$/.test(dupr) ? parseFloat(dupr) : NaN;
      if (dupr.length > 20 || !(n > 0 && n < 10)) err('dupr', 'DUPRは0より大きく10未満の数字で入力してください');
    }

    var duprId = nfkc(p.duprId).trim();
    if (duprId && !/^[A-Za-z0-9]{1,20}$/.test(duprId)) {
      err('duprId', 'DUPR IDは英数字20文字以内で入力してください（わからなければ空欄で大丈夫です）');
    }
  }

  Rules.validateEntryInput = function (input, category, eventDate) {
    var errors = [];
    validatePerson('p1', input && input.p1, category, eventDate, errors);
    validatePerson('p2', input && input.p2, category, eventDate, errors);

    var a = input && input.p1, b = input && input.p2;
    if (a && b && Rules.normalizeKana(a.kana) && parseDate(a.birth) && Rules.normalizeKana(b.kana) && parseDate(b.birth)) {
      var ka = Rules.personKey({ kana: a.kana, birth: nfkc(a.birth).trim() });
      var kb = Rules.personKey({ kana: b.kana, birth: nfkc(b.birth).trim() });
      if (ka === kb) errors.push({ field: 'p2.kana', message: 'パートナーが代表者と同じ人になっています' });
    }
    return errors;
  };

  // ---- ペアの強さ・組の分け方・試算 ----

  function duprOf(person) {
    if (person && typeof person.dupr === 'number') return person.dupr;
    if (person && typeof person.provisionalDupr === 'number') return person.provisionalDupr;
    return null;
  }

  Rules.pairStrength = function (entry) {
    var a = duprOf(entry && entry.p1), b = duprOf(entry && entry.p2);
    if (a === null || b === null) return null;
    return (a + b) / 2;
  };

  Rules.splitGroups = function (n) {
    var count = Math.floor(n / 4);
    if (count < 1) return [];
    var base = Math.floor(n / count), extra = n % count, sizes = [];
    for (var i = 0; i < count; i++) sizes.push(i < extra ? base + 1 : base);
    return sizes;
  };

  Rules.bracketRounds = function (m, thirdPlace) {
    var size = 1;
    while (size < m) size *= 2;
    var rounds = [m - size / 2];
    for (var s = size / 4; s >= 1; s /= 2) rounds.push(s);
    if (thirdPlace) rounds[rounds.length - 1] += 1;
    return rounds;
  };

  function toMinutes(hhmm) {
    var parts = String(hhmm).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function toHHMM(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function sum(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total;
  }

  function estimateCategory(cat) {
    var groups = Rules.splitGroups(cat.pairs);
    if (!groups.length) {
      return { name: cat.name, groups: [], leagueMatches: 0, tournamentMatches: 0, rounds: [], warning: 'リーグを組めません（3組以下）' };
    }
    var leagueMatches = sum(groups.map(function (g) { return g * (g - 1) / 2; }));
    var brackets = [];
    if (groups.length === 1) {
      brackets.push([2]);
    } else {
      var finalists = 2 * groups.length;
      brackets.push(Rules.bracketRounds(finalists, finalists >= 4));
      var others = cat.pairs - finalists;
      if (others >= 2) brackets.push(Rules.bracketRounds(others, others >= 4));
    }
    var rounds = [];
    brackets.forEach(function (b) {
      b.forEach(function (n, k) { rounds[k] = (rounds[k] || 0) + n; });
    });
    return { name: cat.name, groups: groups, leagueMatches: leagueMatches, tournamentMatches: sum(rounds), rounds: rounds, warning: null };
  }

  Rules.estimate = function (input) {
    var courts = input.courts, slotMinutes = input.slotMinutes;
    return {
      sessions: input.sessions.map(function (session) {
        var cats = session.categories.map(estimateCategory);
        var leagueMatches = sum(cats.map(function (c) { return c.leagueMatches; }));
        var leagueSlots = Math.ceil(leagueMatches / courts);
        var roundTotals = [];
        cats.forEach(function (c) {
          c.rounds.forEach(function (n, k) { roundTotals[k] = (roundTotals[k] || 0) + n; });
        });
        var tournamentSlots = 0;
        for (var k = 0; k < roundTotals.length; k++) tournamentSlots += Math.ceil((roundTotals[k] || 0) / courts);
        var slots = leagueSlots + tournamentSlots;
        var start = toMinutes(session.start);
        return {
          name: session.name,
          leagueMatches: leagueMatches,
          tournamentMatches: sum(cats.map(function (c) { return c.tournamentMatches; })),
          leagueSlots: leagueSlots,
          leagueEnd: toHHMM(start + leagueSlots * slotMinutes),
          slots: slots,
          end: toHHMM(start + slots * slotMinutes),
          categories: cats.map(function (c) {
            return { name: c.name, groups: c.groups, leagueMatches: c.leagueMatches, tournamentMatches: c.tournamentMatches, warning: c.warning };
          })
        };
      })
    };
  };

  root.Rules = Rules;
})(this);
