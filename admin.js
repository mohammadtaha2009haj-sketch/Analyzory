const SUPABASE_URL = "https://sysfgcybdrofzfyxrkbg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Lu9MZhp_sFFOpw-bfN2-cQ_e7IIRK5B";
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $ = (s,root=document)=>root.querySelector(s); const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(id,text,kind=''){const e=$('#'+id);if(e){e.textContent=text;e.className='admin-status'+(kind?' '+kind:'');}}
function busy(button,on,label){if(!button)return;button.disabled=on;if(on){button.dataset.old=button.textContent;button.textContent='در حال انجام...';}else if(button.dataset.old){button.textContent=button.dataset.old;delete button.dataset.old;}}
let adminUser=null; let pendingFactorId=null; let pendingMfaMode=null; let pendingFactorIsUnverified=false;
let adminKnownBookingIds = null;
function adminBrowserNotify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { const n = new Notification(title, { body, tag, icon: '/assets/taha-hero-logo.png' }); n.onclick = () => { window.focus(); n.close(); }; }
  catch (err) { console.warn('Admin notification unavailable', err); }
}
async function watchForNewAdminBookings() {
  if (!adminUser || !db) return;
  try {
    const {data,error}=await db.from('bookings').select('id,full_name,requested_service_name,is_urgent,created_at').order('created_at',{ascending:false}).limit(200);
    if (error || !Array.isArray(data)) return;
    const ids = new Set(data.map(b=>b.id));
    if (adminKnownBookingIds === null) { adminKnownBookingIds = ids; return; }
    const fresh = data.filter(b=>!adminKnownBookingIds.has(b.id));
    adminKnownBookingIds = ids;
    fresh.reverse().forEach(b=>adminBrowserNotify(b.is_urgent?'رزرو فوری جدید':'رزرو جدید', `${b.full_name} — ${b.requested_service_name}${b.is_urgent?' · اولویت Fast':''}`, 'taha-new-booking-'+b.id));
  } catch (err) { console.warn('New booking notification check failed', err); }
}

