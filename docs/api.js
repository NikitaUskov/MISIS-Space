/* Storage adapter: local preview or authenticated Supabase REST API. */
(()=>{'use strict';
const config=window.MISIS_CONFIG||{};
const url=String(config.supabaseUrl||'').replace(/\/$/,'');
const key=String(config.supabaseKey||'');
const shared=Boolean(url||key),localKey='misis-space-bookings-local-v1',sessionKey='misis-auth:'+url;
let session=null,refreshPromise=null;
try{session=JSON.parse(sessionStorage.getItem(sessionKey)||'null')}catch{}
const configured=()=>{if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!key)throw Error('Не удалось подключить общий календарь. Проверьте настройки подключения.');if(key.startsWith('sb_secret_'))throw Error('В настройках указан закрытый ключ. Замените его на publishable key.');if(key.startsWith('eyJ')){try{const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role==='service_role')throw Error('closed')}catch(e){if(e.message==='closed')throw Error('Закрытый ключ нельзя использовать в браузере. Замените ключ.')}}};
function persistSession(value){session=value;try{if(value)sessionStorage.setItem(sessionKey,JSON.stringify(value));else sessionStorage.removeItem(sessionKey)}catch{}}
function normalize(b){return {...b,start:String(b.start).slice(0,5),end:String(b.end).slice(0,5)}}
function valid(b){return b&&typeof b.id==='string'&&['r1','r2','r3','rall'].includes(b.room)&&/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&/^\d{2}:\d{2}$/.test(b.start)&&/^\d{2}:\d{2}$/.test(b.end)&&['title','organization','responsible','description'].every(k=>typeof b[k]==='string')}
function localRead(){let raw;try{raw=localStorage.getItem(localKey)}catch{throw Error('Браузер запретил сохранение данных. Разрешите доступ к хранилищу.')};if(!raw)return [];let data;try{data=JSON.parse(raw)}catch{throw Error('Не удалось прочитать сохранённые бронирования.')};if(!Array.isArray(data)||!data.every(valid))throw Error('Формат сохранённых бронирований повреждён.');return data}
function localWrite(list){try{localStorage.setItem(localKey,JSON.stringify(list))}catch{throw Error('Не удалось сохранить бронь. Проверьте доступ к хранилищу и свободное место.')}}
const payload=b=>Object.fromEntries(['id','title','organization','responsible','description','room','date','start','end'].map(k=>[k,b[k]]));
function failure(data,status){const code=data?.error_code||data?.code;
if(code==='signup_disabled')return Error('Регистрация пока отключена. Обратитесь к организатору календаря.');
if(code==='user_already_exists'||code==='email_exists')return Error('Эта почта уже зарегистрирована. Перейдите во вкладку «Войти».');
if(code==='email_not_confirmed')return Error('Вход пока недоступен для этого аккаунта. Обратитесь к организатору календаря.');
if(code==='weak_password')return Error('Пароль не соответствует требованиям. Используйте более сложный пароль длиной от 8 символов.');
if(code==='email_address_invalid')return Error('Проверьте адрес электронной почты.');
if(code==='email_address_not_authorized'||code==='unexpected_failure')return Error('Не удалось завершить регистрацию. Организатору нужно проверить настройки регистрации и отправки писем.');
if(status===429)return Error('Слишком много попыток. Подождите немного и повторите.');
if(data?.error_code==='invalid_credentials'||data?.code==='invalid_credentials')return Error('Неверная почта или пароль. Проверьте данные и попробуйте снова.');if(data?.code==='23P01')return Error('Это время уже занято. Обновите расписание и выберите другой интервал.');if(status===401)return Error('Сессия истекла. Войдите снова.');if(status===403||data?.code==='42501')return Error('Нет доступа к этой операции. Войдите под своей учётной записью.');if(data?.code==='23514')return Error('Проверьте поля и время: 08:00–22:00 с шагом 15 минут.');return Error('Не удалось выполнить запрос. Проверьте подключение и повторите попытку.')}
async function raw(path,options={},token=null){configured();let response;try{response=await fetch(url+path,{...options,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)})}catch{throw Error('Нет связи с сервером. Изменения не сохранены. Повторите попытку.')};const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{throw Error('Сервер вернул некорректный ответ.')};if(!response.ok){if(response.status===401&&path.startsWith('/rest/'))persistSession(null);throw failure(data,response.status)}return data}
async function accessToken(){if(!session)throw Error('Войдите, чтобы открыть общий календарь.');if(session.expires_at*1000>Date.now()+60000)return session.access_token;if(!refreshPromise)refreshPromise=(async()=>{try{const result=await raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});persistSession({...result,expires_at:Math.floor(Date.now()/1000)+result.expires_in});return session.access_token}catch(e){persistSession(null);throw e}finally{refreshPromise=null}})();return refreshPromise}
async function request(path,options){return raw(path,options,await accessToken())}
async function localMutate(fn){const run=async()=>{const list=localRead();const value=fn(list);localWrite(list);return value};return navigator.locks?navigator.locks.request(localKey,run):run()}
const canEdit=b=>!shared||Boolean(session?.user?.id&&b.owner_id===session.user.id);
window.BookingStore=Object.freeze({shared,user:()=>session?.user||null,canEdit,
 async login(email,password){const result=await raw('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});persistSession({...result,expires_at:Math.floor(Date.now()/1000)+result.expires_in})},
 async signup(email,password){
 const result=await raw('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});
 if(result?.access_token&&result?.refresh_token&&result?.user?.id&&Number.isFinite(result.expires_in)){
 persistSession({...result,expires_at:Math.floor(Date.now()/1000)+result.expires_in});return {confirmationRequired:false};
 }
 if(result?.id||result?.user?.id)return {confirmationRequired:true};
 throw Error('Сервер не подтвердил регистрацию. Повторите попытку.');
 },
 async logout(){try{if(session)await raw('/auth/v1/logout',{method:'POST'},await accessToken())}finally{persistSession(null)}},
 async list(){if(!shared)return localRead();let all=[],offset=0;for(;;){const rows=await request('/rest/v1/bookings?select=id,title,organization,responsible,description,room,date,start,end,owner_id,updated_at&order=date.asc,start.asc,id.asc&limit=500&offset='+offset);if(!Array.isArray(rows))throw Error('Не удалось прочитать расписание.');all.push(...rows.map(normalize));if(rows.length<500)break;offset+=rows.length;}return all},
 async put(b,previous){if(!shared)return localMutate(list=>{const idx=list.findIndex(x=>x.id===b.id);if(previous&&idx<0)throw Error('Бронь уже удалена в другой вкладке.');if(previous&&list[idx].updated_at!==previous.updated_at)throw Error('Бронь изменилась в другой вкладке. Обновите расписание.');const spaces=id=>id==='rall'?['r2','r3']:[id];if(list.some(x=>x.id!==b.id&&x.date===b.date&&spaces(x.room).some(s=>spaces(b.room).includes(s))&&b.start<x.end&&x.start<b.end))throw Error('Это время уже занято. Выберите другой интервал.');const saved={...payload(b),updated_at:crypto.randomUUID()};if(idx<0)list.push(saved);else list[idx]=saved;return saved});if(previous&&!canEdit(previous))throw Error('Изменять можно только свои брони.');const path='/rest/v1/bookings'+(previous?'?id=eq.'+encodeURIComponent(b.id)+'&updated_at=eq.'+encodeURIComponent(previous.updated_at):'');const data=payload(b);if(previous)delete data.id;const rows=await request(path,{method:previous?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});if(!rows?.length)throw Error('Бронь изменилась или удалена. Обновите расписание.');return normalize(rows[0])},
 async remove(b){if(!shared)return localMutate(list=>{const idx=list.findIndex(x=>x.id===b.id);if(idx<0||list[idx].updated_at!==b.updated_at)throw Error('Бронь изменилась или удалена. Обновите расписание.');list.splice(idx,1)});if(!canEdit(b))throw Error('Удалять можно только свои брони.');const rows=await request('/rest/v1/bookings?id=eq.'+encodeURIComponent(b.id)+'&updated_at=eq.'+encodeURIComponent(b.updated_at),{method:'DELETE',headers:{Prefer:'return=representation'}});if(!rows?.length)throw Error('Бронь изменилась или удалена. Обновите расписание.')}
});
})();
