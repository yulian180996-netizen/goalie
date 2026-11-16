'use strict';
// Run with: node tests/regressions.cjs
// Unit checks use lightweight DOM/network doubles; no requests reach production.
const fs = require('node:fs');
const path = require('node:path');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coach = fs.readFileSync(path.join(__dirname, '..', 'coach.html'), 'utf8');
function run(index, coach){

function assert(ok, message){ if (!ok) throw new Error(message); }
var passed = [];
function test(name, fn){ fn(); passed.push(name); }
function block(source, start, end){
  var a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, 'Source markers missing: ' + start);
  return source.slice(a, b);
}
test('Both pages: inline JavaScript parses', function(){
  [index, coach].forEach(function(source){
    var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(source))) new Function(m[1]);
  });
});
var queueSource = block(index, 'var flushing = false;', '\nsetInterval(flushQueue');
function queueHarness(initial){
  var queue = Object.assign({}, initial), requests = [], scheduled = [], cache = {};
  var run = new Function('QUEUE', 'apiReady', 'api', 'qSave', 'renderWarn',
    'setSync', 'qCount', 'setTimeout', 'parse', 'DB', 'lset',
    queueSource + '\nreturn flushQueue;')(
    queue, function(){ return true; },
    function(payload, cb){ requests.push({ payload: payload, cb: cb }); },
    function(){}, function(){}, function(){},
    function(){ return Object.keys(queue).length; },
    function(fn){ scheduled.push(fn); }, JSON.parse, cache,
    function(k, v){ cache[k] = v; });
  return { queue: queue, requests: requests, scheduled: scheduled, cache: cache, run: run };
}
var large = JSON.stringify(Array.from({length: 1200}, function(_, i){
  return { id: i, comment: 'История тренировки '.repeat(10) };
}));
test('Oversized history is sent intact; rejection preserves queue and other sections continue', function(){
  var h = queueHarness({ games: large, wb: '[{"q":2}]' });
  h.run();
  assert(h.requests[0].payload.json === large, 'History was truncated before sending');
  assert(h.queue.games === large, 'Pending history was changed');
  assert(Object.keys(h.cache).length === 0, 'Cache was overwritten during sync');
  h.requests[0].cb({ok:false, err:'too_large'});
  assert(h.queue.games === large, 'Rejected history was discarded');
  assert(h.requests[1].payload.key === 'wb', 'Other sections blocked by rejection');
  h.requests[1].cb({ok:true});
  assert(!('wb' in h.queue) && h.queue.games === large, 'Queue acknowledgement is incorrect');
});
test('Network failure preserves complete history and schedules retry', function(){
  var h = queueHarness({ games: large });
  h.run(); h.requests[0].cb(null);
  assert(h.queue.games === large, 'Network failure lost history');
  assert(h.scheduled.length === 1, 'Retry not scheduled');
});
test('Successful sync acknowledges only the exact sent version', function(){
  var h = queueHarness({ games: '[1]' });
  h.run(); h.queue.games = '[1,2]'; h.requests[0].cb({ok:true});
  assert(h.queue.games === '[1,2]', 'New pending edits were erased');
  assert(h.requests[1].payload.json === '[1,2]', 'New version was not sent');
  h.requests[1].cb({ok:true});
  assert(Object.keys(h.queue).length === 0, 'Successful version remained pending');
});
var modalStart = coach.indexOf('function mReset(') >= 0 ? 'function mReset(' : 'function mOpen(';
var modalSource = block(coach, modalStart, '\n\n');
var formSource = block(coach, 'function gmForm(){', '\n/* ── отметка гола');
function formHarness(){
  var elements = {}, renders = 0, synced = 0, requests = [], alerts = [], reloaded = 0;
  function element(){
    return { value:'', style:{}, disabled:false, textContent:'', listeners:{},
      querySelectorAll:function(){return [];},
      addEventListener:function(type, fn){ (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
      dispatch:function(type, event){
        var callbacks = (this.listeners[type] || []).slice();
        if (this['on' + type]) callbacks.push(this['on' + type]);
        callbacks.forEach(function(fn){ fn(event); });
      }
    };
  }
  var body = element(), modal = element();
  elements.mbody = body; elements.modal = modal;
  Object.defineProperty(body, 'innerHTML', {
    get:function(){return this.html || '';},
    set:function(html){
      this.html = html;
      Object.keys(elements).forEach(function(k){ if(k !== 'mbody' && k !== 'modal') delete elements[k]; });
      var re = /id="([^"]+)"/g, m;
      while ((m = re.exec(html))) elements[m[1]] = element();
      if(html) renders++;
    }
  });
  var gm = {list:[{id:'game-1'}],sk:[]};
  var game = {id:'game-1',d:'2026-11-17',gk:'',gls:[],sk:{},sh:0,ga:0};
  var open = new Function('$','GME','GM','ROSTER','esc','sitTree','RESS','LOADS',
    'SK_OUT','gmSync','api','confirm','alert','gmLoad',
    modalSource + '\n' + formSource + '\nreturn {open:gmForm, close:mClose, other:mOpen};')(
    function(id){return elements[id] || null;}, game, gm, [], String,
    function(){return [['Бросок',[]]];}, [], [], [],
    function(){synced++;}, function(payload, cb){requests.push({payload:payload,cb:cb});},
    function(){return true;}, function(message){alerts.push(message);}, function(){reloaded++;});
  return { elements:elements, body:body, modal:modal, gm:gm, requests:requests, alerts:alerts,
    open:open.open, close:open.close, other:open.other,
    counts:function(){return {renders:renders,synced:synced,reloaded:reloaded};} };
}
test('Repeated form openings and situation changes trigger one update per event', function(){
  var h=formHarness(), event={target:{matches:function(s){return s === '[data-gf="s"]';}}};
  for(var i=0;i<5;i++) h.open();
  for(var j=0;j<5;j++){
    var before=h.counts();
    h.body.dispatch('change',event);
    assert(h.counts().renders === before.renders + 1, 'Form rendered more than once');
    assert(h.counts().synced === before.synced + 1, 'Form synchronized more than once');
  }
  h.close();
  assert(!h.body.oninput && !h.body.onchange && !h.body.onclick, 'Closed form retained handlers');
  h.other('<div id="unrelated"></div>');
  h.body.dispatch('change',event);
  assert(h.counts().synced === 5, 'Game handler leaked into another modal');
});
test('Failed deletion keeps form open and restores controls', function(){
  [null, {ok:false,err:'forbidden'}].forEach(function(response){
    var h=formHarness();h.open();
    var button=h.elements['gm-del'], save=h.elements['gm-save'];
    button.onclick.call(button);
    assert(button.disabled && save.disabled, 'Controls not locked while deleting');
    h.requests[0].cb(response);
    assert(h.modal.className === 'modal', 'Failed deletion closed form');
    assert(h.gm.list !== null && h.counts().reloaded === 0, 'Failure treated as successful deletion');
    assert(!button.disabled && !save.disabled && h.alerts.length === 1, 'Failure not actionable');
  });
});
test('Successful deletion closes its form and refreshes games', function(){
  var h=formHarness();h.open();
  h.elements['gm-del'].onclick.call(h.elements['gm-del']);
  h.requests[0].cb({ok:true});
  assert(h.modal.className === 'modal hide' && h.gm.list === null, 'Success did not close/invalidate');
  assert(h.counts().reloaded === 1, 'Games not refreshed');
});
test('Delayed delete response does not close a newly opened form', function(){
  var h=formHarness();h.open();
  h.elements['gm-del'].onclick.call(h.elements['gm-del']);
  h.close();h.open();h.requests[0].cb({ok:true});
  assert(h.modal.className === 'modal', 'Response closed a different form');
});
return passed;

}
for (const name of run(index, coach)) console.log('PASS ' + name);
