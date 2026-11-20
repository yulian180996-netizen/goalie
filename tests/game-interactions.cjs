'use strict';
// Run: node --test tests/game-interactions.cjs. All data and requests are test doubles.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const coach = fs.readFileSync(path.join(__dirname,'..','coach.html'),'utf8');
const player = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function block(source,start,end){
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a,start); return source.slice(a,b);
}
function element(tagName='DIV'){
  const handlers={};
  return {tagName,style:{},clientWidth:400,textContent:'',
    addEventListener(type,fn){(handlers[type] ||= []).push(fn);},
    fire(type,fields={}){
      const ev={type,button:0,detail:1,preventDefault(){},...fields};
      for(const fn of handlers[type]||[]) fn(ev);
    }
  };
}
function harness(source,extras={}){
  const elements={},frames=new Map(),timers=new Map(); let now=0,id=0;
  const c=vm.createContext({document:{getElementById:k=>elements[k] ||= element()},
    window:{PointerEvent:function(){}},performance:{now:()=>now},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i),
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i),
    setTxt(){},haptic(){},hapticBad(){},...extras});
  vm.runInContext(source,c);
  return {c,elements,frames,timers,at:t=>now=t,
    frame(t){now=t;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(t));},
    timer(){const [i,fn]=timers.entries().next().value;timers.delete(i);fn();}};
}
const press=block(player,'function bindGamePress(',"\ndocument.addEventListener('pointerdown'");
test('Press counts on contact, not again on release; rapid and secondary fingers remain responsive',()=>{
  const {c}=harness(press);let taps=0;const pad=element('BUTTON');
  c.bindGamePress(pad,()=>taps++);c.bindGamePress(pad,()=>taps++);
  pad.fire('pointerdown',{pointerType:'touch'});assert.equal(taps,1);
  pad.fire('pointerup');pad.fire('click');assert.equal(taps,1);
  pad.fire('pointerdown',{pointerType:'touch',isPrimary:false});
  pad.fire('pointerdown');pad.fire('click');assert.equal(taps,3);
  pad.fire('pointerdown',{button:2});assert.equal(taps,3);
  pad.fire('click',{detail:0});assert.equal(taps,4);
});
test('Older touch browsers count changed fingers once and suppress synthetic mouse input',()=>{
  const {c}=harness(press,{window:{}});const pad=element('BUTTON'),hits=[];
  c.bindGamePress(pad,ev=>hits.push(ev.clientX));
  pad.fire('touchstart',{changedTouches:[{clientX:10},{clientX:20}]});
  pad.fire('mousedown');pad.fire('click');assert.deepEqual(hits,[10,20]);
});
test('Twenty alternating tempo presses produce twenty taps and no false ordering errors',()=>{
  const h=harness(press+block(player,'function tmpTap(','\nfunction tmpStart('),
    {TMP:{run:true,md:2,side:'l',taps:[],errs:0}});
  const left=element('BUTTON'),right=element('BUTTON');
  h.c.bindGamePress(left,()=>h.c.tmpTap('l'));h.c.bindGamePress(right,()=>h.c.tmpTap('r'));
  for(let i=0;i<20;i++){h.at(i*50);const p=i%2?right:left;p.fire('pointerdown');p.fire('click');}
  assert.equal(h.c.TMP.taps.length,20);assert.equal(h.c.TMP.errs,0);
});
function reaction(){
  const h=harness(press+block(player,'function gnTap(','\nfunction gnFinish('),{
    GN:{run:true,w:400,h:360,r:28,ok:0,stop:0,aim:0,rts:[],cur:{x:200,y:180,t:50,red:false}},
    gnSpawn(){h.c.GN.cur={x:50,y:50,t:100,red:false};},gnDraw(){}});
  const canvas=element('CANVAS');canvas.getBoundingClientRect=()=>({left:10,top:20,width:200,height:180});
  h.elements['gn-cv']=canvas;h.c.bindGamePress(canvas,h.c.gnTap);h.at(100);
  return {h,canvas,gn:h.c.GN};
}
test('Reaction scales canvas coordinates and does not count the release against a new target',()=>{
  const {canvas,gn}=reaction();canvas.fire('pointerdown',{clientX:110,clientY:110});
  assert.equal(gn.ok,1);assert.equal(gn.rts[0],50);
  canvas.fire('click',{clientX:110,clientY:110});assert.equal(gn.aim,0);
});
test('One red target gives one penalty; taps during an empty interval are ignored',()=>{
  const {canvas,gn}=reaction();gn.cur.red=true;
  canvas.fire('pointerdown',{clientX:110,clientY:110});canvas.fire('pointerdown',{clientX:110,clientY:110});
  assert.equal(gn.stop,1);gn.cur=null;canvas.fire('pointerdown',{clientX:10,clientY:20});assert.equal(gn.aim,0);
  gn.cur={x:200,y:180,red:false};canvas.fire('pointerdown',{clientX:10,clientY:20});assert.equal(gn.aim,1);
});
const cups=block(player,'var CUP = {','/* ═══════════ ПАМЯТЬ 5×5');
test('Cups pass through intermediate positions, retain their ball, and enable answers after motion',()=>{
  const h=harness(cups),c=h.c;
  c.randomValue=0;vm.runInContext('Math.random = () => (++randomValue % 2 ? 0 : 0.75)',c);
  Object.assign(c.CUP,{cn:4,pos:[0,1,2,3],hid:[0],run:true,phase:'mix'});
  c.cupMix(c.CUP_SW[1]-1);const before=h.elements.cup0.style.transform;
  h.frame(310);assert.notEqual(h.elements.cup0.style.transform,before);
  assert.equal(c.CUP.phase,'mix');assert.deepEqual(Array.from(c.CUP.pos),[0,1,2,3]);
  h.frame(620);assert.deepEqual(Array.from(c.CUP.pos),[3,1,2,0]);assert.deepEqual(Array.from(c.CUP.hid),[0]);
  h.timer();assert.equal(c.CUP.phase,'pick');c.cupTap(0);assert.equal(c.CUP.ok,1);
});
test('Stopping cups cancels motion and timers; three through five cups fit the field',()=>{
  const h=harness(cups),c=h.c;Object.assign(c.CUP,{run:true,phase:'mix',pos:[0,1,2,3]});
  c.cupMix(0);c.cupStop();assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  for(const count of [3,4,5]){c.CUP.cn=count;c.cupBuild();
    for(let i=0;i<count;i++){const el=h.elements['cup'+i],x=i*400/count+parseFloat(el.style.left);
      assert.ok(x>=0 && x+parseFloat(el.style.width)<=400);}}
});
const auth=block(coach,'function gateIn(){','/* ───────── навигация');
test('Fresh login waits for the full roster before opening the coach app',async()=>{
  const els={'g-code':{value:'TEST'},'g-err':{textContent:''}},requests=[];let started=0;
  const {c}=harness(auth,{$:id=>els[id],ME:{},ROSTER:[],KEY:'',API_URL:'test',localStorage:{setItem(){}},
    fetch:async()=>({json:async()=>({ok:true,isCoach:true,key:'test-key'})}),
    api:(payload,cb)=>requests.push({payload,cb}),start:()=>started++,gateMode(){}});
  c.gateIn();await new Promise(resolve=>setImmediate(resolve));assert.equal(started,0);
  assert.equal(requests[0].payload.a,'roster');
  requests[0].cb({ok:true,list:[{uid:'test-1',name:'Тестовый вратарь'}]});
  assert.equal(started,1);assert.equal(c.ROSTER[0].uid,'test-1');
});
test('Roster failure leaves login actionable, and retry loads the full roster',()=>{
  const error={textContent:''},requests=[];let started=0,gate=false;
  const {c}=harness(auth,{$:()=>error,ME:{},ROSTER:[],api:(_,cb)=>requests.push(cb),
    start:()=>started++,gateMode:v=>gate=v});
  c.loadCoach();requests.shift()(null);assert.equal(started,0);assert.equal(gate,'retry');
  assert.match(error.textContent,/Не удалось загрузить/);
  c.loadCoach();requests.shift()({ok:true,list:[{uid:'1',name:'A'},{uid:'2',name:'B'}]});
  assert.equal(started,1);assert.equal(c.ROSTER.length,2);
});
