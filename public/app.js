const servicesData={
"Logo Design":50000,"Music Cover":20000,"Lyrics Video":30000,"Poster Design":30000,
"Album Cover Design":50000,"Ticket (Promo Kit)":15000,"Music Distribution":50000};
const packagesData={
"STARTER PLAN":{price:100000,includes:["Music Cover","Lyrics Video","Music Distribution"]},
"ARTIST PLAN":{price:200000,includes:["Music Cover","Music Release Cover","Lyrics Video","Music Distribution"]},
"PREMIUM PLAN":{price:350000,includes:["Music Cover","Music Release Cover","YouTube Thumbnail","Lyrics Video","Music Distribution","Music Promotion"]}};
const money=n=>"TSh "+Number(n).toLocaleString("en-US");
const $=s=>document.querySelector(s);
const servicesEl=$("#services"), packagesEl=$("#packages"), totalEl=$("#total");
if(servicesEl){
 Object.entries(servicesData).forEach(([name,price])=>{
  const d=document.createElement("label"); d.className="check";
  d.innerHTML=`<span><input type="checkbox" name="service" value="${name}"> ${name}</span><strong>${money(price)}</strong>`;
  servicesEl.appendChild(d);
 });
 Object.entries(packagesData).forEach(([name,p])=>{
  const d=document.createElement("div"); d.className="package"; d.dataset.name=name;
  d.innerHTML=`<h4>${name}</h4><div class="price">${money(p.price)}</div><ul>${p.includes.map(x=>`<li>${x}</li>`).join("")}</ul><button type="button">Choose ${name.replace(" PLAN"," Plan").toLowerCase()}</button>`;
  d.querySelector("button").addEventListener("click",()=>{
    const already=d.classList.contains("selected");
    document.querySelectorAll(".package").forEach(x=>x.classList.remove("selected"));
    if(already){updateTotal();return}
    d.classList.add("selected"); document.querySelectorAll('input[name="service"]').forEach(x=>x.checked=false);
    updateTotal();
  }); packagesEl.appendChild(d);
 });
 document.querySelectorAll('input[name="service"]').forEach(x=>x.addEventListener("change",()=>{
   document.querySelectorAll(".package").forEach(x=>x.classList.remove("selected")); updateTotal();
 }));
 function updateTotal(){
   const pkg=document.querySelector(".package.selected");
   const total=pkg?packagesData[pkg.dataset.name].price:[...document.querySelectorAll('input[name="service"]:checked')].reduce((s,x)=>s+servicesData[x.value],0);
   totalEl.textContent=money(total);
 }
 $("#orderForm").addEventListener("submit",async e=>{
  e.preventDefault(); const msg=$("#orderMsg"); msg.textContent="Submitting...";
  const fd=new FormData(e.currentTarget);
  fd.set("services",JSON.stringify([...document.querySelectorAll('input[name="service"]:checked')].map(x=>x.value)));
  const pkg=document.querySelector(".package.selected"); fd.set("packageName",pkg?pkg.dataset.name:"");
  try{
   const r=await fetch("/api/orders",{method:"POST",body:fd}); const data=await r.json();
   if(!r.ok) throw new Error(data.error||"Unable to submit order.");
   msg.innerHTML=`Order submitted successfully. <b>Your Order ID is ${data.orderId}</b>. Save it to track your order.`;
   e.currentTarget.reset(); document.querySelectorAll(".package").forEach(x=>x.classList.remove("selected")); updateTotal();
  }catch(err){msg.textContent=err.message}
 });
}
const trackForm=$("#trackForm");
if(trackForm) trackForm.addEventListener("submit",async e=>{
 e.preventDefault(); const box=$("#trackResult"); box.innerHTML="<p>Checking...</p>";
 const fd=new FormData(e.currentTarget); const r=await fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd))}); const data=await r.json();
 if(!r.ok){box.innerHTML=`<p>${data.error}</p>`;return}
 const o=data.order;
 box.innerHTML=`<div class="track-card"><h3>Order ${o.orderId}</h3><dl>
 <dt>Customer</dt><dd>${esc(o.customerName)}</dd><dt>Services</dt><dd>${o.services.map(esc).join(", ")||"—"}</dd>
 <dt>Package</dt><dd>${esc(o.packageName||"None")}</dd><dt>Total</dt><dd><b>${money(o.total)}</b></dd>
 <dt>Payment</dt><dd>${esc(o.paymentStatus)}</dd><dt>Status</dt><dd><span class="status">${esc(o.orderStatus)}</span></dd>
 <dt>Description</dt><dd>${esc(o.description)||"—"}</dd><dt>Lyrics</dt><dd>${esc(o.lyrics)||"—"}</dd></dl>
 ${o.completed?`<div class="complete"><b>COMPLETED WORK</b><p>${esc(o.completedFileName||"Completed file available")}</p><form method="post" action="/api/download"><input type="hidden" name="orderId" value="${esc(o.orderId)}"><input type="hidden" name="identifier" value="${esc(fd.get("identifier"))}"><button class="btn primary" type="submit">DOWNLOAD COMPLETED FILE</button></form></div>`:""}</div>`;
});
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
document.querySelector(".menu")?.addEventListener("click",()=>document.querySelector("nav").classList.toggle("open"));
