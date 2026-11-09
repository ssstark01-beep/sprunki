/* Child-friendly band and optional timeline share the local source clock and audio engine. */
class SprunkiArranger {
  constructor({catalog,toast,stopPreview,announce=()=>{},cancelAnnouncement=()=>{}}){
    Object.assign(this,{catalog,toast,stopPreview,announce,cancelAnnouncement});
    this.$=id=>document.getElementById(id);
    this.clips=[];this.lanes=4;this.cursor=0;this.selected=null;this.targetLane=null;
    this.generation=0;this.drafts={};this.histories=new Map();this.source=null;
    this.engine=new SprunkiMusicEngine();this.clipNodes=[];this.bandNodes=[];
    this.$('score-play').onclick=()=>this.play();
    this.$('score-stop').onclick=()=>{this.cancelAnnouncement();this.stop();};
    this.$('score-clear').onclick=()=>this.commit(()=>{this.clips=[];this.selected=null;},null,'已清空，点撤销可以找回来');
    this.$('score-undo').onclick=()=>this.undo();
    this.$('score-example').onclick=()=>this.example();
    this.$('score-add-lane').onclick=()=>{if(this.lanes<8)this.commit(()=>this.lanes++);};
    this.$('score-phase').onchange=()=>this.choosePhase(this.$('score-phase').value);
    this.$('score-phase-prev').onclick=()=>this.stepPhase(-1);
    this.$('score-phase-next').onclick=()=>this.stepPhase(1);
    this.$('score-loop').onchange=()=>{if(this.source)this.source.loop=this.$('score-loop').checked;this.save();};
    document.querySelectorAll('[data-score-mode]').forEach(b=>b.onclick=()=>this.changeMode(b.dataset.scoreMode));
    this.resize=new ResizeObserver(()=>{this.timelineWidth=this.$('score-grid').clientWidth-78;});
    this.resize.observe(this.$('score-grid'));
    window.addEventListener('pagehide',()=>{this.stop();clearTimeout(this.idleTimer);this.engine.destroy();if(this.context?.state!=='closed')this.context?.close().catch(()=>{});});
    this.ready=this.init();
  }
  node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
  async init(){
    try{
      const response=await fetch('assets/music-timing.json',{cache:'no-store'});
      if(!response.ok)throw Error('节奏资料尚未准备好');
      this.timing=await response.json();const unique=new Map();
      for(const r of this.catalog.characters)for(const p of r.phases)if(this.timing[p.id])unique.set(p.id,p);
      const number=p=>p.number??Number(p.id.match(/\d+$/)?.[0]);
      this.phases=[...unique.values()].sort((a,b)=>number(a)-number(b));
      this.$('score-phase').replaceChildren(...this.phases.map(p=>new Option(p.name,p.id)));
      let ui={};
      try{this.drafts=JSON.parse(localStorage.getItem('sprunki-web-scores-v1')||'{}');ui=JSON.parse(localStorage.getItem('sprunki-web-workshop-ui-v1')||'{}')||{};}catch{this.drafts={};}
      if(!this.drafts||typeof this.drafts!=='object'||Array.isArray(this.drafts))this.drafts={};
      const existing=this.phases.find(p=>this.drafts[p.id]?.clips?.length);
      this.mode=['band','timeline'].includes(ui.mode)?ui.mode:(existing?'timeline':'band');
      this.changePhase(this.timing[ui.phaseId]?ui.phaseId:existing?.id||this.phases[0].id);
    }catch(error){this.toast(error.message);this.$('score-play').disabled=true;}
  }
  phaseFor(id){return this.catalog.characters.find(r=>r.id===id)?.phases.find(p=>p.id===this.phaseId);}
  roleFor(id){return this.catalog.characters.find(r=>r.id===id);}
  asset(path){return 'assets/'+path.split('/').map(encodeURIComponent).join('/');}
  get period(){return Math.round(this.timing[this.phaseId].period*24000)/24000;}
  get duration(){return Math.max(0,...this.clips.map(c=>c.start+c.length))*this.period;}
  get history(){const key=this.phaseId+':'+this.mode;if(!this.histories.has(key))this.histories.set(key,[]);return this.histories.get(key);}
  snapshot(){return {clips:structuredClone(this.clips),lanes:this.lanes,loop:this.$('score-loop').checked};}
  persistUI(){try{localStorage.setItem('sprunki-web-workshop-ui-v1',JSON.stringify({mode:this.mode,phaseId:this.phaseId}));}catch{}}
  changeMode(mode){if(!this.phaseId||!['band','timeline'].includes(mode)||mode===this.mode)return;this.cancelAnnouncement();this.save();this.mode=mode;this.changePhase(this.phaseId);}
  choosePhase(id){this.cancelAnnouncement();this.changePhase(id);this.announce(null,this.phases.find(p=>p.id===this.phaseId));}
  stepPhase(direction){if(!this.phases)return;const index=this.phases.findIndex(p=>p.id===this.phaseId),p=this.phases[index+direction];if(p)this.choosePhase(p.id);}
  changePhase(id){
    if(!this.timing?.[id])return;
    this.stop();this.phaseId=id;this.$('score-phase').value=id;
    const draft=this.drafts[id];this.clips=[];this.selected=null;this.cursor=0;this.targetLane=null;
    this.lanes=Number.isInteger(draft?.lanes)?Math.max(4,Math.min(8,draft.lanes)):4;
    if(this.mode==='band'){
      const roles=Array.isArray(draft?.band)?[...new Set(draft.band)].filter(id=>this.phaseFor(id)?.audio_files?.length).slice(0,8):[];
      this.clips=roles.map((roleId,lane)=>({id:crypto.randomUUID(),roleId,lane,start:0,length:4}));
      this.lanes=Math.max(4,this.clips.length);this.$('score-loop').checked=draft?.bandLoop!==false;
    }else{
      if(Array.isArray(draft?.clips))for(const c of draft.clips.slice(0,32)){
        if(this.phaseFor(c.roleId)?.audio_files?.length&&Number.isInteger(c.lane)&&c.lane>=0&&c.lane<this.lanes&&Number.isInteger(c.start)&&c.start>=0&&Number.isInteger(c.length)&&c.length>0&&c.start+c.length<=8&&this.free(c.lane,c.start,c.length))this.clips.push({...c,id:crypto.randomUUID()});
      }
      this.$('score-loop').checked=!!draft?.timelineLoop;
    }
    this.persistUI();this.draw();this.warm();
  }
  save(){
    if(!this.phaseId)return;
    const previous=this.drafts[this.phaseId]||{};
    this.drafts[this.phaseId]=this.mode==='band'?{...previous,band:this.clips.map(c=>c.roleId),bandLoop:this.$('score-loop').checked}:{...previous,lanes:this.lanes,clips:this.clips.map(({roleId,lane,start,length})=>({roleId,lane,start,length})),timelineLoop:this.$('score-loop').checked};
    try{localStorage.setItem('sprunki-web-scores-v1',JSON.stringify(this.drafts));}catch{this.toast('浏览器未能保存，当前仍可播放');}
  }
  warm(){if(!this.$('workshop').classList.contains('hidden'))this.engine.warm(this.clips.map(c=>this.asset('audio/'+this.phaseFor(c.roleId).audio_files[0])));}
  commit(action,roleToAnnounce=null,message){
    const resume=this.mode==='band'&&(roleToAnnounce||this.playing||this.busy||this.resumeAfterEdit);
    this.cancelAnnouncement();this.stop();this.history.push(this.snapshot());if(this.history.length>20)this.history.shift();
    action();this.resumeAfterEdit=resume&&!!this.clips.length;this.save();this.draw();this.warm();
    const intro=roleToAnnounce?this.announce(this.roleFor(roleToAnnounce),this.phaseFor(roleToAnnounce)):null;
    if(message)this.toast(message);
    if(this.resumeAfterEdit){const generation=this.generation;Promise.resolve(intro).then(()=>{if(generation===this.generation&&this.resumeAfterEdit)this.play();});}
  }
  undo(){
    const previous=this.history.pop();if(!previous)return;
    this.cancelAnnouncement();this.stop();this.clips=previous.clips;this.lanes=previous.lanes;this.$('score-loop').checked=previous.loop;
    this.selected=null;this.save();this.draw();this.warm();this.toast('已经恢复上一步');
  }
  free(lane,start,length,except){return !this.clips.some(c=>c.id!==except&&c.lane===lane&&start<c.start+c.length&&start+length>c.start);}
  add(roleId,lane,start){
    if(!this.phaseFor(roleId)?.audio_files?.length){this.toast('这个阶段暂时没有这位伙伴的音轨');return;}
    if(this.mode==='band'){
      const exists=this.clips.some(c=>c.roleId===roleId);
      if(!exists&&this.clips.length>=8){this.toast('乐队已经坐满啦，先点一位伙伴让他休息');return;}
      this.commit(()=>{
        if(!exists)this.$('score-loop').checked=true;
        this.clips=exists?this.clips.filter(c=>c.roleId!==roleId):[...this.clips,{id:crypto.randomUUID(),roleId,start:0,length:4}];
        this.clips.forEach((c,i)=>c.lane=i);this.lanes=Math.max(4,this.clips.length);
      },exists?null:roleId);return;
    }
    if(this.clips.length>=32){this.toast('这首歌已经有很多音块啦，先移除一个');return;}
    start??=this.cursor;const length=Math.min(2,8-start);lane??=this.targetLane;
    if(lane===null||lane===undefined)lane=Array.from({length:this.lanes},(_,i)=>i).find(i=>this.free(i,start,length));
    if(lane===undefined&&this.lanes<8)lane=this.lanes;
    if(lane===undefined||!this.free(lane,start,length)){this.toast('这里已经有伙伴啦，点一下其他空格再添加');return;}
    this.commit(()=>{this.lanes=Math.max(this.lanes,lane+1);const clip={id:crypto.randomUUID(),roleId,lane,start,length};this.clips.push(clip);this.selected=clip.id;if(this.targetLane!==null)this.targetLane=Array.from({length:this.lanes},(_,i)=>i).find(i=>this.free(i,start,length))??null;},roleId);
  }
  async addCurrent(roleId,phaseId){await this.ready;if(!this.timing?.[phaseId]){this.toast('这个阶段的节奏尚未收录');return;}if(phaseId!==this.phaseId)this.changePhase(phaseId);if(this.mode==='band'&&this.clips.some(c=>c.roleId===roleId)){this.announce(this.roleFor(roleId),this.phaseFor(roleId));return;}this.add(roleId);}
  example(){
    if(!this.phaseId)return;
    const available=this.catalog.characters.filter(r=>this.phaseFor(r.id)?.audio_files?.length);
    const chosen=['oren','raddy','mr-sun'].map(id=>available.find(r=>r.id===id)).filter(Boolean);
    for(const r of available)if(chosen.length<3&&!chosen.includes(r))chosen.push(r);
    this.commit(()=>{this.lanes=4;this.cursor=0;this.targetLane=null;this.selected=null;this.clips=chosen.map((r,i)=>({id:crypto.randomUUID(),roleId:r.id,lane:i,start:this.mode==='timeline'&&i===2?2:0,length:this.mode==='band'?4:i===2?2:4}));},null,'示范已准备好，点播放听听，再换上你喜欢的伙伴');
  }
  drag(event,payload){event.dataTransfer.setData('application/x-sprunki',JSON.stringify(payload));event.dataTransfer.effectAllowed=payload.clipId?'move':'copy';}
  drop(event,lane){
    event.preventDefault();event.currentTarget.classList.remove('drop-ready');let payload;
    try{payload=JSON.parse(event.dataTransfer.getData('application/x-sprunki'));}catch{return;}
    if(payload.phaseId!==this.phaseId)return;
    const rect=event.currentTarget.getBoundingClientRect(),start=Math.max(0,Math.min(7,Math.floor((event.clientX-rect.left)/rect.width*8)));
    if(payload.clipId){
      const clip=this.clips.find(c=>c.id===payload.clipId);if(!clip)return;const length=Math.min(clip.length,8-start);
      if(!this.free(lane,start,length,clip.id)){this.toast('这里已经有伙伴啦，换个位置');return;}
      this.commit(()=>{Object.assign(clip,{lane,start,length});this.selected=clip.id;});
    }else if(payload.roleId)this.add(payload.roleId,lane,start);
  }
  drawShelf(){
    if(this.shelfPhase===this.phaseId&&this.shelfMode===this.mode)return;
    this.shelfPhase=this.phaseId;this.shelfMode=this.mode;this.shelfButtons=new Map();
    const shelf=this.$('sound-shelf');shelf.replaceChildren();
    const candidates=this.catalog.characters.filter(r=>this.phaseFor(r.id));
    for(const r of candidates){
      const p=this.phaseFor(r.id),b=this.node('button','sound-card');b.dataset.role=r.id;b.disabled=!p.audio_files?.length;b.draggable=this.mode==='timeline'&&!b.disabled;
      b.title=b.disabled?'暂未收录独立音轨':this.mode==='band'?'点一下加入，再点一下休息':'点一下加入空格，也可以拖动头像';
      const image=this.node('img');image.src=this.asset(p.asset);image.alt='';image.draggable=false;
      const mark=this.node('span','add-mark','+');mark.setAttribute('aria-hidden','true');b.append(image,this.node('strong','',r.name),mark);
      b.onclick=()=>this.add(r.id);b.ondragstart=e=>this.drag(e,{roleId:r.id,phaseId:this.phaseId});
      this.shelfButtons.set(r.id,b);shelf.append(b);
    }
    this.$('shelf-count').textContent=candidates.filter(r=>this.phaseFor(r.id).audio_files?.length).length+' 位伙伴';
  }
  draw(){
    if(!this.phaseId)return;
    const band=this.mode==='band';this.$('workshop').dataset.scoreMode=this.mode;
    document.querySelectorAll('[data-score-mode]').forEach(b=>{const selected=b.dataset.scoreMode===this.mode;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    this.$('band-stage').hidden=!band;this.$('timeline-editor').hidden=band;
    this.$('workshop-intro').textContent=band?'点头像，伙伴就会自动加入循环演奏。':'先点空格，再点伙伴；也可以拖动头像，安排谁先出场。';
    this.$('shelf-help').textContent=band?'点一下加入，亮起的头像再点一下就休息。':'点空格 → 点伙伴；同一竖列的伙伴一起演奏。';
    const index=this.phases.findIndex(p=>p.id===this.phaseId);
    this.$('score-phase-prev').disabled=index===0;this.$('score-phase-next').disabled=index===this.phases.length-1;
    this.drawShelf();
    for(const [roleId,b]of this.shelfButtons){const count=this.clips.filter(c=>c.roleId===roleId).length;b.classList.toggle('chosen',count>0);b.setAttribute('aria-pressed',String(count>0));b.setAttribute('aria-label',(band&&count?'移除 ':'添加 ')+this.roleFor(roleId).name);b.querySelector('.add-mark').textContent=count?(band?'✓':count):'+';}
    this.$('score-clear').textContent=band?'清空乐队':'清空这一首';this.$('score-clear').disabled=!this.clips.length;
    this.$('score-undo').disabled=!this.history.length;
    this.$('score-summary').textContent=(band?this.clips.length+' / 8 位伙伴':this.clips.length+' 个音块 · '+this.duration.toFixed(1)+' 秒')+' · 已自动保存';
    this.$('score-help').textContent=band?'播放时也能换伙伴，会自动继续演奏。两个玩法的作品分别保存，随时可以切回来。':'横向移动决定出场时间；点音块可改长短。手机可左右滑动时间轴。作品自动保存在这台浏览器。';
    if(band)this.drawBand();else this.bandNodes=[];
    this.drawTimeline();this.drawDetails();this.updateControls();this.updateTime();
  }
  drawBand(){
    const stage=this.$('band-members');stage.replaceChildren();this.bandNodes=[];
    this.$('band-title').textContent=this.clips.length?'我的小乐队':'谁来参加你的乐队？';
    this.$('band-empty').hidden=!!this.clips.length;
    for(let i=0;i<8;i++){
      const clip=this.clips[i],b=this.node('button','band-member'+(clip?'':' empty'));
      if(clip){const role=this.roleFor(clip.roleId),image=this.node('img');image.src=this.asset(this.phaseFor(role.id).asset);image.alt='';image.draggable=false;
        b.append(image,this.node('strong','',role.name),this.node('span','member-remove','×'));b.setAttribute('aria-label','让 '+role.name+' 休息');b.onclick=()=>this.add(role.id);this.bandNodes.push(b);
      }else{b.append(this.node('span','member-note','♪'),this.node('span','','等你来'));b.setAttribute('aria-label','选择一位伙伴加入');b.onclick=()=>{this.$('sound-shelf').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});this.$('sound-shelf').querySelector('button:not(:disabled)')?.focus({preventScroll:true});};}
      stage.append(b);
    }
  }
  selectCursor(start,lane=null){this.cursor=start;this.targetLane=lane;this.updateCursor();this.$('score-flow').textContent='已选第 '+(start+1)+' 段，点头像把伙伴放进来';}
  updateCursor(){
    this.$('score-ruler').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('active',i===this.cursor));
    this.$('score-lanes').querySelectorAll('.insertion-marker').forEach(n=>n.remove());
    if(this.targetLane!==null){const lane=this.$('score-lanes').children[this.targetLane];if(lane){const marker=this.node('span','insertion-marker');marker.style.left=(this.cursor*12.5)+'%';lane.append(marker);}}
  }
  drawTimeline(){
    if(this.mode!=='timeline'){this.clipNodes=[];return;}
    const ruler=this.$('score-ruler');ruler.replaceChildren();
    for(let i=0;i<8;i++){const b=this.node('button','','第 '+(i+1)+' 段');b.append(this.node('span','',(i*this.period).toFixed(1)+'s'));b.onclick=()=>this.selectCursor(i);ruler.append(b);}
    const lanes=this.$('score-lanes');lanes.replaceChildren();this.clipNodes=[];
    for(let i=0;i<this.lanes;i++){
      const lane=this.node('div','score-lane');lane.dataset.number=i+1;lane.dataset.lane=i;lane.setAttribute('aria-label','轨道 '+(i+1));
      lane.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-sprunki')){e.preventDefault();lane.classList.add('drop-ready');}};lane.ondragleave=()=>lane.classList.remove('drop-ready');lane.ondrop=e=>this.drop(e,i);
      lane.onclick=e=>{const rect=lane.getBoundingClientRect();this.selectCursor(Math.max(0,Math.min(7,Math.floor((e.clientX-rect.left)/rect.width*8))),i);};
      if(!this.clips.some(c=>c.lane===i))lane.append(this.node('span','score-empty','点空格，选伙伴'));
      for(const c of this.clips.filter(c=>c.lane===i)){
        const role=this.roleFor(c.roleId),b=this.node('button','music-clip'+(this.selected===c.id?' selected':''));b.dataset.clip=c.id;b.draggable=true;b.style.left=(c.start*12.5)+'%';b.style.width=(c.length*12.5)+'%';
        b.setAttribute('aria-label',role.name+' · '+(c.start*this.period).toFixed(1)+'秒开始');
        const image=this.node('img');image.src=this.asset(this.phaseFor(c.roleId).asset);image.alt='';image.draggable=false;
        const text=this.node('span');text.append(this.node('b','',role.name),this.node('small','',c.length+' 段'));b.append(image,text);
        b.onclick=e=>{e.stopPropagation();this.selected=c.id;this.clipNodes.forEach(v=>v.node.classList.toggle('selected',v.id===c.id));this.drawDetails();};
        b.ondragstart=e=>this.drag(e,{clipId:c.id,phaseId:this.phaseId});lane.append(b);this.clipNodes.push({node:b,id:c.id,start:c.start*this.period,end:(c.start+c.length)*this.period});
      }
      lanes.append(lane);
    }
    this.$('score-add-lane').disabled=this.lanes>=8;this.updateCursor();
  }
  drawDetails(){
    if(this.mode!=='timeline')return;const details=this.$('score-details');details.replaceChildren();const c=this.clips.find(c=>c.id===this.selected);
    if(!c){details.textContent='点一个音块，调整开始时间、演奏长度，或者移除。';return;}
    details.append(this.node('strong','',this.roleFor(c.roleId).name));
    const edit=changes=>{const next={...c,...changes};next.length=Math.min(next.length,8-next.start);if(!this.free(next.lane,next.start,next.length,c.id)){this.toast('这里已经有伙伴啦，换一个空格');this.drawDetails();return;}this.commit(()=>Object.assign(c,next));};
    const addSelect=(text,values,current,onchange)=>{const label=this.node('label','',text),select=this.node('select');select.setAttribute('aria-label',text);select.append(...values.map(([value,name])=>new Option(name,String(value))));select.value=current;select.onchange=()=>onchange(Number(select.value));label.append(select);details.append(label);};
    addSelect('开始',Array.from({length:8},(_,i)=>[i,'第 '+(i+1)+' 段']),c.start,start=>edit({start}));
    addSelect('演奏',Array.from({length:8-c.start},(_,i)=>[i+1,(i+1)+' 段']),c.length,length=>edit({length}));
    addSelect('轨道',Array.from({length:this.lanes},(_,i)=>[i,i+1]),c.lane,lane=>edit({lane}));
    const remove=this.node('button','remove-clip','× 移除');remove.setAttribute('aria-label','移除此音块');remove.onclick=()=>this.commit(()=>{this.clips=this.clips.filter(v=>v!==c);this.selected=null;});details.append(remove);
  }
  updateControls(label){
    if(!this.phaseId)return;
    this.$('score-play').disabled=!this.clips.length||this.busy;
    this.$('score-play-label').textContent=label||(this.playing?'从头播放':this.mode==='band'?'一起演奏':'播放我的音乐');
    this.$('score-flow').textContent=this.busy?'伙伴们正在准备声音…':this.resumeAfterEdit?'正在介绍新伙伴，马上循环演奏':this.playing?'正在演奏，点停止就能休息':!this.clips.length?'点喜欢的头像，自动开始演奏':this.mode==='band'?'已暂停，点头像或紫色按钮继续演奏':'已经排好了，按紫色大按钮听听';
  }
  async play(){
    if(!this.clips.length||this.busy)return;
    this.stop();this.stopPreview();const generation=this.generation,began=performance.now();
    const score={phaseId:this.phaseId,period:this.period,clips:this.clips.map(c=>({...c,path:this.asset('audio/'+this.phaseFor(c.roleId).audio_files[0])}))};
    clearTimeout(this.idleTimer);
    if(!this.context||this.context.state==='closed')this.context=new AudioContext({sampleRate:24000});
    this.busy=true;this.updateControls('准备音乐…');
    try{
      await this.context.resume();
      if(generation!==this.generation)return;
      const result=await this.engine.render(score,this.context,(loaded,total)=>{if(generation===this.generation)this.updateControls('准备声音 '+loaded+'/'+total);});
      if(generation!==this.generation)return;
      this.lastRender=result.report;this.lastPlay={readyMs:performance.now()-began,cacheHit:result.cacheHit,copyMs:result.copyMs};
      this.source=this.context.createBufferSource();this.source.buffer=result.buffer;this.source.loop=this.$('score-loop').checked;this.source.connect(this.context.destination);
      this.startedAt=this.context.currentTime+.03;this.source.start(this.startedAt);this.playing=true;this.busy=false;this.updateControls();
      this.source.onended=()=>{if(generation===this.generation)this.stop();};
      this.lastUiTick=0;const animate=time=>{if(!this.playing)return;if(time-this.lastUiTick>=50&&!document.hidden){this.lastUiTick=time;this.updateTime();}this.animation=requestAnimationFrame(animate);};this.animation=requestAnimationFrame(animate);
    }catch(error){if(generation===this.generation&&error.name!=='AbortError')this.toast(error.message||'声音没准备好，请再试一次');}
    finally{if(generation===this.generation){this.busy=false;this.updateControls();}}
  }
  stop(){
    this.generation++;this.engine.cancel();this.busy=false;this.playing=false;this.resumeAfterEdit=false;
    if(this.source){this.source.onended=null;try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}
    cancelAnimationFrame(this.animation);this.updateControls();this.updateTime();
    clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>{if(!this.playing&&!this.busy&&this.context?.state==='running')this.context.suspend().catch(()=>{});},30000);
  }
  updateTime(){
    if(!this.timing?.[this.phaseId])return;
    const elapsed=this.playing?Math.max(0,this.context.currentTime-this.startedAt):0;
    const time=this.playing&&(this.source?.loop||elapsed>this.duration)?elapsed%this.duration:Math.min(elapsed,this.duration);
    const text=time.toFixed(1)+' / '+this.duration.toFixed(1)+'s';if(this.$('score-time').textContent!==text)this.$('score-time').textContent=text;
    const head=this.$('score-playhead');head.style.display=this.playing&&this.mode==='timeline'?'block':'none';head.style.left='64px';head.style.transform='translateX('+((this.timelineWidth||822)*time/(8*this.period))+'px)';
    for(const item of this.clipNodes){const active=!!(this.playing&&time>=item.start&&time<item.end);if(item.node.classList.contains('sounding')!==active)item.node.classList.toggle('sounding',active);}
    for(const node of this.bandNodes)if(node.classList.contains('sounding')!==!!this.playing)node.classList.toggle('sounding',!!this.playing);
  }
}
window.SprunkiArranger=SprunkiArranger;
