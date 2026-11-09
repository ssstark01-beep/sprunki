'use strict';
const originalRoles=[
{id:'peashooter',name:'豌豆射手',en:'Peashooter',type:'plant',job:'远程小帮手',intro:'把豌豆沿着自己所在的一行向前发射。',states:[['平常','沿着一行发射豌豆。'],['能量豆技能','短时间内快速发射一串豌豆。这是技能发动，不是永久变成另一个角色。']],question:'它能直接照顾旁边一行吗？',answer:'通常不行。观察它面向的那一行，就知道它的基本范围了。'},
{id:'sunflower',name:'向日葵',en:'Sunflower',type:'plant',job:'阳光收集员',intro:'定期产出阳光，让你有资源种下更多植物。',states:[['平常','隔一会儿产出阳光，帮助花园准备资源。'],['能量豆技能','立即产出一批额外阳光。技能结束后，继续平常的工作。']],question:'不发射豌豆，也能帮助大家吗？',answer:'当然！准备资源也是重要的本领。游戏中的阳光是资源，这不是现实植物会掉落的小太阳。'},
{id:'wallnut',name:'坚果',en:'Wall-nut',type:'plant',job:'防守好伙伴',intro:'用结实的身体阻挡前进的僵尸，为后面的植物争取时间。',states:[['平常','站在原地保护后方的伙伴，本身不发射豌豆。'],['能量豆护甲','恢复自身耐久，并获得额外的金属护甲。护甲能继续承受伤害，直到被消耗。']],question:'坚果和豌豆射手，长处一样吗？',answer:'不一样。一个擅长阻挡，一个擅长远程攻击。它们可以互相配合。'},
{id:'basic',name:'普通僵尸',en:'Basic Zombie',type:'zombie',job:'认识基础类型',intro:'向植物所在的方向前进，遇到植物时会啃咬。这里用温和的 AI 改编插画来观察。',states:[['基础样子','没有路障或铁桶保护，是认识这些僵尸的基础类型。']],question:'没有帽子，就是还没升级吗？',answer:'不是。普通僵尸本来就是一种类型，不必依次升级成路障、铁桶僵尸。'},
{id:'cone',name:'路障僵尸',en:'Conehead Zombie',type:'zombie',job:'路障保护头顶',intro:'和普通僵尸一样向前走，但头上的路障提供额外保护。',states:[['有路障','路障能先替它承受一部分伤害。'],['路障耗尽后','失去路障的额外保护，仍可以继续前进。这里省略破损和受伤画面。']],question:'这顶帽子只为了好看吗？',answer:'不是。路障有防护作用。现实中不要把路障戴在头上哦。'},
{id:'bucket',name:'铁桶僵尸',en:'Buckethead Zombie',type:'zombie',job:'铁桶更加结实',intro:'头上的铁桶比路障提供更多保护，需要花更多工夫应对。',states:[['有铁桶','铁桶带来更强的额外防护。它是独立类型，不是路障的下一阶段。'],['铁桶耗尽后','铁桶保护消失后，仍可以继续前进。示意只移除装备，不表现伤害。']],question:'保护更多，就代表走得更快吗？',answer:'不是同一件事。防护和速度是不同的特点，不能只看帽子就判断速度。'}
];
const roles=plantCatalog.map(p=>({...p,...(originalRoles.find(r=>r.en===p.en)||{})})).concat(originalRoles.filter(r=>r.type==='zombie'));
const $=s=>document.querySelector(s);let selected=roles[0],state=0,filter='all';
let dialogTrigger=null,activeDialog=null,lockedScroll=0,previousBodyTop='';
function art(id,active=false,card=false){
 if(!roles.find(r=>r.id===id)?.asset&&!['basic','cone','bucket'].includes(id)){const r=roles.find(r=>r.id===id);return card?`<span class="art-pending text-card"><small>本领笔记 · 插画待补</small><span>${r.intro}</span></span>`:'<span class="art-pending">角色图待补 · 先读本领笔记</span>';}
 const asset=active&&id==='wallnut'?'wallnut-armor':active&&['cone','bucket'].includes(id)?'basic':id;
 const role=roles.find(r=>r.id===id),name=role?.name||id,credit=role?.imageCredit||'AI 原创改编插画';
 return `<img class="character-image" src="pvz-assets/${card?'thumbs/':''}${role?.imageFile||asset+'.png'}" alt="${name} · ${credit}" width="1254" height="1254" decoding="async" loading="lazy">`;
}
function mediaMatch(r,ready){const v=videoChapters[r.id];if(!ready)return true;if(ready==='art')return r.asset||r.type==='zombie';if(ready==='missing-art')return r.type==='plant'&&!r.asset;if(ready==='missing-video')return r.type==='plant'&&!v;if(ready==='video')return !!v;if(ready==='gameplay')return !!v&&v.kind!=='official_animation';if(ready==='animation')return v?.kind==='official_animation'||!!v?.secondaryAnimation;return !r.asset||!v;}
const searchAliases={'twin-sunflower':'双子向日葵 双胞向日葵','split-pea':'裂荚射手 双向射手','spikerock':'钢地刺 地刺王','magnifying-grass':'棱镜草 放大草','bowling-bulb':'保龄泡泡 保龄球茎','hypno-shroom':'魅惑菇 迷糊菇','bonk-choy':'菜问 拳击白菜'};
function cards(){const q=$('#search').value.trim().toLowerCase(),world=$('#world').value,ready=$('#ready').value,list=roles.filter(r=>(filter==='all'||r.type===filter)&&(!world||r.world===world)&&mediaMatch(r,ready)&&`${r.name} ${r.en} ${r.job} ${r.world||''} ${searchAliases[r.id]||''}`.toLowerCase().includes(q));$('#count').textContent=`${list.length} 位伙伴`;$('#filter-result').textContent=`找到 ${list.length} 位伙伴`;$('#apply-filters').textContent=`查看 ${list.length} 位伙伴`;const activeFilters=Number(!!world)+Number(!!ready);$('#filter-badge').textContent=activeFilters?`· ${activeFilters} 项已选`:'';$('#open-filters').classList.toggle('has-filters',activeFilters>0);$('#empty').hidden=!!list.length;$('#cards').innerHTML=list.map(r=>`<button class="role-card" data-role="${r.id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="detail">${art(r.id,false,true)}<b>${r.name}</b><small>${r.en}</small></button>`).join('');}
function videoInfo(){const v=videoChapters[selected.id];$('#video-info').innerHTML=v?`<span class="media-status">${v.kind==='official_animation'?'官方宣传动画':'有游戏实况'}</span><b>${v.kind==='official_animation'?'看'+selected.name+'的官方宣传动画':'看真实游戏里的'+v.topic}</b><a class="video-link" href="https://www.youtube.com/watch?v=${v.videoId}&t=${v.start}s" target="_blank" rel="noopener noreferrer">▶ 打开原视频 · ${v.label} ↗</a><small>${v.author} · ${v.year} 年 ${v.version}<br>${v.kind==='official_animation'?'这是宣传动画，不是普通技能或能量豆的实机证明。':'旧版实况可能与当前规则不同；不是当前静态插画的动画。'}<br>外部 YouTube 页面，建议家长陪看，广告与推荐内容不由本站控制。</small>`:'<b>这位伙伴暂未收录实况片段</b><small>尚未核实适合本页的对应视频。先看角色与装备介绍，不用自制动画冒充游戏实况。</small>';if(v?.secondaryAnimation){const a=v.secondaryAnimation;$('#video-info').innerHTML+=`<a class="video-link" href="https://www.youtube.com/watch?v=${a.videoId}&t=${a.start}s" target="_blank" rel="noopener noreferrer">另看官方宣传动画 · ${a.label} ↗</a><small>宣传动画不是实际玩法，不作为技能证明。</small>`;}}
function render(){videoInfo();$('.stage-label').textContent=selected.asset||selected.type==='zombie'?'角色观察窗 · '+(selected.imageCredit||'AI 原创改编插画'):'角色观察窗 · 图片待补';$('#role-tag').textContent=selected.type==='plant'?'PLANTS / 植物伙伴':'ZOMBIES / 僵尸来客';$('#role-title').textContent=selected.name;$('#role-en').textContent=selected.en;$('#role-world').textContent=selected.world||selected.job;$('#intro').textContent=selected.intro;$('#role-source').href=selected.source||'https://plantsvszombies.wiki.gg/wiki/Zombies_(PvZ2)';$('.states').innerHTML=selected.states.map((s,i)=>`<button data-state="${i}" aria-pressed="${i===state}">${s[0]}</button>`).join('');$('#state-title').textContent=selected.states[state][0];$('#state-text').textContent=selected.states[state][1];$('#question').textContent=selected.question;$('#answer').textContent=selected.answer;$('.tip details').open=false;$('#scene').innerHTML=art(selected.id,!!state);$('#scene').dataset.kind=selected.id;$('#scene-caption').textContent=selected.name+' · '+selected.states[state][0];$('#image-source').hidden=!selected.imageSource;$('#image-source').href=selected.imageSource||'#';}
function showDialog(dialog,trigger){
 if(activeDialog?.open)return;
 activeDialog=dialog;dialogTrigger=trigger;lockedScroll=window.scrollY;previousBodyTop=document.body.style.top;
 document.body.style.top=`-${lockedScroll}px`;document.body.classList.add('modal-open');
 trigger.setAttribute('aria-expanded','true');dialog.showModal();dialog.scrollTop=0;
 dialog.querySelector('[data-dialog-close]').focus({preventScroll:true});
}
function openDetails(role,trigger){selected=role;state=0;render();showDialog($('#detail'),trigger);}
$('#cards').addEventListener('click',e=>{
 const button=e.target.closest('[data-role]');if(!button)return;
 const role=roles.find(r=>r.id===button.dataset.role);if(role)openDetails(role,button);
});
$('#open-filters').addEventListener('click',e=>showDialog($('#filter-dialog'),e.currentTarget));
for(const dialog of document.querySelectorAll('dialog')){
 for(const close of dialog.querySelectorAll('[data-dialog-close]'))close.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{
  if(activeDialog!==dialog)return;
  document.body.classList.remove('modal-open');document.body.style.top=previousBodyTop;
  window.scrollTo({top:lockedScroll,behavior:'auto'});
  if(dialogTrigger?.isConnected){dialogTrigger.setAttribute('aria-expanded','false');dialogTrigger.focus({preventScroll:true});}
  activeDialog=null;
 });
 let backdropPointer=false;
 const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)};
 dialog.addEventListener('pointerdown',e=>{backdropPointer=outside(e)});
 dialog.addEventListener('click',e=>{if(backdropPointer&&outside(e))dialog.close();backdropPointer=false});
}
document.addEventListener('keydown',event=>{
 if(event.key!=='Tab'||!activeDialog?.open)return;
 const focusable=[...activeDialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length&&!el.closest('[hidden],[inert]')&&getComputedStyle(el).visibility!=='hidden');
 if(!focusable.length){event.preventDefault();return;}
 const first=focusable[0],last=focusable[focusable.length-1],current=document.activeElement;
 if(event.shiftKey&&(current===first||!activeDialog.contains(current))){event.preventDefault();last.focus({preventScroll:false});}
 else if(!event.shiftKey&&(current===last||!activeDialog.contains(current))){event.preventDefault();first.focus({preventScroll:false});}
},true);
$('#reset-filters').addEventListener('click',()=>{$('#world').value='';$('#ready').value='';cards()});
$('.states').addEventListener('click',e=>{const b=e.target.closest('[data-state]');if(!b)return;state=Number(b.dataset.state);render();document.querySelector(`[data-state="${state}"]`).focus({preventScroll:true})});
$('.filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',x===b));cards()});
$('#search').addEventListener('input',cards);
const worldSelect=$('#world');
[...new Set(plantCatalog.map(r=>r.world))].forEach(w=>{const o=document.createElement('option');o.value=w;o.textContent=w;worldSelect.append(o)});
for(const id of ['#world','#ready'])$(id).addEventListener('change',cards);
$('#hero-plant').innerHTML=art('sunflower');cards();render();
$('#progress').textContent=`植物名录 217 条：216 种战斗植物 + 园艺金盏花。已整理技能摘要 ${plantCatalog.filter(r=>r.verified).length} / 217，植物配图 ${plantCatalog.filter(r=>r.asset).length} / 217，技能实况 ${Object.values(videoChapters).filter(v=>v.kind!=='official_animation').length} / 217，另有 ${Object.values(videoChapters).filter(v=>v.kind==='official_animation'||v.secondaryAnimation).length} 种官方宣传动画（不计实况）。全部条目一次展示，图片按需加载；名称收录不代表图文视频已齐全。`;
