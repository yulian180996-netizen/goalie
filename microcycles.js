// Microcycle notes keep plain text and **bold** in the existing plan fields.
function microRichHTML(text) {
  return esc(text || '').replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
}

function microEditor(id, label, value) {
  return '<div class="fld micro-field"><div class="micro-label"><label id="' + id + '-label">' +
    esc(label) + '</label><button type="button" data-bold-for="' + id +
    '" aria-label="Жирный шрифт, ' + esc(label) + '" title="Жирный (⌘B / Ctrl+B)"><b>Ж</b></button></div>' +
    '<div class="micro-editor" role="textbox" aria-multiline="true" aria-labelledby="' +
    id + '-label" id="' + id + '" contenteditable="true">' + microRichHTML(value) + '</div></div>';
}

// Browsers can split one bold run across spans, or produce DIV/P after Enter.
function microEditorText(editor) {
  var runs = [];
  function append(text, bold) {
    if (!text) return;
    var last = runs[runs.length - 1];
    if (last && last.bold === bold) last.text += text;
    else runs.push({text:text, bold:bold});
  }
  function visit(node, bold) {
    if (node.nodeType === 3) return append(node.nodeValue.replace(/\u00a0/g, ' '), bold);
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') return append('\n', false);
    var weight = node.style.fontWeight;
    var strong = weight ? (weight === 'bold' || Number(weight) >= 600)
                        : (bold || node.tagName === 'B' || node.tagName === 'STRONG');
    Array.from(node.childNodes).forEach(function(child, i, all) {
      var block = child.nodeName === 'DIV' || child.nodeName === 'P';
      var prev = i && all[i - 1].nodeName;
      if (i && (block || prev === 'DIV' || prev === 'P')) append('\n', false);
      if (block && child.childNodes.length === 1 && child.firstChild.nodeName === 'BR') return;
      visit(child, strong);
    });
  }
  visit(editor, false);
  return runs.map(function(run) { return run.bold ? '**' + run.text + '**' : run.text; }).join('').trim();
}

function bindMicroEditors(root) {
  root.querySelectorAll('[data-bold-for]').forEach(function(button) {
    var box = document.getElementById(button.dataset.boldFor);
    var saved = null;
    function remember() {
      var selection = window.getSelection();
      if (selection.rangeCount && box.contains(selection.anchorNode) && box.contains(selection.focusNode))
        saved = selection.getRangeAt(0).cloneRange();
    }
    ['keyup','mouseup','touchend','focusout'].forEach(function(type) { box.addEventListener(type, remember); });
    button.onmousedown = function(ev) { remember(); ev.preventDefault(); };
    button.onclick = function() {
      var selection = window.getSelection();
      if (box.contains(selection.anchorNode)) remember();
      box.focus();
      if (saved && box.contains(saved.commonAncestorContainer)) {
        selection.removeAllRanges(); selection.addRange(saved);
      }
      document.execCommand('bold', false); remember();
    };
    box.onpaste = function(ev) {
      ev.preventDefault();
      document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
    };
    box.ondrop = function(ev) { ev.preventDefault(); };
  });
}

