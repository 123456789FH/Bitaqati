/* Bitaqati: explicit learner expressions and parallel thinking, version 2. */
(function (root) {
  'use strict';
  const MODES = ['feelings', 'hats'];
  const COLORS = {red:'#bf3d46',green:'#23865a',blue:'#2c69ac',yellow:'#efc64f',purple:'#875cb1',white:'#ffffff',black:'#343943'};
  const feelings = [
    {key:'red',name:'الأحمر',label:'أشعر بالحيرة',hint:'أحتاج توضيحًا',symbol:'؟',action:'اسأل عن الخطوة التي تحتاج توضيحًا، ثم قدم مثالًا آخر.'},
    {key:'green',name:'الأخضر',label:'أشعر بالسعادة',hint:'أعجبني الدرس',symbol:'✦',action:'أتح فرصة اختيارية لذكر ما أعجب المتعلم في التجربة.'},
    {key:'blue',name:'الأزرق',label:'أشعر بالفضول',hint:'لدي سؤال',symbol:'؟',action:'استمع إلى السؤال، ودوّن متابعة إذا احتاج إلى بحث أو وقت آخر.'},
    {key:'yellow',name:'الأصفر',label:'أشعر بالضيق',hint:'أحتاج دعمًا',symbol:'≈',action:'استجب بهدوء، واعرض دعمًا أو حديثًا فرديًا دون مطالبة المتعلم بالكشف أمام الصف.'},
    {key:'purple',name:'البنفسجي',label:'أشعر بالحماس',hint:'لدي فكرة',symbol:'✧',action:'أتح مشاركة فكرة أو طريقة جديدة في وقت مناسب.'},
    {key:'white',name:'الأبيض',label:'أريد الحديث على انفراد',hint:'مع المعلم فقط',symbol:'…',action:'رتب فرصة للحديث على انفراد. لا تطلب تفاصيل أمام الصف.'}
  ];
  const hats = [
    {key:'white',name:'البيضاء',label:'معلومات وحقائق',hint:'ما الذي نعرفه؟ وما الذي نحتاج إلى معرفته؟',prompt:'ما المعلومات التي نعرفها؟ وما المعلومات التي نحتاجها؟'},
    {key:'red',name:'الحمراء',label:'مشاعر وانطباعات',hint:'عبّر عن شعورك دون الحاجة إلى تبريره.',prompt:'بماذا تشعر تجاه الفكرة أو التجربة؟'},
    {key:'yellow',name:'الصفراء',label:'فوائد وقيمة',hint:'ابحث عن الفوائد والجوانب الإيجابية.',prompt:'ما فائدة هذه الفكرة؟ وأين يمكن أن نستخدمها؟'},
    {key:'black',name:'السوداء',label:'محاذير وصعوبات',hint:'اذكر مشكلة محتملة وسبب القلق منها.',prompt:'ما الصعوبة التي قد تواجهنا؟ ولماذا؟'},
    {key:'green',name:'الخضراء',label:'أفكار وبدائل',hint:'اقترح فكرة جديدة أو طريقة أخرى.',prompt:'ما الفكرة الأخرى أو الطريقة الجديدة التي يمكن أن نجربها؟'},
    {key:'blue',name:'الزرقاء',label:'تنظيم وخطوة تالية',hint:'حدد الهدف، ونظّم العمل، ولخّص ما توصلنا إليه.',prompt:'ما هدفنا؟ وكيف ننظم عملنا؟ وما خطوتنا التالية؟'}
  ];
  const FLOW = ['blue','white','green','yellow','black','red','blue'];
  const ar = value => String(value).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[+d]);
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => root.crypto?.randomUUID?.() || 'r-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function fail(message){throw new Error(message);}
  function text(value,max,label,allowEmpty=false){if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim()))fail('تحقق من '+label+'.');return value.trim();}
  function date(value,empty=false){if(empty&&value===null)return null;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))fail('تاريخ غير صالح.');return value;}
  const getKeys=mode=>(mode==='feelings'?feelings:hats).map(c=>c.key);
  function choices(mode,settings){
    return (mode==='feelings'?feelings:hats).map(c=>{const updated={...c,color:COLORS[c.key],...(mode==='feelings'?settings?.labels?.[c.key]||{}:{})};if(mode==='feelings'&&(updated.label!==c.label||updated.hint!==c.hint))updated.action='استمع إلى رسالة المتعلم، واختر المتابعة المناسبة لعبارة هذه البطاقة.';return updated;});
  }
  function defaults(){return {product:'bitaqati-learning',version:2,activeMode:'feelings',settings:{title:'بذور تنمو وأعداد تفسّر',count:3,names:[],feelingsPrompt:'كيف تشعر الآن؟ اختر ما ترغب في التعبير عنه.',labels:Object.fromEntries(feelings.map(c=>[c.key,{label:c.label,hint:c.hint}])),hatPrompts:Object.fromEntries(hats.map(c=>[c.key,c.prompt]))},current:{feelings:null,hats:null},history:[]};}
  function settings(value){
    if(!value||typeof value!=='object')fail('إعدادات الجولة غير مكتملة.');
    const count=Number(value.count);if(!Number.isInteger(count)||count<1||count>40)fail('اختر عددًا من ١ إلى ٤٠.');
    if(!Array.isArray(value.names)||value.names.length>40)fail('قائمة الأسماء غير صالحة.');
    const names=value.names.map(n=>text(n,80,'الاسم',true));if(names.slice(count).some(Boolean))fail('عدد الأسماء أكبر من عدد البطاقات.');
    const labels={};for(const c of feelings)labels[c.key]={label:text(value.labels?.[c.key]?.label,55,'عبارة البطاقة'),hint:text(value.labels?.[c.key]?.hint,100,'رسالة البطاقة',true)};
    if(new Set(Object.values(labels).map(c=>c.label)).size!==6)fail('اكتب عبارة مختلفة لكل بطاقة.');
    const hatPrompts={};for(const c of hats)hatPrompts[c.key]=text(value.hatPrompts?.[c.key],500,'سؤال القبعة');
    return {title:text(value.title,100,'عنوان اللقاء'),count,names:names.slice(0,count),feelingsPrompt:text(value.feelingsPrompt,500,'سؤال المشاعر'),labels,hatPrompts};
  }
  function createRound(mode,config,options={}){
    if(!MODES.includes(mode))fail('اختر قسمًا صالحًا.');const s=settings(config);
    const hatKey=mode==='hats'?(options.hatKey||'blue'):null;if(hatKey&&!getKeys('hats').includes(hatKey))fail('اختر القبعة النشطة.');
    const createdAt=new Date().toISOString(),id=uid();
    return {id,mode,demo:Boolean(options.demo),title:s.title,prompt:mode==='feelings'?s.feelingsPrompt:s.hatPrompts[hatKey],hatKey,flowIndex:mode==='hats'?(Number.isInteger(options.flowIndex)?options.flowIndex:0):null,stage:options.stage||'during',groupId:options.groupId||id,parentId:options.parentId||null,choices:choices(mode,s),roster:Array.from({length:s.count},(_,i)=>({id:i+1,name:s.names[i]||''})),responses:{},notes:{},actions:[],createdAt,finishedAt:null};
  }
  function validateRound(value){
    if(!value||typeof value!=='object'||!MODES.includes(value.mode)||typeof value.demo!=='boolean')fail('جولة غير صالحة.');
    const id=text(value.id,90,'معرف الجولة');if(!/^[a-zA-Z0-9_-]+$/.test(id))fail('معرف غير صالح.');
    const mode=value.mode,keys=getKeys(mode);const hatKey=mode==='hats'?value.hatKey:null;if(mode==='hats'&&!keys.includes(hatKey))fail('قبعة غير صالحة.');
    if(!Array.isArray(value.roster)||!value.roster.length||value.roster.length>40)fail('قائمة بطاقات غير صالحة.');
    const ids=new Set();const roster=value.roster.map(r=>{if(!Number.isInteger(r?.id)||r.id<1||r.id>40||ids.has(r.id))fail('رقم بطاقة غير صالح أو مكرر.');ids.add(r.id);return {id:r.id,name:text(r.name,80,'الاسم',true)};});
    if(!Array.isArray(value.choices)||value.choices.length!==6||new Set(value.choices.map(c=>c?.key)).size!==6)fail('خيارات الجولة غير صالحة.');
    const catalogue=mode==='feelings'?feelings:hats;
    const cs=keys.map(key=>{const c=value.choices.find(x=>x?.key===key),base=catalogue.find(x=>x.key===key);if(!c)fail('إشارة غير صالحة.');return {...base,color:COLORS[key],label:mode==='feelings'?text(c.label,55,'عبارة محفوظة'):base.label,hint:mode==='feelings'?text(c.hint,100,'رسالة محفوظة',true):base.hint};});
    const responses={};if(!value.responses||typeof value.responses!=='object'||Array.isArray(value.responses)||Object.keys(value.responses).length>40)fail('إشارات غير صالحة.');
    for(const [k,r] of Object.entries(value.responses)){if(String(Number(k))!==k||!ids.has(Number(k))||!r||!keys.includes(r.key)||(mode==='hats'&&r.key!==hatKey)||!['camera','image','demo','manual'].includes(r.source)||(value.demo!==(r.source==='demo')))fail('قراءة غير صالحة في الجولة.');responses[k]={key:r.key,source:r.source,at:date(r.at)};}
    for(const c of cs){const base=catalogue.find(b=>b.key===c.key);if(mode==='feelings'&&(c.label!==base.label||c.hint!==base.hint))c.action='استمع إلى رسالة المتعلم، واختر المتابعة المناسبة لعبارة هذه البطاقة.';}
    const notes={};if(!value.notes||typeof value.notes!=='object'||Array.isArray(value.notes)||Object.keys(value.notes).length>40)fail('ملاحظات غير صالحة.');
    for(const[k,n]of Object.entries(value.notes)){if(String(Number(k))!==k||!ids.has(Number(k))||!responses[k]||!n||typeof n.handled!=='boolean')fail('ملاحظة غير صالحة.');notes[k]={text:text(n.text,600,'الملاحظة',true),handled:n.handled};}
    if(!Array.isArray(value.actions)||value.actions.length>30)fail('سجل متابعة غير صالح.');
    const actions=value.actions.map(a=>{if(!a||typeof a!=='object')fail('إجراء غير صالح.');return {text:text(a.text,180,'الإجراء'),at:date(a.at)};});
    if(!['before','during','after'].includes(value.stage))fail('توقيت الجولة غير صالح.');
    if(mode==='hats'&&(!Number.isInteger(value.flowIndex)||value.flowIndex<0||value.flowIndex>=FLOW.length))fail('تسلسل غير صالح.');
    return {id,mode,demo:value.demo,title:text(value.title,100,'العنوان'),prompt:text(value.prompt,500,'السؤال'),hatKey,flowIndex:mode==='hats'?value.flowIndex:null,stage:value.stage,groupId:text(value.groupId,90,'مجموعة الجولات'),parentId:value.parentId===null?null:text(value.parentId,90,'الجولة السابقة'),choices:cs,roster,responses,notes,actions,createdAt:date(value.createdAt),finishedAt:date(value.finishedAt,true)};
  }
  function validateState(value){
    if(!value||value.product!=='bitaqati-learning'||value.version!==2||!MODES.includes(value.activeMode)||!Array.isArray(value.history)||value.history.length>100||!value.current)fail('اختر نسخة المشاعر والقبعات الصادرة من بطاقتي.');
    const history=value.history.map(validateRound);if(new Set(history.map(s=>s.id)).size!==history.length)fail('جولات مكررة في النسخة.');
    const current={};for(const m of MODES){current[m]=value.current[m]===null?null:validateRound(value.current[m]);if(current[m]&&current[m].mode!==m)fail('نوع الجولة لا يطابق القسم.');}
    return {product:'bitaqati-learning',version:2,activeMode:value.activeMode,settings:settings(value.settings),current,history};
  }
  function commit(round,updates,source,at=new Date().toISOString()){
    if(round.finishedAt||!['camera','image','demo','manual'].includes(source)||round.demo!==(source==='demo'))return 0;
    const ids=new Set(round.roster.map(r=>r.id)),keys=getKeys(round.mode);let changed=0;
    for(const u of updates){if(u.mode!==round.mode||!ids.has(u.id)||!keys.includes(u.key)||(round.mode==='hats'&&u.key!==round.hatKey))continue;if(round.responses[u.id]?.key===u.key)continue;round.responses[u.id]={key:u.key,source,at};if(round.notes[u.id])round.notes[u.id].handled=false;changed++;}return changed;
  }
  function summary(round){const distribution=Object.fromEntries(getKeys(round.mode).map(k=>[k,0]));let answered=0,handled=0;for(const r of round.roster){const a=round.responses[r.id];if(a&&Object.hasOwn(distribution,a.key)){distribution[a.key]++;answered++;if(round.notes[r.id]?.handled)handled++;}}return {total:round.roster.length,answered,unread:round.roster.length-answered,handled,pending:answered-handled,distribution};}
  function finish(state,round){if(!round)return;round.finishedAt=round.finishedAt||new Date().toISOString();state.history=[clone(round),...state.history.filter(s=>s.id!==round.id)].slice(0,100);}
  function updateHistory(state,round){if(!round?.finishedAt)return;state.history=state.history.map(s=>s.id===round.id?clone(round):s);}
  function comparison(before,after){if(!before||!after||before.mode!=='feelings'||after.mode!=='feelings'||before.demo!==after.demo||after.parentId!==before.id)return null;if(before.choices.some(b=>{const a=after.choices.find(c=>c.key===b.key);return !a||a.label!==b.label||a.hint!==b.hint;})||before.roster.length!==after.roster.length||before.roster.some(b=>!after.roster.some(a=>a.id===b.id&&a.name===b.name)))return null;let paired=0,changed=0;const rows=[];for(const p of after.roster){const b=before.responses[p.id],a=after.responses[p.id];if(!b||!a)continue;paired++;if(b.key!==a.key)changed++;rows.push({id:p.id,name:p.name,before:b.key,after:a.key});}return {paired,changed,rows};}
  function csv(round){const safe=v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['نوع السجل','القسم','بداية الجولة','العنوان','السؤال','القبعة النشطة','البطاقة','الاسم','الإشارة','الرسالة','المصدر','المتابعة','ملاحظة المعلم','توقيت الجولة','إجراءات المعلم وتوقيتها']];for(const p of round.roster){const r=round.responses[p.id],c=round.choices.find(c=>c.key===r?.key),n=round.notes[p.id];rows.push([round.demo?'تجربة':'حصة',round.mode==='feelings'?'المشاعر والاحتياجات':'القبعات الست',round.createdAt,round.title,round.prompt,round.hatKey||'',ar(p.id),p.name,c?.label||'لم تسجل إشارة',c?.hint||'',r?({camera:'كاميرا',image:'صورة',manual:'إدخال المعلم',demo:'صورة تجريبية'}[r.source]):'',r?(n?.handled?'تمت المتابعة':'بانتظار المتابعة'):'',n?.text||'',({before:'قبل النشاط',during:'أثناء النشاط',after:'بعد النشاط'}[round.stage]),round.actions.map(a=>a.at+' — '+a.text).join(' | ')]);}return '\ufeff'+rows.map(r=>r.map(safe).join(',')).join('\r\n');}
  const api={MODES,COLORS,feelings,hats,FLOW,ar,clone,choices,defaults,settings,createRound,validateRound,validateState,commit,summary,finish,updateHistory,comparison,csv,getKeys};
  root.LearningCore=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
