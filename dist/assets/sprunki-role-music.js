/* Solo role playback shares the workshop's bounded mixer/cache and source clock. */
class SprunkiRoleMusic {
  constructor({getArranger,onStart,onStop,onError}){
    Object.assign(this,{getArranger,onStart,onStop,onError});this.generation=0;this.source=null;this.busy=false;this.playing=false;
    window.addEventListener('pagehide',()=>{this.stop();clearTimeout(this.idleTimer);if(this.context?.state!=='closed')this.context?.close().catch(()=>{});});
  }
  async unlock(){
    clearTimeout(this.idleTimer);
    if(!this.context||this.context.state==='closed')this.context=new AudioContext({sampleRate:24000});
    await this.context.resume();
  }
  async play(role,phase,intro=Promise.resolve()){
    this.stop();
    if(!phase.audio_files?.length)return;
    const generation=this.generation;this.busy=true;
    try{
      await this.unlock();const arranger=this.getArranger();await arranger.ready;
      if(generation!==this.generation)return;
      const period=arranger.timing?.[phase.id]?.period;
      if(!period)throw Error('这个阶段的节奏资料尚未收录');
      const score={phaseId:phase.id,period,clips:[{roleId:role.id,path:arranger.asset('audio/'+phase.audio_files[0]),start:0,length:4}]};
      const [result]=await Promise.all([arranger.engine.render(score,this.context),Promise.resolve(intro)]);
      if(generation!==this.generation)return;
      this.source=this.context.createBufferSource();this.source.buffer=result.buffer;this.source.loop=true;this.source.connect(this.context.destination);
      this.startedAt=this.context.currentTime+.03;this.source.start(this.startedAt);this.playing=true;this.busy=false;
      this.selection={characterId:role.id,phaseId:phase.id};this.lastRender=result.report;
      this.onStart({role,phase});
    }catch(error){if(generation===this.generation&&error.name!=='AbortError')this.onError(error.message||'音乐未准备好，请再点一下角色');}
    finally{if(generation===this.generation)this.busy=false;}
  }
  stop(){
    this.generation++;const active=this.busy||this.playing;
    if(this.busy)this.getArranger()?.engine.cancel();
    this.busy=false;this.playing=false;
    if(this.source){try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}
    if(active)this.onStop();
    clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>{if(!this.busy&&!this.playing&&this.context?.state==='running')this.context.suspend().catch(()=>{});},30000);
  }
}
window.SprunkiRoleMusic=SprunkiRoleMusic;