const mfaMarkerKey=userId=>'taha_mfa_setup_factor_'+userId;
function showMfaPanel(which){$('#mfaEnrollPanel').hidden=which!=='enroll';$('#mfaChallengePanel').hidden=which!=='challenge';}
function hideMfaPanels(){showMfaPanel('none');}
async function verifyAdminRole(){
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if(sessionError)throw sessionError;
  if(!session)throw new Error('نشست ورود پیدا نشد؛ دوباره وارد شو.');
  const {data:profile,error}=await db.from('profiles').select('role').eq('id',session.user.id).maybeSingle();
  if(error)throw error;
  if(profile?.role!=='admin')throw new Error('این حساب دسترسی مدیر ندارد. شناسه کاربر را در جدول profiles با نقش admin ثبت کن.');
  return session.user;
}
async function finishAdminLogin(){
  adminUser=await verifyAdminRole();
  $('#loginForm').hidden=true;hideMfaPanels();$('#adminLogin').hidden=true;$('#adminApp').hidden=false;
  await Promise.all([loadBookings(),loadContact(),loadServices(),loadProfits(),loadBackgroundSettings()]);
  adminKnownBookingIds = null; await watchForNewAdminBookings();
}
async function startMfaFlow(){
  const user=await verifyAdminRole();
  const {data,error}=await db.auth.mfa.listFactors();
  if(error)throw error;
  const totpFactors=data?.totp||[];
  const verified=totpFactors.find(f=>f.status==='verified');
  if(verified){
    localStorage.removeItem(mfaMarkerKey(user.id));
    pendingFactorId=verified.id;pendingMfaMode='challenge';pendingFactorIsUnverified=false;
    showMfaPanel('challenge');
    $('#mfaChallengeForm').reset();status('mfaChallengeStatus','کد فعلی برنامه Authenticator را وارد کن.');
    $('#mfaChallengeForm input[name="code"]').focus();return;
  }
  const unverified=totpFactors.find(f=>f.status!=='verified');
  const rememberedFactor=localStorage.getItem(mfaMarkerKey(user.id));
  if(unverified && rememberedFactor===unverified.id){
    // The secret has already been shown for this factor; never show it again on a reload.
    pendingFactorId=unverified.id;pendingMfaMode='resume-enroll';pendingFactorIsUnverified=true;
    showMfaPanel('challenge');$('#mfaChallengeForm').reset();
    status('mfaChallengeStatus','کلید قبلاً نمایش داده شده است و دوباره نشان داده نمی‌شود. کد Authenticator را وارد کن.');
    $('#mfaChallengeForm input[name="code"]').focus();return;
  }
  // An unverified enrollment without a matching marker cannot safely reuse its secret; remove it and create a new one.
  for(const factor of totpFactors.filter(f=>f.status!=='verified')){
    const {error:removeError}=await db.auth.mfa.unenroll({factorId:factor.id});
    if(removeError)throw removeError;
  }
  const {data:enrollment,error:enrollError}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'TAHA Admin Authenticator'});
  if(enrollError)throw enrollError;
  pendingFactorId=enrollment.id;pendingMfaMode='enroll';pendingFactorIsUnverified=true;
  $('#mfaSecret').textContent=enrollment.totp?.secret||'';
  if(!enrollment.totp?.secret)throw new Error('Supabase کلید TOTP را برنگرداند. تنظیمات MFA پروژه را بررسی کن.');
  localStorage.setItem(mfaMarkerKey(user.id),enrollment.id);
  $('#loginForm').hidden=true;showMfaPanel('enroll');$('#mfaEnrollForm').reset();
  status('mfaEnrollStatus','کلید فقط برای این راه‌اندازی نمایش داده می‌شود. آن را در Authenticator ذخیره کن، سپس کد ۶ رقمی را وارد کن.');
  $('#mfaEnrollForm input[name="code"]').focus();
}
async function challengeAndVerify(code){
  if(!pendingFactorId)throw new Error('مرحله تأیید آماده نیست؛ دوباره با ایمیل و رمز عبور وارد شو.');
  const {data:challenge,error:challengeError}=await db.auth.mfa.challenge({factorId:pendingFactorId});
  if(challengeError)throw challengeError;
  const {error:verifyError}=await db.auth.mfa.verify({factorId:pendingFactorId,challengeId:challenge.id,code:String(code).replace(/\D/g,'')});
  if(verifyError)throw verifyError;
  if(adminUser?.id) localStorage.removeItem(mfaMarkerKey(adminUser.id));
  pendingFactorId=null;pendingMfaMode=null;pendingFactorIsUnverified=false;hideMfaPanels();$('#mfaSecret').textContent='';
  await finishAdminLogin();
}
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!db){status('loginStatus','اتصال Supabase در دسترس نیست.','error');return;}
  const b=e.submitter;busy(b,true);status('loginStatus','در حال بررسی ایمیل و رمز عبور...');
  try{const fd=new FormData(e.currentTarget);const {error}=await db.auth.signInWithPassword({email:fd.get('email'),password:fd.get('password')});if(error)throw error;await startMfaFlow();}
  catch(err){await db.auth.signOut();hideMfaPanels();$('#loginForm').hidden=false;status('loginStatus','ورود یا راه‌اندازی تأیید دومرحله‌ای ناموفق بود: '+(err.message||'خطای ناشناخته'),'error');}
  finally{busy(b,false);}
});
$('#copyMfaSecret').addEventListener('click',async()=>{
  const secret=$('#mfaSecret').textContent.trim();if(!secret)return;
  try{await navigator.clipboard.writeText(secret);status('mfaEnrollStatus','کلید کپی شد؛ آن را در برنامه Authenticator اضافه کن.','success');}
  catch{const range=document.createRange();range.selectNodeContents($('#mfaSecret'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);status('mfaEnrollStatus','کلید انتخاب شد؛ آن را کپی کن.','success');}
});
$('#mfaEnrollForm').addEventListener('submit',async e=>{
  e.preventDefault();const b=e.submitter;busy(b,true);status('mfaEnrollStatus','در حال تأیید کد...');
  try{const code=new FormData(e.currentTarget).get('code');if(!/^\d{6}$/.test(String(code)))throw new Error('کد باید دقیقاً ۶ رقم باشد.');await challengeAndVerify(code);}
  catch(err){status('mfaEnrollStatus','تأیید ناموفق بود: '+err.message,'error');}
  finally{busy(b,false);}
});
$('#mfaChallengeForm').addEventListener('submit',async e=>{
  e.preventDefault();const b=e.submitter;busy(b,true);status('mfaChallengeStatus','در حال بررسی کد...');
  try{const code=new FormData(e.currentTarget).get('code');if(!/^\d{6}$/.test(String(code)))throw new Error('کد باید دقیقاً ۶ رقم باشد.');await challengeAndVerify(code);}
  catch(err){status('mfaChallengeStatus','کد تأیید نشد: '+err.message,'error');}
  finally{busy(b,false);}
});


$$('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{$$('[data-tab]').forEach(b=>b.classList.toggle('active',b===btn));$$('.admin-panel').forEach(p=>p.hidden=p.id!==btn.dataset.tab);if(btn.dataset.tab==='profitPanel')loadProfits();}));
async function bootAdmin(){
  if(!db){$('#adminLogin').hidden=false;status('loginStatus','اتصال Supabase در دسترس نیست.','error');return;}
  // Always start at the password step on the dedicated admin page; this makes the next step the Authenticator code.
  try{await db.auth.signOut();}catch{}
  $('#adminLogin').hidden=false;$('#adminApp').hidden=true;$('#loginForm').hidden=false;hideMfaPanels();
}
const weekdays=[{n:0,t:'یکشنبه'},{n:1,t:'دوشنبه'},{n:2,t:'سه‌شنبه'},{n:3,t:'چهارشنبه'},{n:4,t:'پنجشنبه'},{n:5,t:'جمعه'},{n:6,t:'شنبه'}];
async function loadBookings(){
  status('bookingsStatus','در حال بارگذاری...');
  try{
    const {data,error}=await db.from('bookings').select('id,full_name,phone,business_type,business_name,requested_service_name,is_urgent,status,description,form_answers,created_at,scheduled_at').order('created_at',{ascending:false}).limit(200);
    if(error)throw error;
    const now=Date.now();
    const isDone=b=>!!b.scheduled_at && new Date(b.scheduled_at).getTime()<=now;
    data?.sort((a,b)=>{if(isDone(a)!==isDone(b))return isDone(a)?1:-1;if(!!a.is_urgent!==!!b.is_urgent)return a.is_urgent?-1:1;const delta=new Date(a.created_at).getTime()-new Date(b.created_at).getTime();return a.is_urgent?delta:-delta;});
    $('#bookingsList').innerHTML=!data?.length?'<p class="admin-hint">هنوز رزروی ثبت نشده است.</p>':data.map(b=>{
      const completed=!!b.scheduled_at && new Date(b.scheduled_at).getTime()<=now;
      const stamp=`<div class="completion-stamp-wrap" ${completed?'':'hidden'}><span class="completed-stamp" aria-label="پروژه انجام شد">انجام شد</span></div>`;
      return `<article class="admin-booking ${completed?'is-completed':''} ${b.is_urgent?'is-urgent':''}" data-id="${esc(b.id)}">${b.is_urgent?'<span class="fast-ribbon">Fast</span>':''}<div class="admin-booking-head"><strong>${esc(b.full_name)} — ${esc(b.requested_service_name)}</strong><span>${esc(new Date(b.created_at).toLocaleString('fa-IR'))}</span></div>${stamp}<p>${esc(b.phone)} · ${esc(b.business_type)}${b.business_name?' · '+esc(b.business_name):''} · ${b.is_urgent?'فوری':'عادی'}</p><p>${esc(b.description||'بدون توضیحات')}</p><p>جزئیات فرم: ${esc(JSON.stringify(b.form_answers||{}))}</p><div class="admin-grid"><label>وضعیت رزرو<select class="booking-status" data-id="${esc(b.id)}"><option value="pending" ${b.status==='pending'?'selected':''}>در صف انتظار</option><option value="reviewing" ${b.status==='reviewing'?'selected':''}>در حال بررسی</option><option value="approved" ${b.status==='approved'?'selected':''}>تأیید شده</option><option value="rejected" ${b.status==='rejected'?'selected':''}>رد شده</option></select></label><label>زمان قطعی (اختیاری)<input class="booking-time" data-id="${esc(b.id)}" type="datetime-local" value="${b.scheduled_at?esc(new Date(b.scheduled_at).toISOString().slice(0,16)):''}"></label></div><div class="admin-actions"><button class="btn btn-glass save-booking-time" data-id="${esc(b.id)}" type="button">ذخیره زمان</button><button class="btn delete-booking delete-booking-btn" data-id="${esc(b.id)}" type="button">حذف کامل پروژه</button></div></article>`;
    }).join('');
    $$('.booking-status').forEach(el=>el.addEventListener('change',()=>updateBookingStatus(el.dataset.id,el.value)));
    $$('.save-booking-time').forEach(btn=>btn.addEventListener('click',async()=>{await saveBookingTime(btn.dataset.id,btn);await loadBookings();await loadProfits();}));
    $$('.delete-booking-btn').forEach(btn=>btn.addEventListener('click',async()=>{const card=btn.closest('.admin-booking');const title=$('strong',card)?.textContent||'این پروژه';if(!confirm(`پروژه «${title}» برای همیشه حذف شود؟ این کار اطلاعات رزرو و رکورد سود مرتبط را نیز حذف می‌کند و قابل بازگشت نیست.`))return;busy(btn,true);try{const id=btn.dataset.id;const {error:financeError}=await db.from('booking_financials').delete().eq('booking_id',id);if(financeError && !/does not exist|schema cache/i.test(financeError.message||''))throw financeError;const {error}=await db.from('bookings').delete().eq('id',id);if(error)throw error;card.remove();status('bookingsStatus','پروژه، رزرو و اطلاعات سود مرتبط حذف شدند.','success');await loadProfits();}catch(err){status('bookingsStatus','حذف پروژه ناموفق بود: '+err.message,'error');busy(btn,false);}}));
    status('bookingsStatus',`بارگذاری شد: ${data?.length||0} رزرو.`,'success');
    try{const {error:flagError}=await db.from('site_settings').update({has_new_booking:false,updated_at:new Date().toISOString()}).eq('id',1);if(!flagError){const dot=document.querySelector('#newBookingDot');if(dot)dot.hidden=true;}}catch{}
  }catch(err){status('bookingsStatus','بارگذاری رزروها ناموفق بود: '+err.message,'error');}
}
$('#reloadBookings').addEventListener('click',loadBookings);
setInterval(watchForNewAdminBookings, 30000);
let lastCompletedCount=-1;
function refreshCompletionStamps(){
  let completedCount=0;
  $$('.admin-booking').forEach(card=>{const input=$('.booking-time',card);const stamp=$('.completion-stamp-wrap',card);const done=!!input?.value && Number.isFinite(new Date(input.value).getTime()) && new Date(input.value).getTime()<=Date.now();if(stamp)stamp.hidden=!done;const was=card.classList.contains('is-completed');card.classList.toggle('is-completed',done);if(done&&!was)$('#bookingsList').appendChild(card);if(done)completedCount++;});
  if(completedCount!==lastCompletedCount){lastCompletedCount=completedCount;if(!$('#profitPanel').hidden)loadProfits();}
}
setInterval(refreshCompletionStamps,30000);
async function updateBookingStatus(id,newStatus){status('bookingsStatus','در حال ذخیره وضعیت...');try{const {error}=await db.rpc('admin_update_booking_status',{p_booking_id:id,p_new_status:newStatus});if(error)throw error;status('bookingsStatus','وضعیت رزرو ذخیره شد.','success');}catch(err){status('bookingsStatus','ذخیره وضعیت ناموفق بود: '+err.message,'error');}}
async function saveBookingTime(id,button){busy(button,true);try{const raw=$(`.booking-time[data-id="${CSS.escape(id)}"]`).value;const {error}=await db.from('bookings').update({scheduled_at:raw?new Date(raw).toISOString():null}).eq('id',id);if(error)throw error;status('bookingsStatus','زمان رزرو ذخیره شد.','success');}catch(err){status('bookingsStatus','ذخیره زمان ناموفق بود: '+err.message,'error');}finally{busy(button,false);}}
async function loadContact(){status('contactStatus','در حال بارگذاری...');try{const {data,error}=await db.from('site_settings').select('id,instagram_handle,telegram_handle,contact_phone').eq('id',1).maybeSingle();if(error)throw error;$('#instagramHandle').value=data?.instagram_handle||'';$('#telegramHandle').value=data?.telegram_handle||'';$('#contactPhone').value=data?.contact_phone||'';status('contactStatus','اطلاعات بارگذاری شدند.','success');}catch(err){status('contactStatus','بارگذاری اطلاعات ناموفق بود. اسکریپت SQL تکمیلی را اجرا کن. '+err.message,'error');}}
$('#reloadContact').addEventListener('click',loadContact);
$('#contactForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;busy(btn,true);try{const row={id:1,instagram_handle:$('#instagramHandle').value.trim().replace(/^@/,''),telegram_handle:$('#telegramHandle').value.trim().replace(/^@/,''),contact_phone:$('#contactPhone').value.trim(),updated_at:new Date().toISOString()};const {error}=await db.from('site_settings').upsert(row,{onConflict:'id'});if(error)throw error;status('contactStatus','اطلاعات تماس ذخیره شد.','success');}catch(err){status('contactStatus','ذخیره اطلاعات ناموفق بود: '+err.message,'error');}finally{busy(btn,false);}});
async function loadServices(){
  status('servicesStatus','در حال بارگذاری...');
  try{
    const {data,error}=await db.from('services').select('*').order('sort_order');if(error)throw error;
    $('#servicesList').innerHTML=(data||[]).map(s=>`<div class="admin-service" data-service-id="${esc(s.id)}"><label>نام<input class="service-name" value="${esc(s.name)}" required maxlength="100"></label><label>توضیح<input class="service-description" value="${esc(s.description||'')}" maxlength="500"></label><label style="flex-direction:row;align-items:center;gap:8px"><input class="service-active" type="checkbox" ${s.is_active?'checked':''} style="width:18px">نمایش در سایت</label><div class="admin-actions"><button class="btn btn-glass save-service" type="button">ذخیره خدمت</button><button class="btn btn-glass toggle-service-form" type="button">تنظیم فرم رزرو</button><button class="btn delete-booking delete-service" type="button">حذف خدمت</button></div><div class="service-form-builder" hidden><p class="admin-hint">فیلدهای فرم فعلی همین خدمت را ویرایش کن؛ این فیلدها در همان فرم اصلی رزرو نمایش داده می‌شوند.</p><div class="service-form-fields" data-fields-for="${esc(s.id)}"></div><form class="service-builder-add" data-add-field="${esc(s.id)}"><input name="label" placeholder="عنوان فیلد" maxlength="100" required><select name="field_type"><option value="text">متن کوتاه</option><option value="textarea">متن بلند</option><option value="number">عدد</option><option value="select">انتخابی</option></select><input name="options" placeholder="گزینه‌ها با ویرگول (برای انتخابی)" maxlength="500"><label style="flex-direction:row;align-items:center;gap:6px"><input name="required" type="checkbox" style="width:18px">الزامی</label><button class="btn btn-primary" type="submit">افزودن فیلد</button></form></div></div>`).join('');
    $$('.admin-service').forEach(card=>{
      const id=card.dataset.serviceId;
      $('.save-service',card).addEventListener('click',async()=>{try{const {error}=await db.from('services').update({name:$('.service-name',card).value.trim(),description:$('.service-description',card).value.trim(),is_active:$('.service-active',card).checked}).eq('id',id);if(error)throw error;status('servicesStatus','خدمت ذخیره شد.','success');}catch(e){status('servicesStatus','ذخیره خدمت ناموفق بود: '+e.message,'error');}});
      $('.delete-service',card).addEventListener('click',async e=>{
        const btn=e.currentTarget;const title=$('.service-name',card).value.trim()||'این خدمت';
        if(!confirm(`خدمت «${title}» برای همیشه حذف شود؟ فیلدهای فرم این خدمت هم حذف می‌شوند و قابل بازگشت نیست.`))return;
        busy(btn,true);
        try{
          const {error:fieldsError}=await db.from('service_form_fields').delete().eq('service_id',id);
          if(fieldsError && !/does not exist|schema cache/i.test(fieldsError.message||''))throw fieldsError;
          const {error}=await db.from('services').delete().eq('id',id);
          if(error)throw error;
          card.remove();status('servicesStatus','خدمت حذف شد.','success');
        }catch(err){status('servicesStatus','حذف خدمت ناموفق بود: '+err.message+' (اگر رزروهایی به این خدمت وصل هستند، به‌جای حذف، تیک «نمایش در سایت» را بردار.)','error');busy(btn,false);}
      });
      $('.toggle-service-form',card).addEventListener('click',async()=>{const builder=$('.service-form-builder',card);builder.hidden=!builder.hidden;if(!builder.hidden)await loadServiceFields(id,builder);});
      $('[data-add-field]',card).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),label=String(fd.get('label')||'').trim(),type=String(fd.get('field_type')),options=String(fd.get('options')||'').split(',').map(x=>x.trim()).filter(Boolean);if(type==='select'&&!options.length){status('servicesStatus','برای فیلد انتخابی، گزینه‌ها را با ویرگول جدا کن.','error');return;}const key='field_'+Math.random().toString(36).slice(2,10);try{const {data:existing}=await db.from('service_form_fields').select('sort_order').eq('service_id',id).order('sort_order',{ascending:false}).limit(1).maybeSingle();const {error}=await db.from('service_form_fields').insert({service_id:id,field_key:key,label,field_type:type,options:type==='select'?options:[],is_required:fd.get('required')==='on',sort_order:(existing?.sort_order||0)+1});if(error)throw error;form.reset();await loadServiceFields(id,$('.service-form-builder',card));status('servicesStatus','فیلد فرم اضافه شد.','success');}catch(err){status('servicesStatus','افزودن فیلد ناموفق بود؛ SQL تکمیلی را اجرا کن. '+err.message,'error');}});
    });
    status('servicesStatus',`خدمات بارگذاری شدند: ${data?.length||0}`,'success');
  }catch(err){status('servicesStatus','بارگذاری خدمات ناموفق بود: '+err.message,'error');}
}
async function loadServiceFields(serviceId,builder){
  const box=$('.service-form-fields',builder);box.innerHTML='<p class="admin-hint">در حال بارگذاری فیلدها...</p>';
  try{const {data,error}=await db.from('service_form_fields').select('*').eq('service_id',serviceId).order('sort_order');if(error)throw error;
    box.innerHTML=!data?.length?'<p class="admin-hint">هنوز فیلدی تنظیم نشده است؛ فرم پیش‌فرض خدمت نمایش داده می‌شود.</p>':data.map(f=>`<div class="service-field-row" data-field-id="${esc(f.id)}"><input class="field-label" value="${esc(f.label)}" maxlength="100" aria-label="عنوان فیلد"><select class="field-type" aria-label="نوع فیلد"><option value="text" ${f.field_type==='text'?'selected':''}>متن کوتاه</option><option value="textarea" ${f.field_type==='textarea'?'selected':''}>متن بلند</option><option value="number" ${f.field_type==='number'?'selected':''}>عدد</option><option value="select" ${f.field_type==='select'?'selected':''}>انتخابی</option></select><input class="field-options" value="${esc((f.options||[]).join(', '))}" placeholder="گزینه‌ها با ویرگول" aria-label="گزینه‌های فیلد"><label style="flex-direction:row;align-items:center;gap:5px"><input class="field-required" type="checkbox" ${f.is_required?'checked':''} style="width:17px">الزامی</label><button type="button" class="btn btn-glass save-field">ذخیره</button><button type="button" class="profit-delete delete-field">حذف</button></div>`).join('');
    $$('.service-field-row',box).forEach(row=>{row.querySelector('.save-field').addEventListener('click',async()=>{const type=row.querySelector('.field-type').value,options=row.querySelector('.field-options').value.split(',').map(x=>x.trim()).filter(Boolean);if(type==='select'&&!options.length){status('servicesStatus','برای فیلد انتخابی باید گزینه وارد شود.','error');return;}try{const {error}=await db.from('service_form_fields').update({label:row.querySelector('.field-label').value.trim(),field_type:type,options:type==='select'?options:[],is_required:row.querySelector('.field-required').checked}).eq('id',row.dataset.fieldId);if(error)throw error;status('servicesStatus','فیلد فرم ذخیره شد.','success');}catch(err){status('servicesStatus','ذخیره فیلد ناموفق بود: '+err.message,'error');}});row.querySelector('.delete-field').addEventListener('click',async()=>{if(!confirm('این فیلد از فرم این خدمت حذف شود؟'))return;try{const {error}=await db.from('service_form_fields').delete().eq('id',row.dataset.fieldId);if(error)throw error;await loadServiceFields(serviceId,builder);status('servicesStatus','فیلد حذف شد.','success');}catch(err){status('servicesStatus','حذف فیلد ناموفق بود: '+err.message,'error');}});});
  }catch(err){box.innerHTML='<p class="admin-hint">ساختار فرم‌های سفارشی آماده نیست؛ فایل SQL تکمیلی را در Supabase اجرا کن.</p>';console.warn(err);}
}
$('#newServiceForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const {data:latest}=await db.from('services').select('sort_order').order('sort_order',{ascending:false}).limit(1).maybeSingle();const {error}=await db.from('services').insert({name:fd.get('name').trim(),description:fd.get('description').trim(),is_active:true,sort_order:(latest?.sort_order||0)+1});if(error)throw error;e.currentTarget.reset();status('servicesStatus','خدمت جدید اضافه شد.','success');await loadServices();}catch(err){status('servicesStatus','افزودن خدمت ناموفق بود: '+err.message,'error');}});

function moneyFa(n){return new Intl.NumberFormat('fa-IR',{maximumFractionDigits:0}).format(Number(n)||0)+' تومان';}
async function loadProfits(){
  if(!db)return;
  status('profitStatus','در حال محاسبه پروژه‌های انجام‌شده...');
  try{
    const now=new Date().toISOString();
    const {data,error}=await db.from('bookings').select('id,requested_service_name,full_name,scheduled_at').not('scheduled_at','is',null).lte('scheduled_at',now).order('scheduled_at',{ascending:true}).limit(500);
    if(error)throw error;
    const bookingRows=data||[];
    let financials=[];
    if(bookingRows.length){const {data:financeData,error:financeError}=await db.from('booking_financials').select('booking_id,project_price,my_profit').in('booking_id',bookingRows.map(r=>r.id));if(financeError)throw financeError;financials=financeData||[];}
    const financeById=new Map(financials.map(f=>[f.booking_id,f]));
    const rows=bookingRows.map(r=>({...r,...(financeById.get(r.id)||{}),project_name:r.requested_service_name||'پروژه',profit:Number(financeById.get(r.id)?.my_profit)||0}));
    const total=rows.reduce((sum,r)=>sum+Number(r.my_profit||0),0);
    $('#totalProfit').textContent=moneyFa(total);
    $('#profitList').innerHTML=rows.length?rows.slice().reverse().map(r=>`<article class="profit-item" data-profit-booking="${esc(r.id)}"><div><strong>${esc(r.requested_service_name)} — ${esc(r.full_name)}</strong><span class="profit-done-label">✓ انجام شد · ${esc(new Date(r.scheduled_at).toLocaleString('fa-IR'))}</span><div class="profit-booking-fields"><label>قیمت پروژه (تومان)<input type="number" min="0" step="1000" class="completed-price" value="${Number(r.project_price)||0}"></label><label>سود من (تومان)<input type="number" min="0" step="1000" class="completed-profit" value="${Number(r.my_profit)||0}"></label><button type="button" class="btn btn-primary save-completed-profit" data-id="${esc(r.id)}">ذخیره</button></div></div></article>`).join(''):'<p class="admin-hint">هنوز پروژه‌ای با زمان شروع گذشته وجود ندارد. به‌محض گذشت زمان تعیین‌شده، پروژه در این بخش ظاهر می‌شود.</p>';
    renderProfitChart(rows.map(r=>({project_name:r.project_name,full_name:r.full_name,price:Number(r.project_price)||0,profit:Number(r.my_profit)||0})));
    $$('.save-completed-profit').forEach(btn=>btn.addEventListener('click',async()=>{
      const item=btn.closest('[data-profit-booking]');
      const price=Number($('.completed-price',item).value),profit=Number($('.completed-profit',item).value);
      if(!Number.isFinite(price)||!Number.isFinite(profit)||price<0||profit<0){status('profitStatus','قیمت و سود باید صفر یا عدد مثبت باشند.','error');return;}
      busy(btn,true);
      try{const {error}=await db.from('booking_financials').upsert({booking_id:btn.dataset.id,project_price:price,my_profit:profit,updated_at:new Date().toISOString()},{onConflict:'booking_id'});if(error)throw error;await loadProfits();status('profitStatus','قیمت و سود پروژه ذخیره شد.','success');}
      catch(err){status('profitStatus','ذخیره ناموفق بود؛ SQL جدید را در Supabase اجرا کن. '+err.message,'error');}
      finally{busy(btn,false);}
    }));
    status('profitStatus',`تعداد پروژه‌های انجام‌شده: ${rows.length}`,'success');
  }catch(err){status('profitStatus','بارگذاری پروژه‌های انجام‌شده ناموفق بود؛ SQL جدید را اجرا کن. '+err.message,'error');$('#profitChart').innerHTML='';}
}
function renderProfitChart(rows){
  const box=$('#profitChart');
  if(!rows.length){box.innerHTML='<p class="admin-hint">پس از ثبت قیمت و سود پروژه‌های انجام‌شده، نمودار خطی اینجا نمایش داده می‌شود.</p>';return;}
  const n=rows.length,pad=44,H=250,top=38,bottom=50,W=Math.max(700,pad*2+(n-1)*90);
  const prices=rows.map(r=>Number(r.price)||0),profits=rows.map(r=>Number(r.profit)||0);
  const max=Math.max(...prices,...profits,1);
  const xAt=i=>pad+(n===1?(W-pad*2)/2:i*(W-pad*2)/(n-1));
  const yAt=v=>H-bottom-(v/max)*(H-top-bottom);
  const numFa=v=>new Intl.NumberFormat('fa-IR',{maximumFractionDigits:0}).format(v);
  const line=vals=>vals.map((v,i)=>`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const guides=[0,1,2,3].map(i=>{const y=top+i*(H-top-bottom)/3;return `<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#ffffff12" stroke-dasharray="4 6"/>`;}).join('');
  const dots=(vals,color,series,dy)=>vals.map((v,i)=>`<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="4" fill="${color}" stroke="#092c28" stroke-width="2"><title>${esc(rows[i].project_name)} — ${esc(rows[i].full_name||'')}\n${series}: ${esc(moneyFa(v))}</title></circle><text x="${xAt(i).toFixed(1)}" y="${(yAt(v)+dy).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="10">${esc(numFa(v))}</text>`).join('');
  const labels=rows.map((r,i)=>{const name=String(r.full_name||r.project_name||'');return `<text x="${xAt(i).toFixed(1)}" y="${H-bottom+18}" text-anchor="middle" fill="#9ab6c8" font-size="10">${esc(numFa(i+1))}. ${esc(name.length>12?name.slice(0,12)+'…':name)}</text>`;}).join('');
  box.style.overflowX='auto';
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="نمودار قیمت و سود پروژه‌های انجام‌شده"><defs><filter id="profitGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${guides}<polyline points="${line(prices)}" fill="none" stroke="#168dff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#profitGlow)"/><polyline points="${line(profits)}" fill="none" stroke="#52ffc0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#profitGlow)"/>${dots(prices,'#4aa8ff','قیمت پروژه',-9)}${dots(profits,'#7effc2','سود من',16)}${labels}<g font-size="11"><line x1="${W-pad-210}" y1="16" x2="${W-pad-190}" y2="16" stroke="#168dff" stroke-width="3"/><text x="${W-pad-184}" y="20" fill="#9ab6c8">قیمت پروژه</text><line x1="${W-pad-100}" y1="16" x2="${W-pad-80}" y2="16" stroke="#52ffc0" stroke-width="3"/><text x="${W-pad-74}" y="20" fill="#9ab6c8">سود من</text></g></svg>`;
}


async function loadBackgroundSettings(){
  try{const {data,error}=await db.from('site_settings').select('background_url').eq('id',1).maybeSingle();if(error)throw error;const preview=$('#backgroundPreview');if(data?.background_url){preview.src=data.background_url;preview.hidden=false;}else preview.hidden=true;}
  catch(err){status('backgroundStatus','برای فعال‌سازی این بخش، SQL تنظیمات پس‌زمینه را اجرا کن. '+err.message,'error');}
}
$('#backgroundForm').addEventListener('submit',async e=>{
  e.preventDefault();const file=$('#backgroundFile').files?.[0];if(!file)return;
  if(!file.type.startsWith('image/')){status('backgroundStatus','فقط فایل تصویر انتخاب کن.','error');return;}
  if(file.size>8*1024*1024){status('backgroundStatus','حجم تصویر باید کمتر از ۸ مگابایت باشد.','error');return;}
  const btn=e.submitter;busy(btn,true);status('backgroundStatus','در حال بارگذاری تصویر...');
  try{
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`site-background/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const {data:uploadData,error:uploadError}=await db.storage.from('site-backgrounds').upload(path,file,{upsert:false,contentType:file.type,cacheControl:'3600'});if(uploadError)throw uploadError;
    const {data:{publicUrl}}=db.storage.from('site-backgrounds').getPublicUrl(uploadData.path);
    const {error:settingsError}=await db.from('site_settings').upsert({id:1,background_url:publicUrl,updated_at:new Date().toISOString()},{onConflict:'id'});if(settingsError)throw settingsError;
    const preview=$('#backgroundPreview');preview.src=publicUrl;preview.hidden=false;status('backgroundStatus','پس‌زمینه ذخیره شد. سایت را بازخوانی کن تا تغییر را ببینی.','success');
  }catch(err){status('backgroundStatus','بارگذاری پس‌زمینه ناموفق بود. SQL و سیاست‌های Storage را بررسی کن. '+err.message,'error');}
  finally{busy(btn,false);}
});
$('#resetBackground').addEventListener('click',async()=>{if(!confirm('پس‌زمینه سایت به تصویر پیش‌فرض برگردد؟'))return;try{const {error}=await db.from('site_settings').upsert({id:1,background_url:null,updated_at:new Date().toISOString()},{onConflict:'id'});if(error)throw error;$('#backgroundPreview').hidden=true;status('backgroundStatus','پس‌زمینه پیش‌فرض فعال شد.','success');}catch(err){status('backgroundStatus','تغییر پس‌زمینه ناموفق بود: '+err.message,'error');}});

bootAdmin();
