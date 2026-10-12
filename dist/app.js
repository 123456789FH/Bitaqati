(() => {
  'use strict';
  const C=window.Bitaqati, $=id=>document.getElementById(id), clone=v=>JSON.parse(JSON.stringify(v));
  if(!C||location.hash.startsWith('#learn='))return;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const appendOptions=(container,q,cls)=>{container.replaceChildren();for(const k of C.letters){const n=el('div',cls);n.append(el('span','letter',C.labels[k]),el('span','option-text',q.options[k]));container.append(n);}};
  const base64Encode=text=>btoa(Array.from(new TextEncoder().encode(text),b=>String.fromCharCode(b)).join(''));
  const base64Decode=text=>new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text),x=>x.charCodeAt(0)));
  if(location.hash.startsWith('#show=')){
    $('teacher-app').hidden=true;document.querySelector('.app-header').hidden=true;$('student-display').hidden=false;
    try{
      const raw=location.hash.slice(6);if(raw.length>12000)throw new Error();
      const data=JSON.parse(base64Decode(decodeURIComponent(raw)));
      if(data.v!==1)throw new Error();
      const q=C.question({...data,title:'عرض السؤال',correct:'A'});
      $('display-question').textContent=q.text;appendOptions($('display-options'),q,'display-choice');
    }catch{$('display-question').textContent='تعذر فتح السؤال. انسخ رابط العرض من جديد.';}
    $('display-fullscreen').addEventListener('click',async()=>{try{await document.documentElement.requestFullscreen();}catch{}});
    return;
  }
  window.addEventListener('bitaqati-mode-change',e=>{if(e.detail?.mode!=='quiz')stopCamera();});
  const STORAGE='bitaqati-v1';
  let state={version:1,draft:C.defaultDraft(),history:[],current:null};
  let loadError=false;
  try{const saved=localStorage.getItem(STORAGE);if(saved)state=C.validateBackup(JSON.parse(saved));}catch{loadError=true;}
  let stream=null,detector=null,tracker=null,frameTimer=null,frameEpoch=0,facing='environment',restoring=false,saveTimer=null,pendingCamera=false,lastVideoTime=-1;
  const work=$('work-canvas'),ctx=work.getContext('2d',{willReadFrequently:true});
  const overlay=$('camera-overlay'),overlayCtx=overlay.getContext('2d');
  function notice(message,kind='info'){const n=$('notice');n.textContent=message;n.dataset.kind=kind;n.hidden=!message;}
  function persist(){
    if(loadError){$('save-status').textContent='تعذر قراءة بيانات سابقة؛ نزّل نسخة قبل الاستبدال.';return false;}
    try{localStorage.setItem(STORAGE,JSON.stringify(state));$('save-status').textContent='تم الحفظ على هذا المتصفح';return true;}
    catch{$('save-status').textContent='تعذر الحفظ المحلي';notice('تعذر الحفظ على هذا المتصفح. نزّل نسخة احتياطية قبل إغلاق الصفحة.','error');return false;}
  }
  function readDraft(){return C.draft({title:$('lesson-title').value,text:$('question-text').value,options:Object.fromEntries(C.letters.map(k=>[k,$('option-'+k).value])),correct:$('correct-answer').value,count:Number($('card-count').value),names:$('student-names').value.split(/\r?\n/).map(s=>s.trim()).filter((s,i,a)=>s||i<a.length-1)});}
  function fillDraft(){const d=state.draft;$('lesson-title').value=d.title;$('question-text').value=d.text;for(const k of C.letters)$('option-'+k).value=d.options[k];$('correct-answer').value=d.correct;$('card-count').value=String(d.count);$('student-names').value=d.names.join('\n');}
  function updateDraft(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{state.draft=readDraft();persist();}catch{$('save-status').textContent='أكمل الحقول لحفظ الإعداد';}},220);}
  function setView(view){for(const key of ['setup','scan','results']){$(key+'-view').hidden=key!==view;$('step-'+key).classList.toggle('active',key===view);if(key===view)$('step-'+key).setAttribute('aria-current','step');else $('step-'+key).removeAttribute('aria-current');}notice('');}
  function archive(){if(!state.current)return;if(!state.current.finishedAt)state.current.finishedAt=new Date().toISOString();const s=clone(state.current);state.history=[s,...state.history.filter(x=>x.id!==s.id)].slice(0,100);persist();}
  function begin(d,mode='live'){stopCamera();if(state.current&&!state.current.finishedAt)archive();state.current=C.createSession(d,mode);persist();showScan();}
  function currentIds(){return state.current.roster.filter(r=>!state.current.lockedIds.includes(r.id)).map(r=>r.id);}
  function showScan(){
    const s=state.current;if(!s)return;setView('scan');$('session-kind').textContent=s.mode==='demo'?'جلسة تجريبية · ليست نتائج طالبات':'جلسة الحصة';$('scan-question').textContent=s.question.text;appendOptions($('scan-options'),s.question,'compact-choice');$('start-camera-btn').disabled=s.mode==='demo';$('upload-image-btn').disabled=s.mode==='demo';renderProgress();
  }
  function renderProgress(){
    const s=state.current;if(!s)return;const summary=C.summary(s);
    $('scan-count').textContent='قُرئت '+C.ar(summary.answered)+' من '+C.ar(summary.total)+' بطاقات';$('coverage-bar').style.width=(summary.answered/summary.total*100)+'%';
    $('student-grid').replaceChildren();for(const student of s.roster){const got=Boolean(s.responses[student.id]);const chip=el('div','student-chip'+(got?' received':''));chip.append(el('strong','',C.ar(student.id)),el('span','',got?'تمت القراءة':'بانتظار القراءة'));chip.setAttribute('aria-label',(student.name||'بطاقة '+C.ar(student.id))+': '+(got?'تمت القراءة':'بانتظار القراءة'));$('student-grid').append(chip);}
  }
  function commitUpdates(updates,source){const s=state.current;if(!s||s.finishedAt)return;const allowed=new Set(currentIds());let changed=false;
    for(const u of updates){if(!allowed.has(u.id)||!C.letters.includes(u.answer))continue;if(s.responses[u.id]?.answer!==u.answer){s.responses[u.id]={answer:u.answer,at:new Date().toISOString(),source};changed=true;}}
    if(changed){persist();renderProgress();}
  }
  function showResults(){
    const s=state.current;if(!s)return;setView('results');const sum=C.summary(s);
    $('results-kind').textContent=s.mode==='demo'?'صورة تجريبية · هذه ليست نتائج طالبات':'نتائج السؤال';$('result-question').textContent=s.question.text;$('result-key').textContent='الإجابة الصحيحة: '+C.labels[s.question.correct]+' — '+s.question.options[s.question.correct];
    $('metric-read').textContent=C.ar(sum.answered);$('metric-coverage').textContent='من '+C.ar(sum.total)+' بطاقات';$('metric-correct').textContent=C.ar(sum.correct);$('metric-unread').textContent=C.ar(sum.unread);
    $('answer-chart').replaceChildren();for(const k of C.letters){const row=el('div','chart-row'+(k===s.question.correct?' is-correct':''));const label=el('div','chart-label');label.append(el('strong','',C.labels[k]),el('span','',s.question.options[k]));const track=el('div','chart-track');const bar=el('span','chart-fill');bar.style.width=(sum.answered?sum.distribution[k]/sum.answered*100:0)+'%';track.append(bar);row.append(label,track,el('strong','chart-number',C.ar(sum.distribution[k])));row.setAttribute('aria-label',C.labels[k]+': '+C.ar(sum.distribution[k])+' إجابات');$('answer-chart').append(row);}
    $('results-table').replaceChildren();for(const student of s.roster){const r=s.responses[student.id],status=r?(r.answer===s.question.correct?'correct':'wrong'):'unread';const tr=el('tr');tr.append(el('td','',C.ar(student.id)),el('td','',student.name||'—'),el('td','',r?C.labels[r.answer]:'—'));const td=el('td');td.append(el('span','status-pill '+status,r?(status==='correct'?'صحيحة':'غير صحيحة'):'لم تُقرأ'));tr.append(td);$('results-table').append(tr);}
    $('resume-btn').hidden=sum.unread===0||s.mode==='demo';
  }
  function finish(){stopCamera();archive();showResults();}
  function cameraMessage(text){$('camera-status').textContent=text;}
  function stopCamera(message='الكاميرا متوقفة'){
    frameEpoch++;clearTimeout(frameTimer);frameTimer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera-video').srcObject=null;$('start-camera-btn').hidden=false;$('stop-camera-btn').hidden=true;$('camera-placeholder').hidden=false;overlayCtx.clearRect(0,0,overlay.width,overlay.height);cameraMessage(message);
  }
  async function startCamera(){
    if(pendingCamera||!state.current||state.current.finishedAt||state.current.mode==='demo')return;
    if(!window.CardVision){notice('لم يكتمل تحميل قارئ البطاقات. أعد تحميل الصفحة.','error');return;}
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){notice('افتح رابط التطبيق الآمن في نافذة المتصفح مباشرة لتشغيل الكاميرا. يمكنك أيضًا قراءة البطاقات من صورة.','error');return;}
    stopCamera();const epoch=frameEpoch;pendingCamera=true;$('start-camera-btn').disabled=true;cameraMessage('جارٍ طلب الكاميرا…');
    try{
      const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}}});
      if(epoch!==frameEpoch||document.hidden){next.getTracks().forEach(t=>t.stop());return;}
      stream=next;const video=$('camera-video');video.srcObject=stream;await video.play();
      if(epoch!==frameEpoch){next.getTracks().forEach(t=>t.stop());return;}
      detector=window.CardVision.createDetector();tracker=C.createTracker(currentIds());lastVideoTime=-1;$('camera-placeholder').hidden=true;$('start-camera-btn').hidden=true;$('stop-camera-btn').hidden=false;cameraMessage('المسح يعمل · ثبّت البطاقات لحظة');
      for(const t of stream.getVideoTracks())t.addEventListener('ended',()=>{if(stream)stopCamera('توقفت الكاميرا. أعد تشغيلها عند الاستعداد.');},{once:true});
      scanFrame(epoch);
    }catch(err){stopCamera();const msg={NotAllowedError:'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات الموقع، وافتح الرابط في المتصفح مباشرة.',NotFoundError:'لم تُعثر على كاميرا. استخدم جهازًا بكاميرا أو اختر «اقرأ من صورة».',NotReadableError:'الكاميرا غير متاحة الآن. أغلق التطبيق الآخر الذي يستخدمها ثم حاول مجددًا.'};notice(msg[err.name]||'تعذر تشغيل الكاميرا على هذا الجهاز. يمكنك تجربة القراءة من صورة.','error');}
    finally{pendingCamera=false;$('start-camera-btn').disabled=state.current?.mode==='demo';}
  }
  function scanFrame(epoch){
    if(epoch!==frameEpoch||!stream||!state.current||state.current.finishedAt)return;
    const video=$('camera-video');
    if(video.readyState>=2&&video.videoWidth&&video.currentTime!==lastVideoTime){
      lastVideoTime=video.currentTime;
      const scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));const w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale);
      if(work.width!==w||work.height!==h){work.width=w;work.height=h;}if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}
      try{
        ctx.drawImage(video,0,0,w,h);const detections=detector.detect(ctx.getImageData(0,0,w,h));const locked=new Set(state.current.lockedIds);const valid=detections.filter(d=>!locked.has(d.id));const r=tracker.push(valid,performance.now());commitUpdates(r.updates,'camera');
        overlayCtx.clearRect(0,0,w,h);overlayCtx.strokeStyle='#74e6c4';overlayCtx.lineWidth=Math.max(3,w/300);overlayCtx.fillStyle='#123f37';overlayCtx.font='bold '+Math.max(20,w/40)+'px sans-serif';
        for(const m of detections){if(!state.current.roster.some(s=>s.id===m.id))continue;overlayCtx.beginPath();m.corners.forEach((p,i)=>i?overlayCtx.lineTo(p.x,p.y):overlayCtx.moveTo(p.x,p.y));overlayCtx.closePath();overlayCtx.stroke();const p=m.corners[0];overlayCtx.fillRect(p.x,p.y-32,64,32);overlayCtx.fillStyle='#fff';overlayCtx.fillText(C.ar(m.id),p.x+8,p.y-7);overlayCtx.fillStyle='#123f37';}
        if(r.ambiguous.length)cameraMessage('ظهرت بطاقتان بالرقم نفسه؛ تحقق من توزيع البطاقات.');else if(r.unknown.length)cameraMessage('بطاقات خارج قائمة الحصة: '+r.unknown.map(C.ar).join('، '));else cameraMessage('المسح يعمل · '+$('scan-count').textContent);
      }catch{stopCamera('توقف المسح بسبب تعذر قراءة إطار الكاميرا.');notice('جرّب إعادة تشغيل الكاميرا أو القراءة من صورة.','error');return;}
    }
    frameTimer=setTimeout(()=>scanFrame(epoch),125);
  }
  function decodeImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر فتح الصورة.'));img.src=url;});}
  async function readImage(img,source='image'){
    if(!state.current||state.current.finishedAt)return;
    if(!window.CardVision)throw new Error('لم يكتمل تحميل قارئ البطاقات.');
    const scale=Math.min(1,1800/Math.max(img.width,img.height));work.width=Math.round(img.width*scale);work.height=Math.round(img.height*scale);ctx.drawImage(img,0,0,work.width,work.height);
    const found=window.CardVision.createDetector().detect(ctx.getImageData(0,0,work.width,work.height));const groups=new Map();for(const d of found){if(!groups.has(d.id))groups.set(d.id,[]);groups.get(d.id).push(d);}
    const eligible=new Set(currentIds());const updates=[...groups.entries()].filter(([id,ds])=>eligible.has(id)&&ds.length===1).map(([,ds])=>ds[0]);commitUpdates(updates,source);
    if(!updates.length)notice('لم تُقرأ بطاقة صالحة جديدة. تحقق من وضوح الرمز واتجاه البطاقة وأن رقمها ضمن الحصة.','error');else notice('تمت قراءة '+C.ar(updates.length)+' بطاقات من الصورة.');
    return updates.length;
  }
  async function demo(){
    if(!window.CardVision){notice('انتظر اكتمال تحميل قارئ البطاقات ثم حاول مجددًا.','error');return;}
    $('demo-btn').disabled=true;
    try{
      begin(C.defaultDraft(),'demo');const sid=state.current.id;const canvas=document.createElement('canvas');canvas.width=960;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,960,320);
      for(let id=1;id<=3;id++){const svg=window.CardVision.markerSvg(id);const u=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));let img;try{img=await decodeImage(u);}finally{URL.revokeObjectURL(u);}c.save();c.translate(160+(id-1)*320,160);c.rotate(-(id-1)*Math.PI/2);c.drawImage(img,-120,-120,240,240);c.restore();}
      if(state.current?.id!==sid)return;
      const read=await readImage(canvas,'demo');finish();notice('جلسة تجريبية من صورة مُنشأة: البطاقة ١ اختارت أ، والبطاقة ٢ ب، والبطاقة ٣ ج. '+(read===3?'قُرئت البطاقات الثلاث.':'لم تكتمل قراءة الصورة؛ أعد المحاولة.'),read===3?'info':'error');
    }catch(err){notice(err.message||'تعذر إتمام التجربة.','error');}
    finally{$('demo-btn').disabled=false;}
  }
  function displayUrl(){if(!state.current)return null;const q=state.current.question;const u=new URL(location.href);u.hash='show='+encodeURIComponent(base64Encode(JSON.stringify({v:1,text:q.text,options:q.options})));return u.href;}
  function openDisplay(){const url=displayUrl();if(!url)return;const win=window.open(url,'_blank','noopener');if(!win)notice('إذا لم تفتح نافذة السؤال، استخدم «انسخ رابط السؤال للحاسوب».');}
  async function copyDisplay(){const url=displayUrl();if(!url)return;try{await navigator.clipboard.writeText(url);notice('نُسخ رابط السؤال فقط. افتحه على الحاسوب، وتابع المسح من هذا الجهاز.');}catch{const link=el('a','',url);link.href=url;link.target='_blank';link.rel='noopener';const n=$('notice');n.replaceChildren(el('span','','انسخ هذا الرابط إلى الحاسوب: '),link);n.hidden=false;}}
  function download(content,type,filename){const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function exportCsv(s){download(C.csv(s),'text/csv;charset=utf-8','بطاقتي_'+(s.mode==='demo'?'تجربة_':'')+s.createdAt.slice(0,10)+'.csv');}
  function backup(){download(JSON.stringify(state,null,2),'application/json;charset=utf-8','بطاقتي_نسخة_احتياطية_'+new Date().toISOString().slice(0,10)+'.json');}
  function ask(title,text,label='متابعة'){return new Promise(resolve=>{const d=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-accept').textContent=label;let done=false;const end=result=>{if(done)return;done=true;d.close();$('confirm-accept').onclick=null;$('confirm-cancel').onclick=null;d.oncancel=null;resolve(result);};$('confirm-accept').onclick=()=>end(true);$('confirm-cancel').onclick=()=>end(false);d.oncancel=e=>{e.preventDefault();end(false);};d.showModal();});}
  function showHistory(){
    $('history-list').replaceChildren();if(!state.history.length)$('history-list').append(el('p','muted','لا توجد محاولات مكتملة بعد.'));
    for(const s of state.history){const sum=C.summary(s);const item=el('details','history-item');const heading=el('summary');heading.append(el('strong','',s.question.title),el('span',s.mode==='demo'?'demo-label':'',s.mode==='demo'?'تجربة':'حصة'));item.append(heading,el('p','',s.question.text),el('p','small-note',new Date(s.createdAt).toLocaleString('ar-SA',{calendar:'gregory'})+' · قُرئت '+C.ar(sum.answered)+' من '+C.ar(sum.total)+' · صحيحة '+C.ar(sum.correct)));const b=el('button','button secondary','تنزيل نتائج هذه المحاولة');b.type='button';b.addEventListener('click',()=>exportCsv(s));item.append(b);$('history-list').append(item);}
    $('history-dialog').showModal();
  }
  function makeCard(student){const card=el('section','paper-card');const header=el('header');header.append(el('strong','card-no','بطاقة '+C.ar(student.id)),el('span','card-name',student.name||''));const wrap=el('div','marker-wrap');const holder=el('div','marker-code');holder.innerHTML=window.CardVision.markerSvg(student.id);wrap.append(holder);for(const [key,pos] of [['A','top'],['B','right'],['C','bottom'],['D','left']])wrap.append(el('span','edge-letter '+pos,C.labels[key]));card.append(header,wrap,el('footer','','بطاقتي · اجعل حرف إجابتك في الأعلى'));return card;}
  function showCards(){
    if(!window.CardVision){notice('لم يكتمل تحميل البطاقات. أعد تحميل الصفحة.','error');return;}
    let count=Number($('card-count').value),names=$('student-names').value.split(/\r?\n/).map(s=>s.trim());if(!Number.isInteger(count)||count<1||count>40)return;
    if(names.slice(count).some(n=>n)){notice('عدد الأسماء أكبر من عدد البطاقات. عدّل العدد أو القائمة قبل الطباعة.','error');return;}
    if(names.some(n=>n.length>80)){notice('اختصر الاسم إلى ٨٠ حرفًا أو أقل قبل الطباعة.','error');return;}
    $('card-previews').replaceChildren();$('print-root').replaceChildren();let sheet=null;
    for(let i=1;i<=count;i++){const s={id:i,name:(names[i-1]||'').slice(0,80)};if(i%2===1){sheet=el('div','card-sheet');$('print-root').append(sheet);}sheet.append(makeCard(s));$('card-previews').append(makeCard(s));}
    $('cards-dialog').showModal();
  }
  for(let i=1;i<=40;i++){const o=el('option','',C.ar(i));o.value=String(i);$('card-count').append(o);}fillDraft();
  $('question-form').addEventListener('input',updateDraft);$('card-count').addEventListener('change',updateDraft);$('student-names').addEventListener('input',updateDraft);
  $('question-form').addEventListener('submit',e=>{e.preventDefault();try{clearTimeout(saveTimer);state.draft=readDraft();begin(state.draft);}catch(err){notice(err.message,'error');}});
  $('example-btn').addEventListener('click',async()=>{if(!await ask('استخدام المثال الجاهز','سيُستبدل نص السؤال وخياراته بالمثال، وتبقى إعدادات بطاقاتك.','استخدم المثال'))return;const d=C.defaultDraft();d.count=Number($('card-count').value);d.names=$('student-names').value.split(/\r?\n/).map(s=>s.trim()).slice(0,d.count);state.draft=d;fillDraft();persist();});
  $('demo-btn').addEventListener('click',demo);$('start-camera-btn').addEventListener('click',startCamera);$('stop-camera-btn').addEventListener('click',()=>stopCamera('المسح متوقف مؤقتًا · الإجابات محفوظة'));
  $('switch-camera-btn').addEventListener('click',()=>{facing=facing==='environment'?'user':'environment';const running=Boolean(stream);stopCamera(facing==='environment'?'اختيرت الكاميرا الخلفية':'اختيرت الكاميرا الأمامية');if(running)startCamera();});
  $('finish-btn').addEventListener('click',finish);$('student-view-btn').addEventListener('click',openDisplay);$('copy-display-btn').addEventListener('click',copyDisplay);
  $('upload-image-btn').addEventListener('click',()=>{stopCamera();$('image-input').click();});
  $('image-input').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const sid=state.current?.id;if(!sid||state.current.mode==='demo'||state.current.finishedAt)return;if(file.size>15*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){notice('اختر صورة PNG أو JPG أو WebP لا تتجاوز ١٥ ميجابايت.','error');return;}const url=URL.createObjectURL(file);try{const img=await decodeImage(url);if(state.current?.id!==sid||state.current.finishedAt)return;await readImage(img);}catch(err){notice(err.message,'error');}finally{URL.revokeObjectURL(url);}});
  $('new-question-btn').addEventListener('click',()=>{stopCamera();archive();state.current=null;persist();fillDraft();setView('setup');$('question-text').focus();});
  $('retry-btn').addEventListener('click',()=>{if(!state.current)return;const old=clone(state.current);archive();const d={...old.question,count:old.roster.length,names:old.roster.map(r=>r.name)};state.current=C.createSession(d,old.mode);state.current.roster=old.roster;persist();showScan();if(old.mode==='demo'){state.current=null;demo();}});
  $('resume-btn').addEventListener('click',()=>{if(!state.current)return;state.current.lockedIds=Object.keys(state.current.responses).map(Number);state.current.finishedAt=null;persist();showScan();notice('ستُضاف البطاقات غير المقروءة فقط، وتبقى الإجابات المسجلة كما هي.');});
  $('csv-btn').addEventListener('click',()=>{if(state.current)exportCsv(state.current);});$('history-btn').addEventListener('click',showHistory);$('help-btn').addEventListener('click',()=>$('help-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
  $('print-cards-btn').addEventListener('click',showCards);$('print-now-btn').addEventListener('click',()=>{$('cards-dialog').close();document.body.classList.add('printing-cards');window.print();});window.addEventListener('afterprint',()=>document.body.classList.remove('printing-cards'));
  $('backup-btn').addEventListener('click',backup);$('restore-btn').addEventListener('click',()=>$('backup-input').click());
  $('backup-input').addEventListener('change',async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file||restoring)return;restoring=true;
    try{if(file.size>2*1024*1024)throw new Error('النسخة أكبر من الحد المسموح: ٢ ميجابايت.');const proposed=C.validateBackup(JSON.parse(await file.text()));if(!await ask('استعادة نسخة احتياطية','تحتوي النسخة على '+C.ar(proposed.history.length)+' محاولة مكتملة. ستستبدل بيانات هذا المتصفح، وتُنزل نسخة من بياناتك الحالية قبل الاستبدال.','استعادة النسخة'))return;backup();try{localStorage.setItem('bitaqati-before-restore',JSON.stringify(state));localStorage.setItem(STORAGE,JSON.stringify(proposed));}catch{throw new Error('تعذر حفظ النسخة المستعادة. بقيت بياناتك الحالية كما هي؛ حرّر مساحة أو استخدم متصفحًا آخر.');}stopCamera();clearTimeout(saveTimer);loadError=false;state=proposed;$('save-status').textContent='تم الحفظ على هذا المتصفح';fillDraft();if(state.current){state.current.finishedAt?showResults():showScan();}else setView('setup');notice('تمت استعادة النسخة.');}
    catch(err){notice(err instanceof SyntaxError?'تعذر قراءة الملف. اختر نسخة JSON صدرت من بطاقتي.':err.message,'error');}finally{restoring=false;}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||pendingCamera))stopCamera('توقف المسح عند مغادرة الصفحة. اضغط تشغيل الكاميرا للاستكمال.');});window.addEventListener('pagehide',()=>stopCamera());
  if(state.current){state.current.finishedAt?showResults():showScan();}else setView('setup');
  if(loadError)notice('تعذر قراءة البيانات المحفوظة سابقًا. لم نستبدلها. يمكنك استعادة نسخة احتياطية صحيحة.','error');
})();
