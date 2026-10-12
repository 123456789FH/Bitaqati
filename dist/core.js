(function (root) {
  'use strict';
  const letters = ['A', 'B', 'C', 'D'];
  const labels = {A:'أ', B:'ب', C:'ج', D:'د'};
  const ar = value => String(value).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  const defaultDraft = () => ({title:'بذور تنمو وأعداد تفسّر',text:'في نموذج المتابعة ٤٨ بذرة، ظهر الإنبات في ٣١ منها. قرّب العددين إلى أقرب عشرة، ثم قدّر عدد البذور التي لم يظهر إنباتها بعد.',options:{A:'١٠ تقريبًا',B:'٢٠ تقريبًا',C:'٣٠ تقريبًا',D:'٨٠ تقريبًا'},correct:'B',count:3,names:[]});
  function fail(message) { throw new Error(message); }
  function str(value,max,label,empty=false) {
    if(typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('تحقق من '+label+'.');
    return value.trim();
  }
  function question(value) {
    if(!value || typeof value !== 'object') fail('بيانات السؤال غير مكتملة.');
    const options = {};
    for(const k of letters) options[k]=str(value.options?.[k],150,'الخيار '+labels[k]);
    if(new Set(Object.values(options)).size!==4) fail('اكتب أربعة خيارات مختلفة.');
    if(!letters.includes(value.correct)) fail('حدد الإجابة الصحيحة.');
    return {title:str(value.title,100,'عنوان الحصة'),text:str(value.text,500,'نص السؤال'),options,correct:value.correct};
  }
  function draft(value) {
    const q=question(value);
    if(typeof value.count!=='number' && !(typeof value.count==='string' && /^\d{1,2}$/.test(value.count))) fail('اختر عددًا من ١ إلى ٤٠.');
    const count=Number(value.count);
    if(!Number.isInteger(count)||count<1||count>40) fail('اختر عددًا من ١ إلى ٤٠.');
    if(!Array.isArray(value.names)||value.names.length>40) fail('عدد الأسماء غير صالح.');
    const names=value.names.map(n=>str(n,80,'الأسماء',true));
    if(names.slice(count).some(n=>n)) fail('عدد الأسماء أكبر من عدد البطاقات.');
    return {...q,count,names:names.slice(0,count)};
  }
  function timestamp(value,nullable=false) {
    if(nullable && value===null) return null;
    if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value))) fail('تاريخ غير صالح في النسخة.');
    return value;
  }
  function session(value) {
    if(!value || typeof value!=='object' || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(value.id)) fail('معرّف محاولة غير صالح.');
    if(!['live','demo'].includes(value.mode)) fail('نوع المحاولة غير صالح.');
    if(!Array.isArray(value.roster)||value.roster.length<1||value.roster.length>40) fail('قائمة بطاقات غير صالحة.');
    const ids=new Set();
    const roster=value.roster.map(r=>{
      if(!r||!Number.isInteger(r.id)||r.id<1||r.id>40||ids.has(r.id)) fail('رقم بطاقة غير صالح أو مكرر.');
      ids.add(r.id); return {id:r.id,name:str(r.name,80,'الاسم',true)};
    });
    const responses={};
    if(!value.responses||typeof value.responses!=='object'||Array.isArray(value.responses)||Object.keys(value.responses).length>40) fail('الإجابات غير صالحة.');
    for(const [key,r] of Object.entries(value.responses)) {
      const id=Number(key);
      if(!Number.isInteger(id)||String(id)!==key||!ids.has(id)||!r||!letters.includes(r.answer)||!['camera','image','demo'].includes(r.source)) fail('إجابة غير صالحة في النسخة.');
      if((value.mode==='demo') !== (r.source==='demo')) fail('اختلطت بيانات التجربة ببيانات الحصة.');
      responses[key]={answer:r.answer,at:timestamp(r.at),source:r.source};
    }
    const lockedIds=value.lockedIds??[];
    if(!Array.isArray(lockedIds)||lockedIds.length>40||new Set(lockedIds).size!==lockedIds.length||lockedIds.some(id=>!ids.has(id)||!responses[id])) fail('حالة استكمال غير صالحة.');
    return {id:value.id,mode:value.mode,question:question(value.question),roster,responses,createdAt:timestamp(value.createdAt),finishedAt:timestamp(value.finishedAt,true),lockedIds:[...lockedIds]};
  }
  function validateBackup(value) {
    if(!value || value.version!==1 || !Array.isArray(value.history)||value.history.length>100) fail('هذه ليست نسخة صالحة من بطاقتي.');
    const history=value.history.map(session);
    if(new Set(history.map(s=>s.id)).size!==history.length) fail('توجد محاولات مكررة في النسخة.');
    return {version:1,draft:draft(value.draft),history,current:value.current===null?null:session(value.current)};
  }
  function createSession(d,mode='live') {
    if(!['live','demo'].includes(mode)) fail('نوع المحاولة غير صالح.');
    const v=draft(d);
    return {id:root.crypto?.randomUUID?.()??('s-'+Date.now()+'-'+Math.random().toString(36).slice(2)),mode,question:question(v),roster:Array.from({length:v.count},(_,i)=>({id:i+1,name:v.names[i]||''})),responses:{},createdAt:new Date().toISOString(),finishedAt:null,lockedIds:[]};
  }
  function summary(s) {
    const distribution={A:0,B:0,C:0,D:0};let answered=0,correct=0;
    for(const student of s.roster){const r=s.responses[student.id];if(r&&letters.includes(r.answer)){answered++;distribution[r.answer]++;if(r.answer===s.question.correct)correct++;}}
    return {total:s.roster.length,answered,correct,incorrect:answered-correct,unread:s.roster.length-answered,distribution};
  }
  function createTracker(ids,{minFrames=3,minDurationMs=240,expireMs=700}={}) {
    const allowed=new Set(ids),candidates=new Map(),accepted=new Map();
    return {
      push(detections,now) {
        const groups=new Map(),unknown=new Set(),ambiguous=[];
        for(const m of detections){
          if(!Number.isInteger(m.id)||!letters.includes(m.answer))continue;
          if(!allowed.has(m.id)){unknown.add(m.id);continue;}
          if(!groups.has(m.id))groups.set(m.id,[]);groups.get(m.id).push(m);
        }
        const updates=[];
        for(const id of [...candidates.keys()])if(!groups.has(id))candidates.delete(id);
        for(const [id,matches] of groups){
          if(matches.length!==1){ambiguous.push(id);candidates.delete(id);continue;}
          const m=matches[0];let c=candidates.get(id);
          if(c && now===c.last)continue;
          if(!c||c.answer!==m.answer||now-c.last>expireMs||now<c.last)c={answer:m.answer,count:1,start:now,last:now};
          else{c.count++;c.last=now;}
          candidates.set(id,c);
          if(c.count>=minFrames&&now-c.start>=minDurationMs&&accepted.get(id)!==c.answer){accepted.set(id,c.answer);updates.push({id,answer:c.answer});}
        }
        return {updates,unknown:[...unknown],ambiguous};
      },
      reset(){candidates.clear();accepted.clear();}
    };
  }
  function csv(s) {
    const safe=v=>{let t=String(v??'');if(/^[\s]*[=+\-@]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
    const rows=[['نوع المحاولة','وقت البداية','عنوان الحصة','السؤال','البطاقة','الاسم','الاختيار','نص الاختيار','النتيجة','الإجابة الصحيحة','نص الإجابة الصحيحة','مصدر القراءة']];
    for(const r of s.roster){const response=s.responses[r.id];rows.push([s.mode==='demo'?'تجربة':'حصة',s.createdAt,s.question.title,s.question.text,ar(r.id),r.name,response?labels[response.answer]:'',response?s.question.options[response.answer]:'',response?(response.answer===s.question.correct?'صحيحة':'غير صحيحة'):'لم تُقرأ',labels[s.question.correct],s.question.options[s.question.correct],response?({camera:'كاميرا',image:'صورة',demo:'صورة تجريبية'}[response.source]):'']);}
    return '\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n');
  }
  const api={letters,labels,ar,defaultDraft,question,draft,session,validateBackup,createSession,summary,createTracker,csv};
  root.Bitaqati=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
