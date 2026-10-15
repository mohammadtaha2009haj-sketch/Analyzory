/* Public Supabase publishable key belongs in client code; never place service-role keys here. */
const SUPABASE_URL = "https://sysfgcybdrofzfyxrkbg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Lu9MZhp_sFFOpw-bfN2-cQ_e7IIRK5B";
const hasSupabaseConfig = Boolean(window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY);
const db = hasSupabaseConfig ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const form = $("#bookingForm");
const serviceSelect = $("#serviceSelect");
const loading = $("#loadingOverlay");
const bookingMessage = $("#bookingMessage");
let services = [
  {id:"builtin-coach",name:"کوچ",description:"همراهی مرحله‌به‌مرحله",is_active:true,sort_order:1},
  {id:"builtin-consult",name:"مشاوره",description:"تحلیل و تصمیم‌گیری",is_active:true,sort_order:2},
  {id:"builtin-plan",name:"برنامه",description:"برنامه اجرایی",is_active:true,sort_order:3}
];
let currentUser = null;
let servicesExpanded = false;

// Notifications are not requested from visitors; existing permission is respected only if already granted.
function browserNotify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const note = new Notification(title, { body, tag, icon: '/assets/taha-hero-logo.png', badge: '/assets/taha-hero-logo.png' });
    note.onclick = () => { window.focus(); note.close(); };
    return true;
  } catch (err) { console.warn('Browser notification unavailable', err); return false; }
}
function checkBookingReminders() {
  if (!db || !('Notification' in window) || Notification.permission !== 'granted') return;
  const ids = JSON.parse(localStorage.getItem('taha_my_booking_ids') || '[]');
  if (!ids.length) return;
  db.rpc('get_my_booking_statuses', { p_booking_ids: ids }).then(({data,error}) => {
    if (error || !Array.isArray(data)) return;
    const now = Date.now();
    data.forEach(b => {
      if (b.status !== 'approved' || !b.scheduled_at) return;
      const start = new Date(b.scheduled_at).getTime();
      const key = 'taha_reminder_sent_' + b.id;
      if (start > now && start - now <= 10 * 60 * 1000 && !localStorage.getItem(key)) {
        if (browserNotify('یادآوری نوبت TAHA', `حدود ۱۰ دقیقه تا شروع پروژه «${b.requested_service_name || 'رزرو شما'}» باقی مانده است.`, key)) localStorage.setItem(key, '1');
      }
    });
  }).catch(err => console.warn('Reminder check failed', err));
}
setInterval(checkBookingReminders, 60 * 1000);


