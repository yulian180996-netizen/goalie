// Fetch each section on first open; responses belong to this particular modal.
function playerHistory(container, player) {
  function section(title, payload, draw) {
    var box=document.createElement('details');
    box.className='card';
    var heading=document.createElement('summary'), body=document.createElement('div');
    heading.textContent=title;heading.style.cursor='pointer';
    box.append(heading,body);container.append(box);
    var state='idle';
    function load(){
      if (!box.open || state!=='idle') return;
      state='loading';body.textContent='Загружаю…';
      api(payload,function(res){
        if(!container.isConnected) return;
        if(!res || !res.ok){
          state='idle';body.textContent='Не удалось загрузить. ';
          var retry=document.createElement('button');retry.textContent='Повторить';retry.onclick=load;body.append(retry);return;
        }
        state='ready';body.innerHTML=draw(res)||'<p class="muted">Записей пока нет.</p>';
      });
    }
    box.ontoggle=load;
  }
  function entry(title, lines){
    var text=lines.filter(function(x){return x!==undefined && x!==null && x!=='';}).map(esc).join('\n');
    if(!text) return '';
    return '<p><b>'+esc(title)+'</b><br><span style="white-space:pre-wrap">'+text+'</span></p>';
  }
  function mine(row){return row.uid ? String(row.uid)===String(player.uid) : row.gk===player.name;}
  section('Цели и дневник',{a:'goalie',uid:player.uid},function(res){
    var d=res.data||{},g=d.goals||{},html='';
    if(g.season) html+=entry('Сезон',[g.season.t,g.season.c]);
    Object.keys(g.months||{}).sort().reverse().forEach(function(k){var v=g.months[k];html+=entry(k,[v.t,v.c]);});
    (g.days||[]).forEach(function(v){html+=entry(v.d,[v.t]);});
    (d.tr||[]).forEach(function(v){html+=entry([v.d,v.ty].filter(Boolean).join(' · '),[v.t1,v.t2,v.t3]);});
    (res.notes||[]).forEach(function(v){html+=entry(v.d,[v.t]);});
    return html;
  });
  section('История когнитивных тестов',{a:'goalie',uid:player.uid},function(res){
    var d=res.data||{},html='';
    COG.forEach(function(c){
      var list=cogArr({cog:d},c);if(!list.length)return;
      var lines=list.map(function(v){
        if(c.k==='svet' && v.rt==null)return v.d+' · ошибок: '+v.e+(v.ms?' · окно '+v.ms+' мс':'');
        var value=c.v(v);return [v.d,value==null?'':value+' '+c.u,c.ex(v)].filter(Boolean).join(' · ');
      });
      html+=entry(c.t,lines);
    });return html;
  });
  section('Тесты ОФП по датам',{a:'ofp'},function(res){
    var defs=new Map((res.tests||[]).map(function(t){return [t.code,t];})), dates=new Map();
    (res.list||[]).filter(mine).forEach(function(v){
      var t=defs.get(v.t)||{};
      if(!dates.has(v.d))dates.set(v.d,[]);
      dates.get(v.d).push((t.name||v.t)+' — '+v.v+' '+(t.unit||'')+(v.cm?' · '+v.cm:''));
    });
    return Array.from(dates,function(pair){return entry(pair[0],pair[1]);}).join('');
  });
  section('Матчи, статистика и разбор голов',{a:'games2'},function(res){
    var list=(res.list||[]).filter(mine);if(!list.length)return '';
    var shots=0, goals=0,html='';
    list.forEach(function(g){
      shots+=g.sh;goals+=g.ga;
      var lines=['Броски: '+g.sh+' · отражено: '+(g.sh-g.ga)+' · пропущено: '+g.ga+(g.pct!=null?' · '+g.pct+'%':'')];
      (g.gls||[]).forEach(function(v,i){lines.push('Гол '+(i+1)+' · '+[v.s,v.d,v.z?'зона '+v.z:''].filter(Boolean).join(' · '));});
      if(!(g.gls||[]).length) Object.keys(g.st||{}).forEach(function(k){if(g.st[k])lines.push(k+' — '+g.st[k]);});
      lines.push(g.cm);html+=entry([g.d,g.opp,g.res].filter(Boolean).join(' · '),lines);
    });
    return entry('Всего матчей: '+list.length,['Броски: '+shots+' · отражено: '+(shots-goals)+' · пропущено: '+goals+(shots?' · '+((shots-goals)*100/shots).toFixed(1)+'%':'')])+html;
  });
  section('Тренерские заметки и задачи',{a:'cmemo',uid:player.uid},function(res){
    var m=res.memo||{};
    return (m.tasks||[]).map(function(t){return entry(t.ok?'Выполнено':'В работе',[t.t]);}).join('')+
      (m.notes||[]).map(function(v){return entry([v.d,v.ty].filter(Boolean).join(' · '),[v.t]);}).join('');
  });
}
