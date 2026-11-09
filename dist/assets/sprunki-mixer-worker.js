/* PCM loading and mixing stay off the UI thread. Source WAVs are local 24 kHz mono. */
const RATE = 24000, CACHE_LIMIT = 32 * 1024 * 1024;
const pcmCache = new Map(), pending = new Map(), queue = [];
let cacheBytes = 0, activeFetches = 0, current = null;
const totals = {fetches:0, hits:0, mixes:0, evictions:0, maxFetches:0};
const channel=new MessageChannel(), yields=[];
channel.port1.onmessage=()=>yields.shift()?.();
const tick=()=>new Promise(resolve=>{yields.push(resolve);channel.port2.postMessage(0);});

function pcmFromWav(raw) {
  const view = new DataView(raw), tag = offset => String.fromCharCode(...new Uint8Array(raw,offset,4));
  if(raw.byteLength<44 || tag(0)!=='RIFF' || tag(8)!=='WAVE')throw Error('音轨格式不正确');
  let format, start, size;
  for(let offset=12;offset+8<=raw.byteLength;){
    const length=view.getUint32(offset+4,true), end=offset+8+length;
    if(end>raw.byteLength)throw Error('音轨文件不完整');
    if(tag(offset)==='fmt '&&length>=16)format={codec:view.getUint16(offset+8,true),channels:view.getUint16(offset+10,true),rate:view.getUint32(offset+12,true),bits:view.getUint16(offset+22,true)};
    if(tag(offset)==='data'){start=offset+8;size=length;}
    offset=end+(length%2);
  }
  if(!format || format.codec!==1 || format.channels!==1 || format.rate!==RATE || format.bits!==16 || !size || size%2)throw Error('这段音轨还不能用于合奏');
  const pcm=new Float32Array(size/2);
  for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(start+i*2,true)/32768;
  return pcm;
}
function trim() {
  while(cacheBytes>CACHE_LIMIT&&pcmCache.size>1){const [key,pcm]=pcmCache.entries().next().value;pcmCache.delete(key);cacheBytes-=pcm.byteLength;totals.evictions++;}
}
function pump() {
  while(activeFetches<3&&queue.length){
    const task=queue.shift();activeFetches++;totals.maxFetches=Math.max(totals.maxFetches,activeFetches);
    (async()=>{
      try{
        totals.fetches++;
        const response=await fetch(task.path);
        if(!response.ok)throw Error('有一位伙伴的声音没加载好，请再试一次');
        const pcm=pcmFromWav(await response.arrayBuffer());
        if(pcm.byteLength>CACHE_LIMIT)throw Error('这段音轨太长了，请选择其他伙伴');
        pcmCache.set(task.path,pcm);cacheBytes+=pcm.byteLength;trim();task.resolve(pcm);
      }catch(error){task.reject(error);}finally{pending.delete(task.path);activeFetches--;pump();}
    })();
  }
}
function load(path) {
  const url=new URL(path,self.location.href);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./audio/',self.location.href).pathname))return Promise.reject(Error('音轨地址不正确'));
  if(pcmCache.has(path)){const pcm=pcmCache.get(path);pcmCache.delete(path);pcmCache.set(path,pcm);totals.hits++;return Promise.resolve(pcm);}
  if(pending.has(path))return pending.get(path);
  const promise=new Promise((resolve,reject)=>{queue.push({path,resolve,reject});});
  pending.set(path,promise);pump();return promise;
}
function stats(){return {...totals,cacheBytes,cacheLimit:CACHE_LIMIT,cachedTracks:pcmCache.size,activeFetches,queuedFetches:queue.length};}
async function render(job) {
  const began=performance.now(), clock=Math.round(job.period*RATE);
  if(!Number.isFinite(clock)||clock<RATE||clock>RATE*12||!Array.isArray(job.clips)||job.clips.length>32||!job.clips.length)throw Error('这首歌的节奏资料不正确');
  for(const c of job.clips)if(!Number.isInteger(c.start)||!Number.isInteger(c.length)||c.start<0||c.length<1||c.start+c.length>8)throw Error('音块位置不正确');
  const paths=[...new Set(job.clips.map(c=>c.path))], buffers=new Map();let loaded=0;
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,paths.length)},async()=>{
    while(current===job&&next<paths.length){const path=paths[next++],pcm=await load(path);buffers.set(path,pcm);loaded++;if(current===job)postMessage({type:'progress',id:job.id,loaded,total:paths.length});}
  }));
  if(current!==job)return;
  const samples=Math.max(...job.clips.map(c=>c.start+c.length))*clock;
  const mix=new Float32Array(samples), layers=[];
  for(const c of job.clips){
    const pcm=buffers.get(c.path), slots=Math.max(1,Math.floor(pcm.length/clock+.5)), end=(c.start+c.length)*clock, starts=[];
    for(let cycle=0;cycle<c.length;cycle+=slots){
      const start=(c.start+cycle)*clock, count=Math.min(pcm.length,end-start);starts.push(start);
      for(let offset=0;offset<count;offset+=65536){
        if(current!==job)return;
        const limit=Math.min(count,offset+65536);
        for(let i=offset;i<limit;i++)mix[start+i]+=pcm[i]*Math.min(1,(end-start-i)/600);
        await tick();
      }
    }
    layers.push({roleId:c.roleId,startSamples:starts,slotCount:slots});
  }
  let peak=0;
  for(let offset=0;offset<mix.length;offset+=131072){
    if(current!==job)return;
    const limit=Math.min(mix.length,offset+131072);for(let i=offset;i<limit;i++)peak=Math.max(peak,Math.abs(mix[i]));await tick();
  }
  const gain=Math.min(1,.85/Math.max(peak,1e-9));
  if(gain<1)for(let offset=0;offset<mix.length;offset+=131072){
    if(current!==job)return;
    const limit=Math.min(mix.length,offset+131072);for(let i=offset;i<limit;i++)mix[i]*=gain;await tick();
  }
  if(current!==job)return;
  totals.mixes++;current=null;
  postMessage({type:'mix',id:job.id,pcm:mix.buffer,report:{sampleRate:RATE,samples,seconds:samples/RATE,peak,gain,layers,workerMs:performance.now()-began,cache:stats()}},[mix.buffer]);
}
self.onmessage=event=>{
  const message=event.data;
  if(message.type==='cancel'){if(current?.id===message.id)current=null;return;}
  if(message.type==='warm'){for(const path of message.paths.slice(0,8))load(path).catch(()=>{});return;}
  if(message.type==='render'){
    current=message;
    render(message).catch(error=>{if(current===message){current=null;postMessage({type:'error',id:message.id,message:error.message});}});
  }
};
