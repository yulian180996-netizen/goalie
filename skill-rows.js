// Catalog changes are versioned separately from per-cycle marks.
function openSkillRow(groupIndex, id, redraw) {
  var group=microFocus.catalog[groupIndex], skills=group.skills;
  var index=skills.findIndex(function(s){ return s.id === id; }), item=skills[index];
  var newId=item ? item.id : 'u-'+crypto.randomUUID();
  var sections=Array.from(new Set(skills.map(function(s){return s.section || '';})));
  var version=microFocus.version;
  mOpen('<h2>'+(item?'Изменить навык':'Добавить навык')+'</h2><div class="ms">'+esc(group.title)+'</div>'+
    '<form id="skill-form"><div class="fld"><label for="skill-name">Название навыка</label>'+
    '<input id="skill-name" required maxlength="220" value="'+esc(item ? item.name : '')+'"></div>'+
    '<div class="fld"><label for="skill-section">Подраздел</label>'+
    '<input id="skill-section" maxlength="150" list="skill-sections" value="'+esc(item ? item.section || '' : '')+'">'+
    '<datalist id="skill-sections">'+sections.filter(Boolean).map(function(s){return '<option value="'+esc(s)+'"></option>';}).join('')+'</datalist></div>'+
    (item ? '<div class="skill-order"><button type="button" data-shift="-1"'+(index===0?' disabled':'')+'>↑ Выше</button>'+
    '<button type="button" data-shift="1"'+(index===skills.length-1?' disabled':'')+'>↓ Ниже</button></div>' : '')+
    '<div class="mact skill-actions"><button class="btn" type="submit">Сохранить</button>'+
    '<button class="btn sec" type="button" id="skill-cancel">Отмена</button>'+
    (item?'<button class="del" type="button" id="skill-delete">− Удалить</button>':'')+
    '</div><p role="status" id="skill-status"></p></form>');
  var form=$('skill-form'), name=$('skill-name'), section=$('skill-section'), status=$('skill-status'), waiting=false;
  function run(op, fields) {
    if(waiting) return;
    waiting=true; status.textContent='Сохраняю…';
    form.querySelectorAll('button:not(:disabled)').forEach(function(b){b.disabled=true;b.dataset.pending='1';});
    api(Object.assign({a:'pmicrocatalog',group:groupIndex,id:newId,version:version,op:op},fields),function(res){
      waiting=false;
      if(res && Array.isArray(res.focusCatalog)) {
        microFocus.catalog=res.focusCatalog;microFocus.version=res.focusVersion;redraw();
      }
      if(!$('skill-form') || $('skill-form') !== form) return;
      if(res && res.ok){mClose();return;}
      form.querySelectorAll('[data-pending]').forEach(function(b){b.disabled=false;delete b.dataset.pending;});
      status.textContent=res && res.err || 'Не удалось сохранить. Проверь связь и повтори.';
      if(res && res.conflict) {
        form.querySelectorAll('button:not(#skill-cancel)').forEach(function(b){b.disabled=true;});
        $('skill-cancel').textContent='Закрыть';
      }
    });
  }
  form.onsubmit=function(ev){ev.preventDefault();run(item?'edit':'add',{name:name.value.trim(),section:section.value.trim()});};
  $('skill-cancel').onclick=mClose;
  form.querySelectorAll('[data-shift]').forEach(function(button){
    button.onclick=function(){run('move',{target:skills[index+Number(button.dataset.shift)].id});};
  });
  if(item) $('skill-delete').onclick=function(){
    if(window.confirm('Удалить навык «'+item.name+'» из раздела «'+group.title+'»?')) run('delete',{});
  };
  if(!item) name.focus();
}
