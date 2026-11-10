/* One reusable worker, bounded PCM/mix caches, one browser audio stream. */
class SprunkiMusicEngine {
  constructor(){this.serial=0;this.pending=null;this.cache=new Map();this.cacheBytes=0;this.cacheLimit=24*1024*1024;this.metrics={renders:0,mixHits:0};}
  ensureWorker(){
    if(this.worker)return;
    this.worker=new Worker('assets/sprunki-mixer-worker.js');
    this.worker.onmessage=event=>{
      const message=event.data,job=this.pending;if(!job||message.id!==job.id)return;
      if(message.type==='progress'){job.progress?.(message.loaded,message.total);return;}
      this.pending=null;
      if(message.type==='error'){job.reject(Error(message.message));return;}
      if(message.type==='mix'){
        const before=performance.now(), pcm=new Float32Array(message.pcm),buffer=job.context.createBuffer(1,pcm.length,24000);buffer.copyToChannel(pcm,0);
        const result={buffer,report:message.report,cacheHit:false,copyMs:performance.now()-before};
        this.metrics.renders++;this.metrics.workerCache=message.report.cache;
        this.cache.set(job.key,result);this.cacheBytes+=pcm.byteLength;
        while(this.cacheBytes>this.cacheLimit&&this.cache.size>1){const [key,value]=this.cache.entries().next().value;this.cache.delete(key);this.cacheBytes-=value.buffer.length*4;}
        job.resolve(result);
      }
    };
    this.worker.onerror=()=>{const job=this.pending;this.pending=null;job?.reject(Error('音乐没准备好，请再点一次播放'));this.worker?.terminate();this.worker=null;};
  }
  // Resolve document-relative paths before crossing into the worker's assets directory.
  audioUrl(path){return new URL(path,document.baseURI).href;}
  warm(paths){if(!paths.length)return;try{this.ensureWorker();this.worker.postMessage({type:'warm',paths:[...new Set(paths.map(path=>this.audioUrl(path)))]});}catch{/* Playback reports any unavailable worker. */}}
  render(score,context,progress){
    this.cancel();
    score={...score,clips:score.clips.map(clip=>({...clip,path:this.audioUrl(clip.path)}))};
    const key=JSON.stringify({phaseId:score.phaseId,period:score.period,clips:score.clips.map(({path,start,length})=>({path,start,length})).sort((a,b)=>a.path.localeCompare(b.path)||a.start-b.start||a.length-b.length)});
    if(this.cache.has(key)){const result=this.cache.get(key);this.cache.delete(key);this.cache.set(key,result);this.metrics.mixHits++;return Promise.resolve({...result,cacheHit:true,copyMs:0});}
    this.ensureWorker();const id=++this.serial;
    return new Promise((resolve,reject)=>{this.pending={id,key,context,progress,resolve,reject};this.worker.postMessage({type:'render',id,...score});});
  }
  cancel(){if(this.pending){const job=this.pending;this.pending=null;this.worker?.postMessage({type:'cancel',id:job.id});job.reject(new DOMException('Canceled','AbortError'));}}
  destroy(){this.cancel();this.worker?.terminate();this.worker=null;this.cache.clear();this.cacheBytes=0;}
  stats(){return {...this.metrics,mixCacheBytes:this.cacheBytes,mixCacheLimit:this.cacheLimit,cachedMixes:this.cache.size};}
}
window.SprunkiMusicEngine=SprunkiMusicEngine;
