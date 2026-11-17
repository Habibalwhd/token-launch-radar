// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// view with the model's own breakdown and the protocol's farm plan, and the live
// view of tokens that already trade. No network: every byte it shows is in data.js.
//
// The value model, in one function: the page recomputes a row from the snapshot
// figures and checks the number board.json carries, so the page's code and the
// board's data are visibly the same arithmetic:
//
//   base         = tvl_usd x 0.30
//   growth       = clamp(change_7d, -50, 150); unknown growth counts as 0
//   growthMult   = 1 + (growth / 100) x 0.60
//   ageMult      = 0.70 + 0.30 x min(age_days, 730) / 730; unknown age is 365 days
//   breadthMult  = 1 + 0.03 x min(chains - 1, 4)
//   categoryMult = 1.05 for fee-capturing categories, 0.95 for wrappers and
//                  bridges, 1.00 otherwise
//   implied      = max(1, round(base x growthMult x ageMult x breadthMult
//                               x categoryMult))
//
// A row is ranked only when it meets every clause of the house watchlist rule:
// it records no token, its category is none of Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole word
// wrapped, staked or staking, ends in no version marker, and begins with no
// exchange name. That is what keeps a wrapped, staked or bridged product of a
// token that already trades off a board of tokens still to come.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;
  var boardEl = document.getElementById('board');
  var detailEl = document.getElementById('detail');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, sort: 'rank', dir: 1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return 'x' + n.toFixed(3);
  }

  var FEE_CAPTURE = ['dexs', 'lending', 'derivatives', 'yield', 'yield aggregator', 'cdp', 'leveraged farming', 'basis trading', 'perpetuals', 'options', 'interest rate derivatives'];
  var WRAPPER = ['bridge', 'canonical bridge', 'cross chain bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'staking pool', 'restaking'];
  function categoryMultiplier(category) {
    var c = (category || '').toLowerCase();
    if (FEE_CAPTURE.indexOf(c) >= 0) return MODEL.category_fee_capture;
    if (WRAPPER.indexOf(c) >= 0) return MODEL.category_wrapper;
    return 1;
  }
  // The model in one function, recomputed here from the row's snapshot figures.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var ageMult = MODEL.age_floor + (Math.min(Math.max(age, 0), MODEL.age_cap_days) / MODEL.age_cap_days) * MODEL.age_range;
    var breadthMult = 1 + MODEL.breadth_per_chain * Math.max(0, Math.min((row.chains || []).length - 1, MODEL.breadth_max_extra_chains));
    var categoryMult = categoryMultiplier(row.category);
    var base = row.tvl_usd * MODEL.base_multiple;
    return { base: Math.round(base), growth: growth, growthMult: growthMult, ageMult: ageMult, breadthMult: breadthMult, categoryMult: categoryMult, implied: Math.max(1, Math.round(base * growthMult * ageMult * breadthMult * categoryMult)) };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- header stats, filters, footer -------------------------------------
  var watchlistSet = {};
  DATA.watchlist.forEach(function (s) { watchlistSet[s] = true; });
  (function () {
    var stats = document.getElementById('stats');
    var items = [
      ['Board rows', DATA.board_size],
      ['Watchlist covered', DATA.watchlist_size],
      ['Early rows found', DATA.early_size],
      ['Snapshot date', DATA.as_of],
    ];
    items.forEach(function (kv) {
      stats.appendChild(el('div', {}, el('dt', { text: kv[0] }), el('dd', { text: String(kv[1]) })));
    });
    var foot = document.getElementById('foot');
    foot.appendChild(el('p', { text: 'Data: a sealed DefiLlama snapshot of ' + DATA.board_size + ' ranked protocols, fetched ' + DATA.as_of + '. Floor for the watchlist: ' + fmtUsd(DATA.floor_usd) + ' of TVL. Model ' + DATA.model_version + '.' }));
    foot.appendChild(el('p', { text: 'Ranked only if pre-token: no token recorded, category none of Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, name with no whole word wrapped, staked or staking, no version marker, and not named after an exchange. That keeps wrapped, staked and bridged products of tokens that already trade off this board.' }));
    foot.appendChild(el('p', { text: 'Implied values are this radar\u2019s own claim from the snapshot\u2019s figures. Nothing here is a promise that a token launches, or advice to buy one.' }));
  })();

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      sel.appendChild(el('option', { value: v, text: v }));
    });
  }
  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  fillSelect('category', categories);
  fillSelect('chain', chains);

  // ---- filtering and sorting ---------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlist && !watchlistSet[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va = sortValue(a, key);
      var vb = sortValue(b, key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return rows;
  }
  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    if (key === 'chains') return (r.chains || []).length;
    if (key === 'value') return r.implied_value_usd;
    return r.rank;
  }
  // The watchlist is the snapshot's own list, carried in the data the program wrote.

  // ---- the board ----------------------------------------------------------
  var COLUMNS = [
    ['rank', '#', 'num'],
    ['name', 'Protocol', ''],
    ['category', 'Category', ''],
    ['tvl', 'TVL', 'num'],
    ['change', '7d', 'num'],
    ['chains', 'Chains', ''],
    ['age', 'Age', 'num'],
    ['value', 'Implied value', 'num'],
  ];
  function renderBoard() {
    boardEl.setAttribute('aria-busy', 'false');
    var rows = filtered();
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
    var wrap = el('div', { 'class': 'boardwrap' });
    var table = el('table', {});
    var thead = el('thead', {});
    var hr = el('tr', {});
    COLUMNS.forEach(function (col) {
      var th = el('th', { 'class': col[2] });
      var arrow = state.sort === col[0] ? (state.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
      th.appendChild(el('button', { text: col[1] + arrow, onclick: function () {
        if (state.sort === col[0]) state.dir = -state.dir;
        else { state.sort = col[0]; state.dir = col[0] === 'name' || col[0] === 'category' ? 1 : -1; }
        renderBoard();
      } }));
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody', {});
    if (rows.length === 0) {
      tbody.appendChild(el('tr', {}, el('td', { 'class': 'empty', colspan: COLUMNS.length, text: 'No protocol matches this filter.' })));
    }
    rows.forEach(function (r) {
      var change = r.change_7d;
      var tr = el('tr', { 'class': state.selected === r.slug ? 'selected' : '', onclick: function () { select(r.slug); } }, [
        el('td', { 'class': 'num', text: String(r.rank) }),
        el('td', { 'class': 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
        el('td', {}, el('span', { 'class': 'cat', text: r.category || '—' })),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + (change === null ? '' : change >= 0 ? 'up' : 'down'), text: fmtPct(change) }),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', { 'class': 'num val', text: fmtUsd(r.implied_value_usd) }),
      ]);
      var chainsTd = el('td', { 'class': 'chains', text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') });
      tr.insertBefore(chainsTd, tr.children[5]);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    boardEl.replaceChildren(wrap);
  }

  // ---- the detail view ----------------------------------------------------
  function select(slug) {
    state.selected = slug;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { detailEl.replaceChildren(); renderBoard(); return; }
    var m = impliedOf(row);
    var check = m.implied === row.implied_value_usd ? 'matches the board' : 'differs from the board by ' + fmtUsd(Math.abs(m.implied - row.implied_value_usd));
    var card = el('div', { 'class': 'detail-card' });
    card.appendChild(el('h2', { text: '#' + row.rank + ' ' + row.name }));
    card.appendChild(el('p', { 'class': 'sub', text: row.slug + ' · ' + (row.category || 'no category') + ' · ' + (row.chains || []).join(', ') + ' · tracked since ' + (row.listed_at || 'an unknown date') + ' · snapshot ' + DATA.as_of }));
    var grid = el('div', { 'class': 'detail-grid' });
    var facts = el('dl', { 'class': 'facts' });
    [['Implied value', fmtUsd(row.implied_value_usd)], ['TVL', fmtUsd(row.tvl_usd)], ['7-day change', fmtPct(row.change_7d)], ['Age', fmtAge(row.age_days)], ['Chains', String((row.chains || []).length)], ['Token', 'none recorded — pre-token']].forEach(function (kv) {
      facts.appendChild(el('dt', { text: kv[0] }));
      facts.appendChild(el('dd', { text: kv[1] }));
    });
    grid.appendChild(el('div', {}, facts));
    var box = el('div', { 'class': 'modelbox' });
    box.appendChild(el('h3', { text: 'Value breakdown · model ' + DATA.model_version }));
    var mtable = el('table', {});
    var mbody = el('tbody', {});
    [['Base (TVL x 0.30)', fmtUsd(m.base)], ['Growth ' + fmtPct(m.growth), fmtMult(m.growthMult)], ['Age ' + fmtAge(row.age_days), fmtMult(m.ageMult)], ['Breadth (' + (row.chains || []).length + ' chains)', fmtMult(m.breadthMult)], ['Category (' + (row.category || 'none') + ')', fmtMult(m.categoryMult)], ['Implied value', fmtUsd(m.implied)]].forEach(function (kv) {
      mbody.appendChild(el('tr', {}, el('td', { text: kv[0] }), el('td', { text: kv[1] })));
    });
    mtable.appendChild(mbody);
    box.appendChild(mtable);
    box.appendChild(el('p', { text: 'Recomputed here from the snapshot figures: ' + check + '.' }));
    grid.appendChild(box);
    card.appendChild(grid);
    card.appendChild(el('h3', { text: 'Farm plan' }));
    var ol = el('ol', { 'class': 'steps' });
    (row.farm_steps || []).forEach(function (s) {
      ol.appendChild(el('li', { text: s }));
    });
    card.appendChild(ol);
    detailEl.replaceChildren(card);
    renderBoard();
    detailEl.scrollIntoView({ block: 'nearest' });
  }

  // ---- the live view ------------------------------------------------------
  (function () {
    var sec = document.getElementById('live');
    sec.appendChild(el('h2', { text: 'Already trading — not ranked' }));
    sec.appendChild(el('p', { text: 'These protocols already have a token, so the board does not rank them: their value is the market\u2019s own, shown here as market cap. The radar exists to find what is still to come.' }));
    var wrap = el('div', { 'class': 'live-table' });
    var table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { 'class': 'num', text: 'TVL' }), el('th', { 'class': 'num', text: 'Market cap' }), el('th', { 'class': 'num', text: '7d' }))));
    var tbody = el('tbody', {});
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', {}, [
        el('td', { 'class': 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
        el('td', {}, el('span', { 'class': 'cat', text: r.category || '—' })),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    sec.appendChild(wrap);
  })();

  // ---- controls -----------------------------------------------------------
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; renderBoard(); });

  // ---- initial state from the address hash, for linking to a view --------
  // #detail=<slug> opens a protocol, #cat=<category> and #chain=<chain> filter.
  (function () {
    var hash = (location.hash || '').replace(/^#/, '');
    var parts = {};
    hash.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) parts[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    if (parts.cat && categories.indexOf(parts.cat) >= 0) {
      state.category = parts.cat;
      document.getElementById('category').value = parts.cat;
    }
    if (parts.chain && chains.indexOf(parts.chain) >= 0) {
      state.chain = parts.chain;
      document.getElementById('chain').value = parts.chain;
    }
    renderBoard();
    if (parts.detail) select(parts.detail);
  })();
})();