const yearElement = $("#year");
if (yearElement) yearElement.textContent = new Date().getFullYear();
function setLoading(on){ loading.hidden = !on; }
function message(el, text, kind=""){ el.textContent=text; el.className="form-message"+(kind?" "+kind:""); }
function escapeHTML(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function openModal(id){$("#"+id).hidden=false;document.body.style.overflow="hidden";const first=$("#"+id+" input");if(first) setTimeout(()=>first.focus(),50);}
function closeModal(id){$("#"+id).hidden=true;if(!$$(".modal-backdrop:not([hidden])").length)document.body.style.overflow="";}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
$$(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")$$(".modal-backdrop:not([hidden])").forEach(m=>closeModal(m.id));});
$("#adminOpen").addEventListener("click",()=>{ window.location.href="admin.html"; });

function showBooking(serviceId){
  if(serviceId) selectService(serviceId);
  else {
    // Keep the user's existing selection when reopening the form; otherwise show a clean first step.
    $("#formStep1").classList.add("active");
  }
  openModal("bookingModal");
}

// Event delegation keeps dynamically rendered service cards clickable, including on mobile.
document.addEventListener("click", e => {
  const bookingTrigger = e.target.closest("[data-open-booking]");
  if (bookingTrigger) {
    e.preventDefault();
    showBooking();
    return;
  }
  const moreServices = e.target.closest("#allServices");
  if (moreServices) {
    servicesExpanded = true;
    renderServices();
    return;
  }
  const serviceTrigger = e.target.closest("[data-book], [data-service-card]");
  if (serviceTrigger) {
    e.preventDefault();
    const serviceId = serviceTrigger.dataset.book || serviceTrigger.dataset.serviceCard;
    if (serviceId) showBooking(serviceId);
  }
});
$('#availabilityOpen').addEventListener('click',()=>{const dot=$('#approvedBookingDot');if(dot)dot.hidden=true;openModal('availabilityModal');loadMyBookingStatuses();});
const seenApprovedKey='taha_seen_approved_booking_ids';
function getSeenApprovedIds(){try{return new Set(JSON.parse(localStorage.getItem(seenApprovedKey)||'[]'));}catch{return new Set();}}
function markApprovedBookingsSeen(rows){const seen=getSeenApprovedIds();(rows||[]).filter(b=>b.status==='approved'&&b.scheduled_at&&b.id).forEach(b=>seen.add(String(b.id)));localStorage.setItem(seenApprovedKey,JSON.stringify([...seen].slice(-200)));}
async function refreshHeaderIndicators(){
  const ids=JSON.parse(localStorage.getItem('taha_my_booking_ids')||'[]');
  const approvedDot=$('#approvedBookingDot');
  if(approvedDot){
    if(!ids.length || !db){approvedDot.hidden=true;}
    else try{
      const {data,error}=await db.rpc('get_my_booking_statuses',{p_booking_ids:ids});
      if(!error){
        const seen=getSeenApprovedIds();
        approvedDot.hidden=!(data||[]).some(b=>b.status==='approved'&&b.scheduled_at&&b.id&&!seen.has(String(b.id)));
      }
    }catch{}
  }
  const newDot=$('#newBookingDot');
  if(newDot && db){try{const {data,error}=await db.from('site_settings').select('has_new_booking').eq('id',1).maybeSingle();if(!error)newDot.hidden=!data?.has_new_booking;}catch{}}
}

async function loadMyBookingStatuses(){
 const root=$("#myBookingStatuses");if(!root)return;
 const ids=JSON.parse(localStorage.getItem("taha_my_booking_ids")||"[]");
 if(!ids.length){root.innerHTML='<p class="muted">هنوز رزروی از این مرورگر ثبت نشده است.</p>';return;}
 if(!db){root.innerHTML='<p class="muted">اتصال دیتابیس در دسترس نیست.</p>';return;}
 root.innerHTML='<p class="muted">در حال بارگذاری وضعیت درخواست‌ها...</p>';
 try{const {data,error}=await db.rpc("get_my_booking_statuses",{p_booking_ids:ids});if(error)throw error;
 if(!data?.length){root.innerHTML='<p class="muted">درخواستی برای نمایش پیدا نشد.</p>';return;}
 const labels={pending:'در صف انتظار...',reviewing:'در حال بررسی',approved:'✓ تأیید شده | منتظر نوبت باشید!',rejected:'× رد شده | کسب‌وکار شما مناسب نیست!'};
 markApprovedBookingsSeen(data);
 const classes={pending:'pending',reviewing:'reviewing',approved:'approved',rejected:'rejected'};
 root.innerHTML=data.map(b=>`<article class="my-booking-status"><h3>${escapeHTML(b.requested_service_name||"درخواست رزرو")}</h3><p>وضعیت: <strong class="booking-state ${classes[b.status]||''}">${escapeHTML(labels[b.status]||b.status)}</strong></p><p>تاریخ ثبت: ${escapeHTML(new Date(b.created_at).toLocaleString("fa-IR"))}</p>${b.scheduled_at?`<p class="project-start-date">تاریخ شروع پروژه: ${escapeHTML(new Date(b.scheduled_at).toLocaleString("fa-IR"))}</p>`:'<p>تاریخ شروع پروژه هنوز توسط مدیریت تعیین نشده است.</p>'}</article>`).join("");
 await refreshHeaderIndicators();
 }catch(err){root.innerHTML='<p class="muted">دریافت وضعیت ناموفق بود. کد SQL تکمیلی را اجرا کن.</p>';console.warn(err);}
}

function renderServices(){
  serviceSelect.innerHTML='<option value="">انتخاب کنید</option>'+services.filter(s=>s.is_active!==false).map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join("");
  const visible=services.filter(s=>s.is_active!==false);
  const displayed=(visible.length>3&&!servicesExpanded)?visible.slice(0,3):visible;
  const serviceCards=displayed.map((s,i)=>`<article class="service-card" data-service-card="${escapeHTML(s.id)}" tabindex="0" role="button" aria-label="رزرو خدمت ${escapeHTML(s.name)}"><div class="service-number">${String(i+1).padStart(2,"0")}</div><div class="service-title-row"><div class="service-icon">${["↗","⌁","▤"][i%3]}</div><h3>${escapeHTML(s.name)}</h3></div><p>${escapeHTML(s.description||"خدمت قابل تنظیم متناسب با نیاز شما.")}</p><button class="text-action" type="button" data-book="${escapeHTML(s.id)}">رزرو این خدمت <span>←</span></button></article>`).join("");
  const moreCard=(visible.length>3&&!servicesExpanded)?`<button class="service-card all-services" id="allServices" type="button"><span class="all-plus">＋</span><h3>مشاهده همه خدمات</h3><p>${visible.length-3} خدمت دیگر برای انتخاب موجود است.</p><span class="text-action">نمایش خدمات بیشتر <span>←</span></span></button>`:"";
  $("#serviceCards").innerHTML=serviceCards+moreCard;
  const row=$("#serviceCards");
  const updateFocusedCard=()=>{
    const cards=$$(".service-card",row); if(!cards.length)return;
    const rowRect=row.getBoundingClientRect(); const center=rowRect.left+rowRect.width/2;
    let nearest=null,dist=Infinity;
    cards.forEach(card=>{const r=card.getBoundingClientRect();const d=Math.abs((r.left+r.width/2)-center);if(d<dist){dist=d;nearest=card;}});
    cards.forEach(card=>card.classList.toggle("is-focused",card===nearest));
  };
  if(!row.dataset.snapListener){row.addEventListener("scroll",()=>requestAnimationFrame(updateFocusedCard),{passive:true});row.dataset.snapListener="1";}
  requestAnimationFrame(updateFocusedCard);
  // Keyboard support for article cards; click handling is delegated once at document level.
  $$('[data-service-card]').forEach(card=>{
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();showBooking(card.dataset.serviceCard);}
    });
  });
}
async function loadPublicSettings(){
  if(!db)return;
  try{
    const {data,error}=await db.from("site_settings").select("instagram_handle,telegram_handle,contact_phone,background_url").eq("id",1).maybeSingle();
    if(error||!data)return;
    const instagram=(data.instagram_handle||"").trim().replace(/^@/,"");
    const telegram=(data.telegram_handle||"").trim().replace(/^@/,"");
    const phone=(data.contact_phone||"").trim();
    if(data.background_url){const safeUrl=String(data.background_url);if(/^https:\/\//i.test(safeUrl)){document.documentElement.style.setProperty('--site-background-image',`url("${safeUrl.replace(/["\\]/g,'')}")`);document.body.classList.add('custom-site-background');}}
    if(instagram)$("#instagramLink").href="https://instagram.com/"+encodeURIComponent(instagram);
    if(telegram)$("#telegramLink").href="https://t.me/"+encodeURIComponent(telegram);
    if(phone){const link=$(".social-phone");link.href="tel:"+phone.replace(/[^+0-9]/g,"");const span=link.querySelector("span");if(span)span.textContent=phone;}
  }catch(e){console.warn("Site contact settings are unavailable.",e);}
}

async function loadServices(){
  // First render the starter services immediately; a slow/offline database must not disable the cards.
  renderServices();
  if(!db)return;
  try{
    const result = await Promise.race([
      db.from("services").select("id,name,description,is_active,sort_order").eq("is_active",true).order("sort_order"),
      new Promise((_, reject)=>setTimeout(()=>reject(new Error("service query timed out")), 8000))
    ]);
    if(!result.error && Array.isArray(result.data) && result.data.length) services=result.data;
  }catch(e){console.warn("Services unavailable; using safe starter list.",e);}
  renderServices();
}
function selectService(id){
  if(id==="builtin-coach") serviceSelect.value=services.find(s=>s.name==="کوچ")?.id||"";
  else if(id==="builtin-consult") serviceSelect.value=services.find(s=>s.name==="مشاوره")?.id||"";
  else if(id==="builtin-plan") serviceSelect.value=services.find(s=>s.name==="برنامه")?.id||"";
  else serviceSelect.value=id;
  $("#formStep1").classList.add("active");
}
async function renderDynamicFields(){ /* Custom fields from the removed second stage are intentionally not rendered. */ }

form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!form.reportValidity())return;
  if(!db){message(bookingMessage,"اتصال دیتابیس آماده نیست. تنظیمات Supabase را در app.js بررسی کنید.","error");return;}
  const fd=new FormData(form), selected=services.find(s=>s.id===fd.get("service_id"));
  const phone=String(fd.get("phone")||"").trim();
  if(phone.length<7){message(bookingMessage,"شماره تماس واردشده معتبر به نظر نمی‌رسد.","error");return;}
  const details={};
  for(const [key,value] of fd.entries()) if(!["full_name","phone","business_type","business_name","service_id","social_handle","urgent","description"].includes(key)) details[key]=value;
  const payload={
    full_name:String(fd.get("full_name")).trim(),phone,business_type:fd.get("business_type"),
    business_name:String(fd.get("business_name")||"").trim()||null,
    service_id:selected?.id.startsWith("builtin-")?null:selected?.id,
    requested_service_name:selected?.name||"نامشخص",
    social_handle:String(fd.get("social_handle")||"").trim()||null,
    is_urgent:fd.get("urgent")==="on",description:String(fd.get("description")||"").trim()||null,
    form_answers:details
  };
  setLoading(true);message(bookingMessage,"در حال ثبت درخواست...");
  try{
    // RPC performs server-side validation and inserts atomically. Anonymous booking is supported by the SQL policy/RPC.
    const {data,error}=await db.rpc("submit_booking",{
      p_full_name:payload.full_name,p_phone:payload.phone,p_business_type:payload.business_type,
      p_business_name:payload.business_name,p_service_id:payload.service_id,
      p_requested_service_name:payload.requested_service_name,p_social_handle:payload.social_handle,
      p_is_urgent:payload.is_urgent,p_description:payload.description,p_form_answers:payload.form_answers
    });
    if(error)throw error;
    const bookingId = typeof data === "string" ? data : (Array.isArray(data) ? data[0] : data);
    if(bookingId && /^[0-9a-f-]{36}$/i.test(String(bookingId))){
      const saved = JSON.parse(localStorage.getItem("taha_my_booking_ids") || "[]");
      if(!saved.includes(bookingId)) saved.push(bookingId);
      localStorage.setItem("taha_my_booking_ids", JSON.stringify(saved.slice(-50)));
    }
    form.reset();serviceSelect.value="";
    $("#formStep1").classList.add("active");
    closeModal("bookingModal");
    const toast=document.createElement("div");toast.className="success-toast";toast.setAttribute("role","status");toast.textContent="درخواست رزرو شما با موفقیت ثبت شد.";
    document.body.appendChild(toast);setTimeout(()=>toast.remove(),4500);
    message(bookingMessage,"درخواست شما با موفقیت ثبت شد. پس از بررسی، برای هماهنگی با شما تماس گرفته می‌شود.","success");
  }catch(err){
    console.error(err);
    message(bookingMessage,"ثبت درخواست انجام نشد. اتصال و اجرای SQL را بررسی کنید. "+(err.message||""),"error");
  }finally{setLoading(false);}
});

