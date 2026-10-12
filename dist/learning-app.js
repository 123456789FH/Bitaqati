(() => {
  'use strict';
  const C=window.LearningCore,V=window.SignalVision,$=id=>document.getElementById(id);
  if(!C||!V)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hatIcon=(color,extra='')=>`<svg class="hat-icon ${extra}" viewBox="0 0 88 64" aria-hidden="true"><path d="M22 43 28 13q16-7 32 0l6 30" fill="${color}" stroke="#35483f" stroke-width="2"/><path d="M23 34h42l2 10H21z" fill="#fff" opacity=".8"/><ellipse cx="44" cy="46" rx="37" ry="10" fill="${color}" stroke="#35483f" stroke-width="2"/></svg>`;
  const dots=()=>`<span class="color-dots" aria-hidden="true">${C.feelings.map(c=>`<i style="background:${C.COLORS[c.key]}"></i>`).join('')}</span>`;
  const encode=data=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)),b=>String.fromCharCode(b)).join(''));
  const decode=data=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(data),b=>b.charCodeAt(0))));
  const titleOf=mode=>mode==='feelings'?'مشاعري واحتياجي':'القبعات الست';
  const labelFor=(round,key)=>round.choices.find(c=>c.key===key)?.label||'';
  const sourceLabel=source=>({camera:'كاميرا',image:'صورة',manual:'إدخال المعلم',demo:'تجربة'}[source]||'');
  const stageLabel=stage=>({before:'قبل النشاط',during:'أثناء النشاط',after:'بعد النشاط'}[stage]);
  const STORAGE='bitaqati-learning-v2';
  let state=C.defaults(),loadError=false,mode='feelings',selectedHat='blue',flowIndex=0;
  let stream=null,detector=null,tracker=null,frameTimer=null,epoch=0,pendingCamera=false,lastVideoTime=-1,facing='environment',saveTimer=null,flashTimer=null;
  let currentView='setup';
  const nav=document.createElement('nav');nav.id='learning-nav';nav.className='learning-nav';nav.setAttribute('aria-label','أقسام بطاقتي');
  nav.innerHTML=`<button type="button" data-mode="feelings" class="mode-tile"><span class="mode-art">${dots()}</span><strong>مشاعري واحتياجي</strong><small>عبّر ببطاقة… واستمع إلى المتعلم</small></button><button type="button" data-mode="hats" class="mode-tile"><span class="mode-art">${hatIcon('#d4e6f6')}</span><strong>القبعات الست</strong><small>فكّروا معًا… من أكثر من زاوية</small></button><button type="button" data-mode="quiz" class="mode-tile"><span class="mode-art quiz-art" aria-hidden="true">أ ب ج د</span><strong>أسئلة التقويم</strong><small>أسئلة الدرس والبطاقات السابقة</small></button>`;
  document.querySelector('.app-header').after(nav);
  const root=document.createElement('main');root.id='learning-app';root.className='shell learning-shell';$('teacher-app').before(root);
  root.innerHTML=`
    <div class="page-intro learning-intro"><div><p class="eyebrow" id="learn-eyebrow">مساحة للتعبير والاستماع</p><h1 id="learn-title">لكل متعلم… صوت يُسمع.</h1><p id="learn-description">التعبير اختياري. اختر بطاقة تعبّر عن شعورك أو احتياجك الآن.</p></div><button class="button quiet" type="button" id="learn-help">دليل الاستخدام</button></div>
    <div id="learn-notice" class="notice" role="status" aria-live="polite" hidden></div>
    <section id="learn-setup" aria-label="إعداد الجولة">
      <div class="learning-setup-grid">
        <div class="panel learning-main-panel">
          <div class="section-heading"><div><p class="eyebrow" id="learn-cards-eyebrow">ست بطاقات… ورسائل مختلفة</p><h2 id="learn-cards-heading">اختر ما ترغب في التعبير عنه</h2></div><span class="soft-tag" id="learn-mode-tag">دون درجات</span></div>
          <div id="learn-palette" class="learning-palette"></div>
          <p class="learning-guidance" id="learn-guidance"></p>
          <label for="learn-prompt" id="learn-prompt-label">السؤال المعروض للمتعلمين</label><textarea id="learn-prompt" rows="2" maxlength="500"></textarea>
          <div class="learning-stage-row" id="learn-stage-row"><label for="learn-stage">توقيت الجولة</label><select id="learn-stage"><option value="before">قبل النشاط</option><option value="during" selected>أثناء النشاط</option><option value="after">بعد النشاط</option></select></div>
          <div id="learn-hat-flow" class="hat-flow" hidden></div>
          <details id="learn-edit-labels"><summary>عدّل عبارات بطاقات المشاعر</summary><p class="small-note">تبقى الألوان ثابتة. بعد تعديل العبارة، أعد طباعة بطاقاتها؛ الجولات السابقة تحتفظ بعباراتها.</p><div id="learn-label-editor" class="label-editor"></div><button type="button" class="button secondary" id="learn-save-labels">احفظ العبارات</button><button type="button" class="button quiet" id="learn-default-labels">استعد العبارات الأساسية</button></details>
          <div class="form-footer"><span class="muted" id="learn-save-status" role="status">يحفظ الإعداد على هذا المتصفح</span><button type="button" class="button primary" id="learn-start">ابدأ جولة المشاعر</button></div>
        </div>
        <aside class="learning-side">
          <section class="panel"><p class="eyebrow">جهّز لقاءك</p><h2>العنوان والبطاقات</h2><label for="learn-topic">عنوان اللقاء أو الدرس</label><input id="learn-topic" maxlength="100"><label for="learn-count">عدد المتعلمين</label><select id="learn-count"></select><p id="learn-count-help" class="small-note"></p><details><summary>أسماء المتعلمين — اختياري</summary><label for="learn-names">اسم واحد في كل سطر بحسب رقم البطاقة</label><textarea id="learn-names" rows="4" maxlength="4000"></textarea></details><button type="button" class="button secondary full" id="learn-print">بطاقات هذا القسم وطباعتها</button><p class="small-note">ست بطاقات لكل متعلم. ارفع بطاقة واحدة، وأظهر الرمز كاملًا.</p></section>
          <section class="try-panel"><p class="eyebrow">اختبر القراءة أولًا</p><h3>تجربة من صورة جاهزة</h3><p>يقرأ القارئ ثلاث بطاقات رقمية. تظهر النتائج بعنوان «تجربة».</p><button type="button" class="button secondary full" id="learn-demo">جرّب ثلاث بطاقات</button></section>
          <div class="learning-tools"><button type="button" class="button quiet" id="learn-history">سجل الجولات</button><button type="button" class="button quiet" id="learn-backup">نسخة احتياطية</button><button type="button" class="button quiet" id="learn-restore">استعادة نسخة</button><input type="file" id="learn-backup-file" accept="application/json,.json" hidden></div>
        </aside>
      </div>
    </section>
    <section id="learn-session" aria-label="الجولة الحالية" hidden>
      <div class="section-heading"><div><p class="eyebrow" id="learn-session-meta"></p><h2 id="learn-session-title"></h2></div><div class="inline-actions"><button class="button secondary" type="button" id="learn-show-display">عرض للمتعلمين</button><button class="button quiet" type="button" id="learn-copy-display">انسخ رابط العرض</button><button class="button quiet" type="button" id="learn-new">جولة جديدة</button></div></div>
      <div class="learning-session-question" id="learn-session-question"></div>
      <div id="learn-session-legend" class="session-legend"></div>
      <div class="learning-metrics"><div><span>إشارات مسجلة</span><strong id="learn-read">٠</strong></div><div><span>لم تُسجّل إشارة</span><strong id="learn-unread">٠</strong></div><div><span>تمت متابعتها</span><strong id="learn-handled">٠</strong></div></div>
      <div class="learning-session-grid">
        <section class="panel camera-panel" id="learn-camera-panel">
          <div class="camera-stage"><video id="learn-video" playsinline muted></video><canvas id="learn-overlay"></canvas><div id="learn-camera-placeholder"><span class="camera-glyph" aria-hidden="true">▣</span><h3>أظهر البطاقة كاملة</h3><p>اقرأ بطاقات هذا القسم المرقمة. تدوير البطاقة لا يغيّر رسالتها.</p></div></div>
          <div id="learn-camera-status" class="camera-status" role="status" aria-live="polite">الكاميرا متوقفة</div>
          <div class="camera-actions"><button type="button" id="learn-camera-start" class="button primary">تشغيل الكاميرا</button><button type="button" id="learn-camera-stop" class="button secondary" hidden>إيقاف مؤقت</button><button type="button" id="learn-camera-switch" class="button quiet">تبديل الكاميرا</button><button type="button" id="learn-upload" class="button quiet">اقرأ من صورة</button><input type="file" id="learn-image-file" accept="image/png,image/jpeg,image/webp" hidden></div>
          <p class="small-note">تُسجّل آخر إشارة مستقرة لكل متعلم. علامة الاستلام تؤكد قراءة البطاقة فقط.</p>
          <details id="learn-manual-panel"><summary>سجّل بطاقة يدويًا عند الحاجة</summary><div class="manual-row"><label>رقم المتعلم<select id="learn-manual-id"></select></label><label>البطاقة<select id="learn-manual-key"></select></label><button type="button" class="button secondary" id="learn-manual-save">سجّل الإشارة</button></div></details>
        </section>
        <section class="panel"><div class="section-heading"><div><p class="eyebrow">لوحة المعلم</p><h3 id="learn-responses-heading">ماذا عبّر المتعلمون؟</h3></div><span id="learn-round-status" class="soft-tag"></span></div><div id="learn-distribution" class="signal-distribution"></div><p class="small-note" id="learn-records-note"></p><div id="learn-student-grid" class="signal-student-grid"></div><button type="button" id="learn-finish" class="button primary full">إنهاء الجولة</button><button type="button" id="learn-continue" class="button secondary full" hidden>استكمل الجولة</button></section>
      </div>
      <section class="panel followup-panel"><div class="section-heading"><div><p class="eyebrow">من الإشارة إلى الاستجابة</p><h3 id="learn-followup-title">طلبات المتابعة وملاحظات المعلم</h3></div><button type="button" class="button secondary" id="learn-csv">تنزيل سجل هذه الجولة</button></div><p class="small-note" id="learn-followup-note"></p><div id="learn-followups" class="followup-list"></div><div class="learning-action-row"><label for="learn-action">إجراء اتخذته في هذه الجولة</label><select id="learn-action"><option value="">اختر إجراءً</option><option>قدمت توضيحًا أو مثالًا آخر</option><option>ناقشت سؤالًا</option><option>أتحت وقتًا إضافيًا</option><option>استمعت إلى فكرة أو شرح</option><option>رتبت حديثًا على انفراد</option><option>قدمت دعمًا مناسبًا</option><option>لخصنا الأفكار وحددنا الخطوة التالية</option></select><button type="button" class="button secondary" id="learn-action-save">أضف الإجراء</button></div><div id="learn-actions-log"></div></section>
      <section class="panel comparison-panel" id="learn-comparison" hidden></section>
      <div class="result-actions"><button type="button" class="button primary" id="learn-next-round">جولة متابعة بعد النشاط</button><button type="button" class="button secondary" id="learn-session-history">سجل الجولات</button><button type="button" class="button quiet" id="learn-back-settings">إعدادات القسم</button></div>
    </section>
    <footer class="app-footer"><span>أ/ فاطمة هزازي</span></footer>
    <canvas id="learn-work" hidden></canvas>
  `;
  const dialog=document.createElement('dialog');dialog.id='learning-dialog';dialog.innerHTML='<div class="dialog-heading"><h2 id="learning-dialog-title"></h2><button type="button" class="button quiet" id="learning-dialog-close" aria-label="إغلاق">×</button></div><div id="learning-dialog-body"></div>';document.body.append(dialog);
  $('learning-dialog-close').addEventListener('click',()=>dialog.close());
  const display=document.createElement('main');display.id='learning-display';display.className='learning-display';display.hidden=true;document.body.append(display);
  const printRoot=document.createElement('div');printRoot.id='learning-print-root';printRoot.className='learning-print-root';document.body.append(printRoot);
  const overlay=$('learn-overlay'),overlayCtx=overlay.getContext('2d'),work=$('learn-work'),ctx=work.getContext('2d',{willReadFrequently:true});
  function notify(message,kind='info'){const n=$('learn-notice');n.textContent=message;n.dataset.kind=kind;n.hidden=!message;}
  function modal(title,html){$('learning-dialog-title').textContent=title;$('learning-dialog-body').innerHTML=html;if(!dialog.open)dialog.showModal();}
  function persist(){if(loadError){$('learn-save-status').textContent='بيانات سابقة تحتاج مراجعة. صدّرها قبل استبدالها.';return false;}try{localStorage.setItem(STORAGE,JSON.stringify(state));$('learn-save-status').textContent='تم الحفظ على هذا المتصفح';return true;}catch{$('learn-save-status').textContent='تعذر الحفظ المحلي';notify('تعذر الحفظ على هذا المتصفح. نزّل نسخة احتياطية قبل إغلاق الصفحة.','error');return false;}}
  function current(){return state.current[mode]||null;}
  function saveCurrent(){C.updateHistory(state,current());persist();}
  function sharedDisplay(data){
    if(!data||data.v!==2||!C.MODES.includes(data.mode)||typeof data.prompt!=='string'||data.prompt.length>500||typeof data.title!=='string'||data.title.length>100||!Array.isArray(data.choices)||data.choices.length!==6)throw new Error('رابط عرض غير صالح.');
    const keys=C.getKeys(data.mode);if(new Set(data.choices.map(c=>c.key)).size!==6||data.choices.some(c=>!keys.includes(c.key)||typeof c.label!=='string'||c.label.length>55||typeof c.hint!=='string'||c.hint.length>100))throw new Error('بيانات عرض غير صالحة.');
    if(data.mode==='hats'&&!keys.includes(data.hatKey))throw new Error('قبعة عرض غير صالحة.');
    $('teacher-app').hidden=true;root.hidden=true;nav.hidden=true;document.querySelector('.app-header').hidden=true;display.hidden=false;
    const choices=data.mode==='hats'?data.choices.filter(c=>c.key===data.hatKey):data.choices;
    display.innerHTML=`<p class="eyebrow">بطاقتي · ${titleOf(data.mode)}</p><h1>${esc(data.title)}</h1><h2>${esc(data.prompt)}</h2><div class="display-learning-cards ${data.mode==='hats'?'single-hat':''}">${choices.map(c=>`<article class="display-learning-card" style="--signal:${C.COLORS[c.key]}">${data.mode==='hats'?hatIcon(C.COLORS[c.key]):`<span class="display-dot" style="background:${C.COLORS[c.key]}" aria-hidden="true"></span>`}<h3>${esc(c.label)}</h3><p>${esc(c.hint)}</p></article>`).join('')}</div><p class="display-instruction">${data.mode==='feelings'?'اختر ما ترغب في التعبير عنه، وارفع بطاقة واحدة. يمكنك عدم المشاركة الآن.':'فكّر في السؤال مع المجموعة، ثم ارفع بطاقة القبعة الحالية إذا رغبت في المشاركة.'}</p><button type="button" class="button secondary" id="learning-fullscreen">ملء الشاشة</button><footer>أ/ فاطمة هزازي</footer>`;
    $('learning-fullscreen').addEventListener('click',()=>document.documentElement.requestFullscreen?.().catch(()=>{}));
  }
  if(location.hash.startsWith('#show=')){root.hidden=true;nav.hidden=true;return;}
  if(location.hash.startsWith('#learn=')){try{if(location.hash.length>20000)throw new Error();sharedDisplay(decode(decodeURIComponent(location.hash.slice(7))));}catch{root.hidden=true;nav.hidden=true;$('teacher-app').hidden=true;document.querySelector('.app-header').hidden=true;display.hidden=false;display.textContent='تعذر فتح العرض. انسخ رابط العرض من جديد.';}return;}
  try{const saved=localStorage.getItem(STORAGE);if(saved)state=C.validateState(JSON.parse(saved));else{try{const old=JSON.parse(localStorage.getItem('bitaqati-v1'));if(old?.draft){const d=window.Bitaqati.draft(old.draft);state.settings.count=d.count;state.settings.names=d.names;state.settings.title=d.title;}}catch{}}}catch{loadError=true;}
  function countHelp(){const count=Number($('learn-count').value);$('learn-count-help').textContent='الأرقام المستخدمة: من ١ إلى '+C.ar(count)+'. لتجربة بطاقة برقم أكبر، ارفع العدد ليشملها.';}
  function readSettings(){
    const s=C.clone(state.settings);s.title=$('learn-topic').value;s.count=Number($('learn-count').value);s.names=$('learn-names').value.split(/\r?\n/).map(x=>x.trim());while(s.names.length&&!s.names.at(-1))s.names.pop();
    if(mode==='feelings')s.feelingsPrompt=$('learn-prompt').value;else if(mode==='hats')s.hatPrompts[selectedHat]=$('learn-prompt').value;
    return C.settings(s);
  }
  function saveSettings(){state.settings=readSettings();persist();}
  function scheduleSettings(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{saveSettings();}catch{$('learn-save-status').textContent='أكمل الإعداد لحفظه';}},250);}
  function renderEditor(){
    $('learn-label-editor').innerHTML=C.feelings.map(c=>`<div class="label-editor-row"><span class="color-swatch" style="background:${C.COLORS[c.key]}" aria-hidden="true"></span><strong>${c.name}</strong><label>العبارة<input maxlength="55" data-label="${c.key}" value="${esc(state.settings.labels[c.key].label)}"></label><label>رسالة مساعدة<input maxlength="100" data-hint="${c.key}" value="${esc(state.settings.labels[c.key].hint)}"></label></div>`).join('');
  }
  function renderSetup(){
    const isFeeling=mode==='feelings',cs=C.choices(mode,state.settings);
    $('learn-topic').value=state.settings.title;$('learn-count').value=String(state.settings.count);$('learn-names').value=state.settings.names.join('\n');countHelp();
    $('learn-eyebrow').textContent=isFeeling?'مساحة للتعبير والاستماع':'نفكر معًا من زوايا مختلفة';$('learn-title').textContent=isFeeling?'لكل متعلم… صوت يُسمع.':'قبعة واحدة الآن… وأفكار متعددة.';
    $('learn-description').textContent=isFeeling?'اختيار المتعلم لبطاقته هو مصدر الإشارة. تتيح البطاقات التعبير عن الشعور والاحتياج.':'انتقل بالمجموعة بين طرق التفكير. كل قبعة تفتح سؤالًا جديدًا، وكل فكرة تستحق الاستماع.';
    $('learn-cards-eyebrow').textContent=isFeeling?'ست بطاقات… ورسائل مختلفة':'اختر القبعة النشطة للمجموعة';$('learn-cards-heading').textContent=isFeeling?'اختر ما ترغب في التعبير عنه':'بأي طريقة نفكّر الآن؟';$('learn-mode-tag').textContent=isFeeling?'التعبير اختياري':'الجميع بالقبعة نفسها';
    $('learn-palette').innerHTML=cs.map(c=>isFeeling?`<article class="signal-card" style="--signal:${c.color}"><span class="signal-color" style="background:${c.color}"><span class="signal-symbol" aria-hidden="true">${esc(c.symbol)}</span></span><div><span class="signal-color-name">${c.name}</span><h3>${esc(c.label)}</h3><p>${esc(c.hint)}</p></div></article>`:`<button type="button" class="signal-card hat-picker ${selectedHat===c.key?'selected':''}" data-hat="${c.key}" aria-pressed="${selectedHat===c.key}" style="--signal:${c.color}">${hatIcon(c.color)}<div><span class="signal-color-name">القبعة ${c.name}</span><h3>${esc(c.label)}</h3><p>${esc(c.hint)}</p></div></button>`).join('');
    $('learn-guidance').textContent=isFeeling?'يمكن للمتعلم عدم رفع بطاقة. الإشارات تعبيرات ذاتية، وليست درجات أو قياسًا للإتقان. البطاقة البيضاء تطلب حديثًا على انفراد؛ البطاقة نفسها مرئية داخل الصف.':'نتبادل أنواع التفكير معًا، ولا نخصص قبعة ثابتة لشخص. يرفع المتعلم بطاقة القبعة النشطة بعد التفكير إذا رغب في المشاركة، ثم دوّن فكرته عند الاستماع إليه.';
    $('learn-prompt-label').textContent=isFeeling?'السؤال المعروض للمتعلمين':'سؤال القبعة النشطة';$('learn-prompt').value=isFeeling?state.settings.feelingsPrompt:state.settings.hatPrompts[selectedHat];
    $('learn-edit-labels').hidden=!isFeeling;$('learn-stage-row').hidden=!isFeeling;$('learn-hat-flow').hidden=isFeeling;
    if(!isFeeling){$('learn-hat-flow').innerHTML='<strong>تسلسل مقترح</strong><div>'+C.FLOW.map((k,i)=>`<button type="button" class="flow-step ${i===flowIndex?'active':''}" data-flow="${i}" aria-label="المرحلة ${C.ar(i+1)}، القبعة ${C.hats.find(c=>c.key===k).name}"><i style="background:${C.COLORS[k]}"></i>${C.ar(i+1)}</button>`).join('')+'</div><p class="small-note">الزرقاء لبدء التنظيم ثم الختام. يمكنك اختيار قبعة تناسب هدفك مباشرة.</p>';
      $('learn-palette').querySelectorAll('[data-hat]').forEach(b=>b.addEventListener('click',()=>chooseHat(b.dataset.hat)));
      $('learn-hat-flow').querySelectorAll('[data-flow]').forEach(b=>b.addEventListener('click',()=>chooseHat(C.FLOW[+b.dataset.flow],+b.dataset.flow)));
    }
    $('learn-start').textContent=isFeeling?'ابدأ جولة المشاعر':'ابدأ القبعة '+C.hats.find(c=>c.key===selectedHat).name;
    renderEditor();
  }
  function chooseHat(key,index){try{saveSettings();}catch(e){notify(e.message,'error');return;}selectedHat=key;flowIndex=Number.isInteger(index)?index:Math.max(0,C.FLOW.indexOf(key));renderSetup();}
  function setMode(next,saveDraft=true){
    if(!['feelings','hats','quiz'].includes(next))return;
    stopCamera();clearTimeout(saveTimer);if(saveDraft&&mode!=='quiz'){try{saveSettings();}catch{}}
    mode=next;nav.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
    $('teacher-app').hidden=mode!=='quiz';root.hidden=mode==='quiz';document.querySelector('.header-actions').hidden=mode!=='quiz';
    window.dispatchEvent(new CustomEvent('bitaqati-mode-change',{detail:{mode}}));
    if(mode==='quiz')return;
    state.activeMode=mode;persist();const s=current();if(mode==='hats'&&s){selectedHat=s.hatKey;flowIndex=s.flowIndex;}
    renderSetup();if(s)showRound();else showSetup();
  }
  function showSetup(){currentView='setup';$('learn-setup').hidden=false;$('learn-session').hidden=true;renderSetup();}
  function newRound(options={}){
    stopCamera();clearTimeout(saveTimer);saveSettings();const old=current();if(old)C.finish(state,old);
    const opts={hatKey:selectedHat,flowIndex,stage:$('learn-stage').value,...options};state.current[mode]=C.createRound(mode,state.settings,opts);persist();notify('');showRound();
  }
  function showRound(){
    const s=current();if(!s)return;currentView='session';$('learn-setup').hidden=true;$('learn-session').hidden=false;
    $('learn-session-meta').textContent=(s.demo?'تجربة رقمية · ليست بيانات متعلمين':'جولة الحصة')+' · '+titleOf(s.mode)+' · '+(s.mode==='feelings'?stageLabel(s.stage):'المرحلة '+C.ar(s.flowIndex+1));
    $('learn-session-title').textContent=s.title;$('learn-session-question').textContent=s.prompt;
    const legend=s.mode==='hats'?s.choices.filter(c=>c.key===s.hatKey):s.choices;
    $('learn-session-legend').innerHTML=legend.map(c=>`<span class="legend-chip"><i style="background:${c.color}"></i>${s.mode==='hats'?'القبعة '+c.name+' · ':''}${esc(c.label)}</span>`).join('');
    $('learn-records-note').textContent=s.mode==='feelings'?'التعبيرات اختيارية. عدم تسجيل إشارة لا يحدد شعور المتعلم.':'القراءة تسجل طلب المشاركة بالقبعة الحالية. الفكرة توثّق بعد الاستماع إلى المتعلم.';
    $('learn-followup-note').textContent=s.mode==='feelings'?'تظهر هذه التفاصيل للمعلم. استخدم «عرض للمتعلمين» لعرض التعليمات دون الأسماء والسجل.':'دوّن فكرة المتعلم بعد الاستماع إليه، ثم اختر «تمت المشاركة». رفع البطاقة وحده ليس دليلًا على جودة الفكرة.';
    $('learn-followup-title').textContent=s.mode==='feelings'?'طلبات المتابعة وملاحظات المعلم':'طلبات المشاركة والأفكار';
    $('learn-responses-heading').textContent=s.mode==='feelings'?'ماذا عبّر المتعلمون؟':'من يرغب في المشاركة؟';
    $('learn-next-round').textContent=s.mode==='feelings'?'جولة متابعة بعد النشاط':s.flowIndex>=C.FLOW.length-1?'ابدأ دورة تفكير جديدة':'انتقل إلى القبعة التالية';
    $('learn-manual-id').innerHTML=s.roster.map(p=>`<option value="${p.id}">${C.ar(p.id)}${p.name?' · '+esc(p.name):''}</option>`).join('');
    $('learn-manual-key').innerHTML=legend.map(c=>`<option value="${c.key}">${esc(c.label)}</option>`).join('');
    renderRound();
  }
  function renderRound(){
    const s=current();if(!s)return;const sum=C.summary(s),finished=Boolean(s.finishedAt);
    $('learn-read').textContent=C.ar(sum.answered);$('learn-unread').textContent=C.ar(sum.unread);$('learn-handled').textContent=C.ar(sum.handled);$('learn-round-status').textContent=finished?'جولة مكتملة':'الجولة مفتوحة';
    $('learn-camera-panel').hidden=finished;$('learn-finish').hidden=finished;$('learn-continue').hidden=!finished||s.demo;
    $('learn-camera-start').disabled=s.demo||pendingCamera;$('learn-upload').disabled=s.demo;$('learn-manual-panel').hidden=s.demo;
    const palette=s.mode==='hats'?s.choices.filter(c=>c.key===s.hatKey):s.choices;
    $('learn-distribution').innerHTML=palette.map(c=>`<div class="distribution-row"><i style="background:${c.color}" class="color-swatch"></i><span>${esc(c.label)}</span><strong>${C.ar(sum.distribution[c.key])}</strong></div>`).join('');
    $('learn-student-grid').innerHTML=s.roster.map(p=>{const r=s.responses[p.id],c=s.choices.find(c=>c.key===r?.key);return `<div class="signal-student ${r?'received':''}" style="--signal:${c?.color||'#dce3de'}"><strong>${C.ar(p.id)}</strong><small>${r?'تم التسجيل':'لم تسجل إشارة'}</small></div>`;}).join('');
    renderFollowups();renderComparison();
  }
  function renderFollowups(){
    const focused=document.activeElement;const focusNote=focused?.id?.startsWith('learn-note-')?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;
    const s=current();if(!s)return;const read=s.roster.filter(p=>s.responses[p.id]);
    $('learn-followups').innerHTML=read.length?read.map(p=>{const r=s.responses[p.id],c=s.choices.find(c=>c.key===r.key),n=s.notes[p.id]||{text:'',handled:false};return `<article class="followup-item ${n.handled?'handled':''}" data-student="${p.id}"><div class="followup-top"><span class="number-disc">${C.ar(p.id)}</span><div><strong>${esc(p.name||'بطاقة '+C.ar(p.id))}</strong><p><i class="tiny-swatch" style="background:${c.color}"></i>${esc(c.label)} <small>· ${sourceLabel(r.source)}</small></p></div><button type="button" class="button ${n.handled?'quiet':'secondary'}" data-handle="${p.id}">${n.handled?'أعد فتح المتابعة':s.mode==='hats'?'تمت المشاركة':'تمت المتابعة'}</button></div>${s.mode==='feelings'?`<p class="small-note">${esc(c.action)}</p>`:''}<label class="note-label" for="learn-note-${p.id}">${s.mode==='hats'?'الفكرة التي سمعتها':'ملاحظة المعلم في هذه الجولة'}</label><textarea id="learn-note-${p.id}" rows="2" maxlength="600" data-note="${p.id}" placeholder="دوّن ملاحظة قصيرة عند الحاجة">${esc(n.text)}</textarea></article>`;}).join(''):'<p class="muted empty-state">تظهر هنا البطاقات التي تم تسجيلها، مع فرصة لتدوين المتابعة.</p>';
    $('learn-followups').querySelectorAll('[data-handle]').forEach(b=>b.addEventListener('click',()=>{const id=+b.dataset.handle;const n=s.notes[id]||{text:'',handled:false};n.handled=!n.handled;s.notes[id]=n;saveCurrent();renderRound();}));
    $('learn-followups').querySelectorAll('[data-note]').forEach(t=>t.addEventListener('input',()=>{const id=+t.dataset.note;s.notes[id]={text:t.value.slice(0,600),handled:s.notes[id]?.handled||false};saveCurrent();}));
    if(focusNote){const next=$(focusNote.id);if(next){next.focus({preventScroll:true});if(typeof next.setSelectionRange==='function'&&Number.isInteger(focusNote.start))next.setSelectionRange(focusNote.start,focusNote.end);}}
    $('learn-actions-log').innerHTML=s.actions.map(a=>`<span class="action-chip">${esc(a.text)}</span>`).join('');
  }
  function renderComparison(){
    const s=current(),parent=state.history.find(r=>r.id===s?.parentId),data=C.comparison(parent,s);const panel=$('learn-comparison');panel.hidden=!data;
    if(data)panel.innerHTML=`<p class="eyebrow">قبل المتابعة وبعدها</p><h3>تعبيرات في جولتين</h3><p>قورنت إشارات ${C.ar(data.paired)} من المتعلمين الذين سُجلت بطاقاتهم في الجولتين. تغيّرت البطاقة لدى ${C.ar(data.changed)} منهم.</p><p class="small-note">يعرض هذا تغيّر التعبير الذاتي، ولا يقيس الإتقان أو يثبت سبب التغيّر. من لم تُقرأ بطاقته في إحدى الجولتين لا يدخل في المقارنة.</p><details><summary>عرض الانتقالات للمعلم</summary><div class="table-wrap"><table><thead><tr><th>البطاقة</th><th>في الجولة السابقة</th><th>في هذه الجولة</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td>${C.ar(r.id)}</td><td>${esc(labelFor(parent,r.before))}</td><td>${esc(labelFor(s,r.after))}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function receive(updates,source){const s=current();if(!s)return 0;const changed=C.commit(s,updates,source);if(changed){persist();renderRound();}return changed;}
  function stopCamera(message='الكاميرا متوقفة'){
    epoch++;clearTimeout(frameTimer);frameTimer=null;clearTimeout(flashTimer);flashTimer=null;if(stream){const old=stream;stream=null;old.getTracks().forEach(t=>t.stop());}$('learn-video').srcObject=null;$('learn-camera-start').hidden=false;$('learn-camera-stop').hidden=true;$('learn-camera-placeholder').hidden=false;overlayCtx.clearRect(0,0,overlay.width,overlay.height);$('learn-camera-status').textContent=message;
  }
  function diagnostic(result){
    if(result.ambiguous.length)return 'ظهرت بطاقتان للمتعلم نفسه: '+result.ambiguous.map(C.ar).join('، ')+'. أظهر بطاقة واحدة.';
    if(result.wrongMode.length)return 'هذه بطاقات القسم الآخر. استخدم بطاقات '+titleOf(mode)+'.';
    if(result.unknown.length)return 'أرقام خارج قائمة الجولة: '+result.unknown.map(C.ar).join('، ')+'. عدّل عدد المتعلمين في جولة جديدة.';
    if(result.otherKeys.length)return 'القبعة النشطة هي '+C.hats.find(c=>c.key===current()?.hatKey)?.name+'. أظهر بطاقة هذه القبعة.';
    return '';
  }
  function markOverlay(found,width,height){
    overlayCtx.clearRect(0,0,width,height);const s=current();if(!s)return;const ids=new Set(s.roster.map(p=>p.id));
    for(const d of found){if(d.mode!==mode||!ids.has(d.id)||(mode==='hats'&&d.key!==s.hatKey))continue;overlayCtx.strokeStyle='#7de9c6';overlayCtx.lineWidth=Math.max(3,width/300);overlayCtx.beginPath();d.corners.forEach((p,i)=>i?overlayCtx.lineTo(p.x,p.y):overlayCtx.moveTo(p.x,p.y));overlayCtx.closePath();overlayCtx.stroke();const p=d.corners[0];overlayCtx.fillStyle='#173d34';overlayCtx.fillRect(p.x,p.y-28,52,28);overlayCtx.font='bold 19px sans-serif';overlayCtx.fillStyle='#fff';overlayCtx.fillText(C.ar(d.id),p.x+9,p.y-7);}
  }
  async function startCamera(){
    const s=current();if(pendingCamera||!s||s.finishedAt||s.demo)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){notify('افتح التطبيق عبر رابط HTTPS في المتصفح للسماح بالكاميرا. يمكنك القراءة من صورة أيضًا.','error');return;}
    stopCamera();const e=epoch,sid=s.id;pendingCamera=true;$('learn-camera-start').disabled=true;$('learn-camera-status').textContent='جارٍ طلب الكاميرا…';
    try{const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}}});if(e!==epoch||document.hidden||current()?.id!==sid){next.getTracks().forEach(t=>t.stop());return;}stream=next;const video=$('learn-video');video.srcObject=next;await video.play();if(e!==epoch||current()?.id!==sid){next.getTracks().forEach(t=>t.stop());return;}
      detector=V.createDetector();tracker=V.createTracker(mode,s.roster.map(p=>p.id),{allowedKey:s.hatKey});lastVideoTime=-1;$('learn-camera-placeholder').hidden=true;$('learn-camera-start').hidden=true;$('learn-camera-stop').hidden=false;notify('');
      next.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(stream===next)stopCamera('توقفت الكاميرا. أعد تشغيلها عند الاستعداد.');},{once:true}));scanFrame(e,sid);
    }catch(error){stopCamera();const messages={NotAllowedError:'لم يُسمح بالكاميرا. اسمح بها من إعدادات الموقع، وافتح الرابط في المتصفح مباشرة.',NotFoundError:'لم تُعثر على كاميرا. استخدم القراءة من صورة.',NotReadableError:'الكاميرا مستخدمة أو غير متاحة. أغلق التطبيق الذي يستخدمها ثم حاول مجددًا.'};notify(messages[error.name]||'تعذر تشغيل الكاميرا. جرّب القراءة من صورة.','error');}finally{pendingCamera=false;$('learn-camera-start').disabled=Boolean(current()?.demo);}
  }
  function scanFrame(e,sid){
    if(e!==epoch||!stream||current()?.id!==sid||current().finishedAt)return;const video=$('learn-video');
    if(video.readyState>=2&&video.videoWidth&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;const scale=Math.min(1,1440/Math.max(video.videoWidth,video.videoHeight));const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);if(work.width!==width||work.height!==height){work.width=width;work.height=height;}if(overlay.width!==width||overlay.height!==height){overlay.width=width;overlay.height=height;}
      try{ctx.drawImage(video,0,0,width,height);const found=detector.detect(ctx.getImageData(0,0,width,height));const result=tracker.push(found,performance.now());receive(result.updates,'camera');const eligible=V.classify(found,mode,current().roster.map(p=>p.id),{allowedKey:current().hatKey});markOverlay(eligible.updates,width,height);const msg=diagnostic(result);if(msg){clearTimeout(flashTimer);$('learn-camera-status').textContent=msg;flashTimer=setTimeout(()=>{flashTimer=null;if(stream)$('learn-camera-status').textContent='المسح يعمل · أظهر بطاقة واحدة لكل متعلم.';},1800);}else if(!flashTimer)$('learn-camera-status').textContent='المسح يعمل · سُجلت '+C.ar(C.summary(current()).answered)+' من '+C.ar(current().roster.length);}
      catch{stopCamera('توقف المسح بسبب تعذر معالجة إطار.');notify('أعد تشغيل الكاميرا أو جرّب القراءة من صورة.','error');return;}
    }frameTimer=setTimeout(()=>scanFrame(e,sid),140);
  }
  const loadImage=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر فتح الصورة.'));img.src=url;});
  async function readImage(img,source='image'){
    const s=current();if(!s||s.finishedAt)return;const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)throw new Error('الصورة فارغة.');const scale=Math.min(1,2200/Math.max(w,h));work.width=Math.round(w*scale);work.height=Math.round(h*scale);ctx.drawImage(img,0,0,work.width,work.height);const found=V.createDetector().detect(ctx.getImageData(0,0,work.width,work.height));const result=V.classify(found,mode,s.roster.map(p=>p.id),{allowedKey:s.hatKey});receive(result.updates,source);const msg=diagnostic(result);notify((result.updates.length?'تمت قراءة '+C.ar(result.updates.length)+' بطاقات. ':'')+(msg||(!result.updates.length?'لم تُقرأ بطاقة صالحة. أظهر الرمز كاملًا وتحقق من القسم والرقم.':'')),result.updates.length&&!msg?'info':'error');return result;
  }
  async function demo(){
    $('learn-demo').disabled=true;stopCamera();const demoMode=mode,demoEpoch=epoch;
    try{saveSettings();const old=current();if(old)C.finish(state,old);const config=C.clone(state.settings);config.count=3;config.names=[];state.current[mode]=C.createRound(mode,config,{demo:true,hatKey:selectedHat,flowIndex,stage:'during'});const sid=current().id;persist();showRound();const canvas=document.createElement('canvas');canvas.width=1260;canvas.height=450;const cc=canvas.getContext('2d');cc.fillStyle='#f7f6f0';cc.fillRect(0,0,1260,450);const keys=mode==='feelings'?['red','green','blue']:[selectedHat,selectedHat,selectedHat];
      for(let id=1;id<=3;id++){const key=keys[id-1],url=URL.createObjectURL(new Blob([V.markerSvg(demoMode,id,key)],{type:'image/svg+xml'}));let img;try{img=await loadImage(url);}finally{URL.revokeObjectURL(url);}if(epoch!==demoEpoch||mode!==demoMode||current()?.id!==sid)return;cc.fillStyle=C.COLORS[key];cc.fillRect((id-1)*420+12,10,396,430);cc.save();cc.translate((id-1)*420+210,220);cc.rotate((id-1)*Math.PI/2);cc.drawImage(img,-170,-170,340,340);cc.restore();}
      if(epoch!==demoEpoch||mode!==demoMode||current()?.id!==sid||current().finishedAt)return;const result=await readImage(canvas,'demo');C.finish(state,current());persist();renderRound();notify('تجربة رقمية: قُرئت '+C.ar(result?.updates.length||0)+' من ٣ بطاقات. هذه ليست بيانات متعلمين.',result?.updates.length===3?'info':'error');
    }catch(error){notify(error.message||'تعذر إتمام التجربة.','error');}finally{$('learn-demo').disabled=false;}
  }
  function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
  function backup(){if(!loadError){clearTimeout(saveTimer);try{saveSettings();}catch{}}download(loadError?(localStorage.getItem(STORAGE)||JSON.stringify(state,null,2)):JSON.stringify(state,null,2),'application/json;charset=utf-8','بطاقتي_المشاعر_والقبعات_'+new Date().toISOString().slice(0,10)+'.json');}
  function displayUrl(){const s=current();if(!s)return;const data={v:2,mode:s.mode,title:s.title,prompt:s.prompt,hatKey:s.hatKey,choices:s.choices.map(({key,label,hint})=>({key,label,hint}))};const url=new URL(location.href);url.hash='learn='+encodeURIComponent(encode(data));return url.href;}
  async function copyDisplay(){const url=displayUrl();if(!url)return;try{await navigator.clipboard.writeText(url);notify('نُسخ رابط التعليمات. لا يحتوي أسماء أو مشاعر فردية، ولا يزامن النتائج.');}catch{modal('رابط عرض المتعلمين',`<p>انسخ الرابط من الحقل التالي. يُعرض المحتوى فقط على الجهاز الآخر.</p><textarea rows="4" readonly id="learning-copy-link">${esc(url)}</textarea>`);$('learning-copy-link').select();}}
  function openDisplay(){const url=displayUrl();if(!url)return;const opened=window.open(url,'_blank','noopener');if(!opened)notify('إذا لم تفتح نافذة العرض، استخدم «انسخ رابط العرض».');}
  function cardHtml(s,c,cardMode,settings){return `<section class="learning-paper-card" style="--signal:${c.color}"><header><span>${cardMode==='feelings'?'مشاعري واحتياجي':'القبعات الست'}</span><strong>المتعلم ${C.ar(s.id)}</strong></header><div class="learning-paper-body"><div class="learning-paper-text">${cardMode==='hats'?hatIcon(c.color):`<span class="paper-color" style="background:${c.color}" aria-hidden="true">${esc(c.symbol||'')}</span>`}<span class="paper-color-label">${cardMode==='hats'?'القبعة ':''}${esc(c.name)}</span><h2>${esc(c.label)}</h2><p>${esc(c.hint)}</p>${s.name?`<span class="paper-name">${esc(s.name)}</span>`:''}</div><div class="learning-paper-marker">${V.markerSvg(cardMode,s.id,c.key)}</div></div><footer>أ/ فاطمة هزازي</footer></section>`;}
  function showPrint(){
    try{saveSettings();}catch(e){notify(e.message,'error');return;}
    const n=state.settings.count;
    modal('بطاقات '+titleOf(mode),`<p>لكل متعلم ست بطاقات خاصة بهذا القسم. اختر الأرقام التي تريد طباعتها.</p><div class="print-range"><label>من رقم<input type="number" id="learning-print-from" min="1" max="40" value="1"></label><label>إلى رقم<input type="number" id="learning-print-to" min="1" max="40" value="${n}"></label></div><p class="small-note">طباعة ملونة، بحجم فعلي ١٠٠٪، وبطاقتان في كل ورقة A4. اترك الرمز ومساحته البيضاء كاملين. تُعرض البطاقات هنا حسب عباراتك المحفوظة.</p><button type="button" class="button primary" id="learning-print-generate">جهّز المعاينة</button><p id="learning-print-info" class="small-note"></p><div id="learning-card-preview" class="learning-card-preview"></div><button type="button" class="button primary full" id="learning-print-now" hidden>اطبع البطاقات</button>`);
    $('learning-print-generate').addEventListener('click',()=>{
      const from=+$('learning-print-from').value,to=+$('learning-print-to').value;if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>40||from>to){$('learning-print-info').textContent='اختر نطاقًا صحيحًا من ١ إلى ٤٠.';return;}
      const cs=C.choices(mode,state.settings);let all=[],sheets=[];for(let id=from;id<=to;id++)for(const c of cs)all.push(cardHtml({id,name:state.settings.names[id-1]||''},c,mode,state.settings));for(let i=0;i<all.length;i+=2)sheets.push('<div class="learning-paper-sheet">'+all.slice(i,i+2).join('')+'</div>');printRoot.innerHTML=sheets.join('');$('learning-card-preview').innerHTML=all.slice(0,6).join('');$('learning-print-info').textContent=C.ar(all.length)+' بطاقة على '+C.ar(sheets.length)+' أوراق. المعاينة أدناه لست بطاقات المتعلم '+C.ar(from)+'.'+(to>n?' تنبيه: أرقام الطباعة أكبر من عدد الجولة الحالي؛ ارفع العدد عند استخدامها.':'');$('learning-print-now').hidden=false;
    });
    $('learning-print-now').addEventListener('click',()=>{dialog.close();document.body.classList.add('printing-learning');window.print();});$('learning-print-generate').click();
  }
  function showHistory(){
    const rounds=state.history.filter(r=>r.mode===mode);
    modal('سجل '+titleOf(mode),`<p class="small-note">أحدث ١٠٠ جولة للقسمين محفوظة على هذا المتصفح. السجل التجريبي يحمل علامة واضحة.</p><div class="learning-history">${rounds.length?rounds.map(r=>{const sum=C.summary(r);return `<article class="learning-history-row"><div><strong>${esc(r.title)}</strong><small>${r.demo?'تجربة · ':''}${esc(new Date(r.createdAt).toLocaleString('ar-SA',{calendar:'gregory'}))}</small><p>${esc(r.prompt)}</p><p>سُجلت ${C.ar(sum.answered)} من ${C.ar(sum.total)} · تمت متابعة ${C.ar(sum.handled)}</p></div><div class="inline-actions"><button type="button" class="button secondary" data-open-round="${r.id}">افتح السجل</button><button type="button" class="button quiet" data-csv-round="${r.id}">CSV</button></div></article>`;}).join(''):'<p class="muted">لا توجد جولات مكتملة في هذا القسم.</p>'}</div>`);
    $('learning-dialog-body').querySelectorAll('[data-csv-round]').forEach(b=>b.addEventListener('click',()=>{const r=state.history.find(r=>r.id===b.dataset.csvRound);if(r)download(C.csv(r),'text/csv;charset=utf-8','بطاقتي_سجل_'+r.createdAt.slice(0,10)+'.csv');}));
    $('learning-dialog-body').querySelectorAll('[data-open-round]').forEach(b=>b.addEventListener('click',()=>{const roundId=b.dataset.openRound;const selected=state.history.find(r=>r.id===roundId);stopCamera();if(current()&&!current().finishedAt)C.finish(state,current());const r=state.history.find(r=>r.id===roundId)||selected;if(!r)return;state.current[mode]=C.clone(r);persist();dialog.close();showRound();}));
  }
  function help(){modal('استخدام المشاعر والقبعات الست',`<div class="learning-help"><h3>مشاعري واحتياجي</h3><p>اختَر العدد، ثم اطبع ست بطاقات لكل متعلم. اعرض السؤال، واطلب بطاقة واحدة ممن يرغب في المشاركة. اللون والعبارة يعبّران عن اختيار المتعلم نفسه، دون تحليل للوجوه.</p><p>الأصفر: أحتاج دعمًا. الأبيض: أريد الحديث على انفراد. البطاقة مرئية في الصف؛ رتّب تفاصيل الحديث بشكل فردي. عدم رفع بطاقة يعني فقط أن إشارة لم تُسجّل.</p><h3>القبعات الست</h3><p>حدّد الموضوع والقبعة النشطة. يفكر الجميع بالطريقة نفسها في هذه الجولة، ثم يرفع من يرغب بالمشاركة بطاقة تلك القبعة. دوّن الفكرة عند الاستماع، ثم اضغط «تمت المشاركة». انتقل بعد ذلك إلى القبعة التالية.</p><p>البيضاء للمعلومات، الحمراء للمشاعر دون تبرير، الصفراء للفوائد، السوداء للمحاذير بأسباب، الخضراء للبدائل، والزرقاء لتنظيم التفكير. القبعات طرق تفكير وليست صفات ثابتة للأشخاص.</p><h3>الكاميرا والطباعة</h3><p>التطبيق يقرأ الرمز الأسود والأبيض المطبوع داخل البطاقة الملونة. أظهر رمزًا كاملًا، واترك الهامش الأبيض حوله. بطاقات المشاعر والقبعات وأسئلة التقويم مجموعات مختلفة. لتجربة البطاقة ٤٠ اجعل عدد المتعلمين ٤٠.</p><p>جرب «جرّب ثلاث بطاقات»، ثم اختبر الطباعة والكاميرا على جهازك. تدوير بطاقات هذين القسمين لا يغير رسالتها. الورقة الملونة السادة لا تحمل معرفًا يمكن تسجيله هنا.</p><h3>الحفظ والعرض</h3><p>يعرض زر «عرض للمتعلمين» التعليمات فقط. الأسماء والإشارات والملاحظات في لوحة المعلم. النتائج تحفظ في متصفح هذا الجهاز ولا تتزامن بين الأجهزة. نسخة المشاعر والقبعات الاحتياطية مستقلة عن نسخة أسئلة التقويم.</p><p>الصور تعالج داخل المتصفح. لا تُحفظ صورة الكاميرا ضمن السجل. لا توجد درجات صحة أو خطأ أو تشخيص نفسي في هذين القسمين.</p><p><a href="https://www.debono.com/six-thinking-hats-summary" target="_blank" rel="noopener">مرجع معاني القبعات الست لدى دي بونو</a></p></div>`);}
  for(let i=1;i<=40;i++)$('learn-count').insertAdjacentHTML('beforeend',`<option value="${i}">${C.ar(i)}</option>`);
  nav.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  ['learn-topic','learn-prompt','learn-names'].forEach(id=>$(id).addEventListener('input',scheduleSettings));$('learn-count').addEventListener('change',()=>{countHelp();scheduleSettings();});
  $('learn-save-labels').addEventListener('click',()=>{try{saveSettings();const draft=C.clone(state.settings);for(const c of C.feelings){draft.labels[c.key]={label:$('learn-label-editor').querySelector(`[data-label="${c.key}"]`).value,hint:$('learn-label-editor').querySelector(`[data-hint="${c.key}"]`).value};}state.settings=C.settings(draft);persist();renderSetup();notify('حُفظت عباراتك. اطبع البطاقات بالعبارات الجديدة قبل توزيعها.');}catch(e){notify(e.message,'error');}});
  $('learn-default-labels').addEventListener('click',()=>{state.settings.labels=C.defaults().settings.labels;persist();renderSetup();notify('استُعيدت العبارات الأساسية لبطاقات المشاعر.');});
  $('learn-start').addEventListener('click',()=>{try{newRound();}catch(e){notify(e.message,'error');}});$('learn-new').addEventListener('click',()=>{stopCamera();C.finish(state,current());persist();showSetup();});$('learn-back-settings').addEventListener('click',()=>{stopCamera();showSetup();});
  $('learn-demo').addEventListener('click',demo);$('learn-print').addEventListener('click',showPrint);$('learn-help').addEventListener('click',help);$('learn-history').addEventListener('click',showHistory);$('learn-session-history').addEventListener('click',showHistory);$('learn-backup').addEventListener('click',backup);
  $('learn-camera-start').addEventListener('click',startCamera);$('learn-camera-stop').addEventListener('click',()=>stopCamera('المسح متوقف مؤقتًا · الإشارات محفوظة'));$('learn-camera-switch').addEventListener('click',()=>{facing=facing==='environment'?'user':'environment';const running=Boolean(stream);stopCamera(facing==='environment'?'اختيرت الكاميرا الخلفية':'اختيرت الكاميرا الأمامية');if(running)startCamera();});
  $('learn-manual-save').addEventListener('click',()=>{const s=current();if(!s||s.demo||s.finishedAt)return;const changed=receive([{mode,id:+$('learn-manual-id').value,key:$('learn-manual-key').value}],'manual');notify(changed?'سُجلت الإشارة بعلامة «إدخال المعلم».':'هذه الإشارة مسجلة مسبقًا؛ بقي مصدرها كما هو.');});
  $('learn-finish').addEventListener('click',()=>{stopCamera();C.finish(state,current());persist();renderRound();});$('learn-continue').addEventListener('click',()=>{const s=current();if(!s||s.demo)return;s.finishedAt=null;persist();renderRound();notify('فُتحت الجولة. يمكن تحديث الإشارات أو إضافة ما لم يُسجّل.');});
  $('learn-csv').addEventListener('click',()=>{const s=current();if(s)download(C.csv(s),'text/csv;charset=utf-8','بطاقتي_'+titleOf(mode).replaceAll(' ','_')+'_'+s.createdAt.slice(0,10)+'.csv');});
  $('learn-action-save').addEventListener('click',()=>{const s=current(),value=$('learn-action').value;if(!s||!value)return;if(s.actions.length>=30){notify('بلغت هذه الجولة الحد الأقصى للإجراءات.','error');return;}s.actions.push({text:value,at:new Date().toISOString()});saveCurrent();$('learn-action').value='';renderFollowups();});
  $('learn-next-round').addEventListener('click',()=>{try{const old=current();if(!old)return;if(old.demo){showSetup();notify('انتهت التجربة. اضغط ابدأ لإنشاء جولة فعلية.');return;}const config=C.clone(state.settings);config.title=old.title;config.count=old.roster.length;config.names=old.roster.map(p=>p.name);if(mode==='feelings'){config.labels=Object.fromEntries(old.choices.map(c=>[c.key,{label:c.label,hint:c.hint}]));config.feelingsPrompt=old.prompt;}state.settings=C.settings(config);stopCamera();C.finish(state,old);if(mode==='hats'){flowIndex=old.flowIndex>=C.FLOW.length-1?0:old.flowIndex+1;selectedHat=C.FLOW[flowIndex];}state.current[mode]=C.createRound(mode,state.settings,{hatKey:selectedHat,flowIndex,stage:mode==='feelings'?'after':'during',groupId:old.groupId,parentId:old.id});state.current[mode].roster=C.clone(old.roster);persist();renderSetup();showRound();}catch(e){notify(e.message,'error');}});
  $('learn-show-display').addEventListener('click',openDisplay);$('learn-copy-display').addEventListener('click',copyDisplay);
  $('learn-upload').addEventListener('click',()=>{stopCamera();$('learn-image-file').click();});
  $('learn-image-file').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';const s=current();if(!file||!s||s.demo||s.finishedAt)return;if(file.size>15*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){notify('اختر صورة PNG أو JPG أو WebP لا تتجاوز ١٥ ميجابايت.','error');return;}const sid=s.id,selectedMode=mode,imageEpoch=epoch,url=URL.createObjectURL(file);try{const img=await loadImage(url);if(epoch===imageEpoch&&mode===selectedMode&&current()===s&&current()?.id===sid&&!current().finishedAt&&currentView==='session')await readImage(img);}catch(error){notify(error.message,'error');}finally{URL.revokeObjectURL(url);}});
  $('learn-restore').addEventListener('click',()=>$('learn-backup-file').click());
  $('learn-backup-file').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>8*1024*1024)throw new Error('اختر نسخة لا تتجاوز ٨ ميجابايت.');const proposed=C.validateState(JSON.parse(await file.text()));modal('استعادة نسخة المشاعر والقبعات',`<p>تحتوي النسخة ${C.ar(proposed.history.length)} جولة مكتملة. ستستبدل بيانات هذين القسمين على هذا المتصفح. سننزّل نسخة من البيانات الحالية قبل الاستبدال.</p><div class="dialog-actions"><button type="button" class="button primary" id="learn-restore-confirm">استعد النسخة</button><button type="button" class="button secondary" id="learn-restore-cancel">إلغاء</button></div>`);$('learn-restore-cancel').addEventListener('click',()=>dialog.close());$('learn-restore-confirm').addEventListener('click',()=>{try{backup();localStorage.setItem(STORAGE+'-before-restore',localStorage.getItem(STORAGE)||JSON.stringify(state));localStorage.setItem(STORAGE,JSON.stringify(proposed));stopCamera();clearTimeout(saveTimer);state=proposed;loadError=false;dialog.close();setMode(state.activeMode,false);notify('تمت استعادة نسخة المشاعر والقبعات.');}catch{notify('تعذر حفظ النسخة المستعادة. بقيت البيانات الحالية دون استبدال.','error');}});}catch(error){notify(error instanceof SyntaxError?'تعذر قراءة الملف. اختر نسخة JSON صدرت من هذين القسمين.':error.message,'error');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||pendingCamera))stopCamera('توقف المسح عند مغادرة الصفحة. شغّله للاستكمال.');});window.addEventListener('pagehide',()=>stopCamera());window.addEventListener('afterprint',()=>document.body.classList.remove('printing-learning'));
  // Programmatic mode switching is also used by the original question module.
  window.BitaqatiLearning=Object.freeze({setMode,stopCamera});
  mode=state.activeMode;renderSetup();setMode(state.activeMode,false);if(loadError)notify('تعذر قراءة بيانات سابقة لهذين القسمين. بقيت محفوظة دون استبدال. استخدم نسخة احتياطية صحيحة.','error');
})();
