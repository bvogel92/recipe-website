const assets = __ASSETS__;
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function valid(raw){let u;try{u=new URL(raw)}catch{return null}const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!h.includes('.')||h.endsWith('.')||/^\d|:/.test(h)||/\.(local|localhost|internal|test|invalid|example)$/.test(h))return null;return u}
// Origins allowed to call /api/recipe-page: this Worker's own site, plus any listed in the
// ALLOWED_ORIGINS variable (comma-separated), e.g. "https://yourname.github.io".
function allowedOrigin(request,env){const origin=request.headers.get('Origin');if(!origin)return null;if(origin===new URL(request.url).origin)return origin;const list=String((env&&env.ALLOWED_ORIGINS)||'').split(',').map(x=>x.trim().replace(/\/+$/,'')).filter(Boolean);return list.includes(origin)?origin:null}
function withCors(response,origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');return response}
async function recipePage(request,env){
  const origin=allowedOrigin(request,env);
  if(!origin)return reply({error:'Request origin is not allowed.'},403);
  return withCors(await fetchRecipePage(request),origin);
}
async function fetchRecipePage(request){
  let data;try{data=await request.json()}catch{return reply({error:'Enter a valid recipe URL.'},400)}
  if(typeof data.url!=='string'||data.url.length>2048)return reply({error:'Enter a valid public HTTPS URL.'},400);
  let target=valid(data.url);if(!target)return reply({error:'Enter a public HTTPS recipe URL.'},400);
  try{let response;for(let redirects=0;redirects<=3;redirects++){response=await fetch(target.href,{redirect:'manual',headers:{'Accept':'text/html,application/xhtml+xml','User-Agent':'RecipeCollection/1.0'},signal:AbortSignal.timeout(12000)});if(response.status>=300&&response.status<400){let location=response.headers.get('location');if(!location||redirects===3)return reply({error:'The page redirected too many times.'},400);target=valid(new URL(location,target).href);if(!target)return reply({error:'The page redirected to an unsupported address.'},400);continue}break}
    if(!response.ok)return reply({error:'The recipe site could not be read (HTTP '+response.status+').' },400);
    if(!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||''))return reply({error:'That address did not return a recipe web page.'},400);
    const reader=response.body.getReader();let chunks=[],size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();return reply({error:'This page is too large to import.'},400)}chunks.push(value)}let bytes=new Uint8Array(size),offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return reply({html:new TextDecoder().decode(bytes),url:target.href});
  }catch{return reply({error:'Could not reach that recipe page. The site may block automated requests.'},400)}
}
export default {async fetch(request,env){let u=new URL(request.url);if(u.pathname==='/api/recipe-page'&&request.method==='OPTIONS'){const origin=allowedOrigin(request,env);if(!origin)return new Response(null,{status:403});return withCors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}}),origin)}if(u.pathname==='/api/recipe-page'&&request.method==='POST')return recipePage(request,env);if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});let key=u.pathname==='/'?'/index.html':u.pathname;let item=assets[key];if(!item)return new Response('Not found',{status:404});let bin=atob(item.data),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':item.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}})}};