$("#adminLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();if(!db){message($("#adminMessage"),"اتصال Supabase پیکربندی نشده است.","error");return;}
  const fd=new FormData(e.currentTarget);setLoading(true);
  try{
    const {data,error}=await db.auth.signInWithPassword({email:fd.get("email"),password:fd.get("password")});
    if(error)throw error;
    currentUser=data.user;
    // The database policies still enforce the admin role; client-side UI is not a security boundary.
    closeModal("adminModal");openModal("adminDashboard");
    message($("#dashboardMessage"),"وارد شدید. برای بارگذاری اطلاعات از دکمه استفاده کنید.","success");
  }catch(err){message($("#adminMessage"),"ورود ناموفق بود: "+(err.message||"اطلاعات ورود را بررسی کنید."),"error");}
  finally{setLoading(false);}
});
$("#loadBookings").addEventListener("click",async()=>{
  if(!db)return;
  setLoading(true);message($("#dashboardMessage"),"در حال دریافت رزروها...");
  try{
    const {data,error}=await db.from("bookings").select("id,full_name,phone,business_type,business_name,requested_service_name,is_urgent,status,description,created_at,form_answers,scheduled_at").order("created_at",{ascending:false}).limit(100);
    if(error)throw error;
    if(!data?.length){$("#bookingList").innerHTML='<p class="muted">رزروی برای نمایش وجود ندارد یا دسترسی مدیریت فعال نیست.</p>';message($("#dashboardMessage"),"دریافت اطلاعات انجام شد.","success");return;}
    $("#bookingList").innerHTML=data.map(b=>`<article class="booking-item" data-id="${escapeHTML(b.id)}"><header><div><h3>${escapeHTML(b.full_name)} · ${escapeHTML(b.requested_service_name)}</h3><p>${escapeHTML(b.phone)} · ${escapeHTML(b.business_type)}${b.business_name?" · "+escapeHTML(b.business_name):""}</p></div><span class="pill ${b.is_urgent?"urgent":""}">${b.is_urgent?"فوری":"عادی"}</span></header><p>${escapeHTML(b.description||"بدون توضیحات")}</p><div class="booking-meta"><span class="pill">${escapeHTML(new Date(b.created_at).toLocaleString("fa-IR"))}</span><span class="pill">${escapeHTML(b.status)}</span></div><label>تغییر وضعیت<select class="status-select" data-id="${escapeHTML(b.id)}"><option value="pending" ${b.status==="pending"?"selected":""}>در صف انتظار</option><option value="reviewing" ${b.status==="reviewing"?"selected":""}>در حال بررسی</option><option value="approved" ${b.status==="approved"?"selected":""}>تأیید شده</option><option value="rejected" ${b.status==="rejected"?"selected":""}>رد شده</option></select></label></article>`).join("");
    $$(".status-select").forEach(s=>s.addEventListener("change",()=>updateStatus(s.dataset.id,s.value)));
    message($("#dashboardMessage"),"رزروها دریافت شدند.","success");
  }catch(err){message($("#dashboardMessage"),"دریافت رزروها ناموفق بود. مطمئن شوید حساب شما نقش admin دارد. "+(err.message||""),"error");}
  finally{setLoading(false);}
});
async function updateStatus(id,status){
  if(!db)return;setLoading(true);
  try{
    const {error}=await db.rpc("admin_update_booking_status",{p_booking_id:id,p_new_status:status});
    if(error)throw error;message($("#dashboardMessage"),"وضعیت رزرو به‌روزرسانی شد.","success");
  }catch(err){message($("#dashboardMessage"),"تغییر وضعیت ناموفق بود: "+(err.message||""),"error");$("#loadBookings").click();}
  finally{setLoading(false);}
}
$("#signOut").addEventListener("click",async()=>{if(db)await db.auth.signOut();currentUser=null;closeModal("adminDashboard");});
$("#refreshAvailability").addEventListener("click",()=>loadMyBookingStatuses());
$("#instagramLink").href="https://instagram.com/";$("#telegramLink").href="https://t.me/";
loadServices().finally(()=>{if(!services.length)renderServices();});
loadPublicSettings();
checkBookingReminders();
refreshHeaderIndicators();
setInterval(refreshHeaderIndicators, 30000);
