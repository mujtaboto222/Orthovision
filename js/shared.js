// ═══════════════════════════════════════
// SHARED UTILITIES
// Used by all pages
// ═══════════════════════════════════════

function showToast(msg,icon,type,duration){
  icon=icon||'ℹ️';type=type||'toast-info';duration=duration||3200;
  const container=document.getElementById('toastContainer');
  const t=document.createElement('div');t.className='toast '+type;
  t.innerHTML=`<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  container.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},duration);
}