var microFocus = {catalog:[], group:0, cycles:new Map(), busy:false, timer:null, error:''};
function focusQueue(n) {
  if (!microFocus.cycles.has(n)) microFocus.cycles.set(n,new Map());
  return microFocus.cycles.get(n);
}
function focusOn(cycle, id) {
  var delta = microFocus.cycles.get(cycle.n);
  return delta && delta.has(id) ? delta.get(id) : (cycle.focus || []).includes(id);
}
function focusStatus() {
  var status = document.getElementById('focus-status');
  if (!status) return;
  status.textContent = microFocus.error || (microFocus.busy || microFocus.cycles.size ? 'Сохраняю…' : '');
  document.getElementById('focus-retry').hidden = !microFocus.error;
}
function sendFocusChanges() {
  if (microFocus.busy || !microFocus.cycles.size) return;
  var entry = microFocus.cycles.entries().next().value, n = entry[0], pending = entry[1];
  var sent = new Map(pending);
  microFocus.error = ''; microFocus.busy = true; focusStatus();
  api({a:'pmicrofocus', n:n, changes:Array.from(sent, function(pair) {
    return {id:pair[0], on:pair[1]};
  })}, function(res) {
    microFocus.busy = false;
    if (!res || !res.ok || !Array.isArray(res.focus)) {
      microFocus.error = 'Не удалось сохранить отметки. ' + (res && res.err || 'Проверь связь.');
      focusStatus(); return;
    }
    var cycle = (MC.list || []).find(function(c) { return c.n === n; });
    if (cycle) cycle.focus = res.focus;
    sent.forEach(function(value,id) { if (pending.get(id) === value) pending.delete(id); });
    if (!pending.size) microFocus.cycles.delete(n);
    refreshFocusRows(); focusStatus(); sendFocusChanges();
  });
}
function refreshFocusRows() {
  var grid = document.getElementById('focus-grid');
  if (!grid || !MC.list) return;
  var byCycle = new Map(MC.list.map(function(c) { return [c.n,c]; }));
  grid.querySelectorAll('tr[data-skill]').forEach(function(row) {
    var count = 0;
    row.querySelectorAll('[data-cycle]').forEach(function(button) {
      var cycle = byCycle.get(button.dataset.cycle);
      var on = cycle && focusOn(cycle,row.dataset.skill);
      button.setAttribute('aria-pressed',String(!!on));
      button.textContent = on ? '✓' : '·';
      if (on) count++;
    });
    row.querySelector('.focus-count').textContent = count;
  });
}
function microFocusPanel() {
  return '<div class="card focus-card"><h2>Навыки по микроциклам</h2>' +
    '<div class="focus-tools"><label>Раздел <select id="focus-group"></select></label>' +
    '<span id="focus-status" role="status"></span><button type="button" id="focus-retry" hidden>Повторить</button></div>' +
    '<div class="muted">Нажми на пересечение навыка и цикла. Повторное нажатие снимает отметку.</div>' +
    '<div class="focus-scroll" id="focus-grid"></div></div>';
}
function mountMicroFocus(current) {
  var select = document.getElementById('focus-group'), grid = document.getElementById('focus-grid');
  var catalog = microFocus.catalog;
  if (!catalog.length) { grid.textContent = 'Список навыков пока недоступен. Обнови страницу.'; return; }
  select.innerHTML = catalog.map(function(g,i) {
    return '<option value="' + i + '">' + esc(g.title) + '</option>';
  }).join('');
  select.value = String(microFocus.group);
  function renderGroup() {
    var lastSection = '', cols = MC.list;
    var chosen = cols.findIndex(function(c) { return c.n === current; });
    var header = cols.map(function(c,i) {
      return '<th scope="col"' + (i === chosen ? ' class="focus-current"' : '') + ' title="' +
        esc(c.dates) + '">МЦ ' + esc(c.n) + '</th>';
    }).join('');
    var rows = catalog[microFocus.group].skills.map(function(skill) {
      var section = '';
      if (skill.section && lastSection !== skill.section) {
        section = '<tr><th colspan="' + (cols.length+2) + '" class="focus-section">' + esc(skill.section) + '</th></tr>';
      }
      lastSection = skill.section;
      return section+'<tr data-skill="'+esc(skill.id)+'"><th scope="row">'+esc(skill.name)+'</th>' +
        '<td class="focus-count"></td>'+cols.map(function(c,i) {
          var label = esc(skill.name + ', микроцикл ' + c.n);
          return '<td'+(i === chosen ? ' class="focus-current"' : '')+'><button type="button" data-cycle="' +
            esc(c.n)+'" aria-label="'+label+'" title="'+label+'"></button></td>';
        }).join('')+'</tr>';
    }).join('');
    grid.innerHTML = '<table><thead><tr><th scope="col">Навык</th><th scope="col">Всего</th>'+header+'</tr></thead><tbody>'+rows+'</tbody></table>';
    refreshFocusRows();
    var currentHeader = grid.querySelector('thead .focus-current');
    if (currentHeader) {
      var stickyWidth=grid.querySelector('thead th').offsetWidth+grid.querySelector('thead th:nth-child(2)').offsetWidth;
      grid.scrollLeft = currentHeader.offsetLeft - stickyWidth;
    }
  }
  select.onchange = function() { microFocus.group = Number(select.value); renderGroup(); };
  grid.onclick = function(ev) {
    var button = ev.target.closest('button[data-cycle]');
    if (!button) return;
    var id = button.closest('[data-skill]').dataset.skill, n = button.dataset.cycle;
    focusQueue(n).set(id,button.getAttribute('aria-pressed') !== 'true');
    refreshFocusRows(); focusStatus();
    clearTimeout(microFocus.timer);
    microFocus.timer = setTimeout(sendFocusChanges,180);
  };
  document.getElementById('focus-retry').onclick = sendFocusChanges;
  renderGroup(); focusStatus();
}
window.addEventListener('beforeunload', function(ev) {
  if (microFocus.cycles.size) { ev.preventDefault(); ev.returnValue = ''; }
});
