"use strict";
const form=document.getElementById("copyrightReport");
const status=document.getElementById("reportStatus");
form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!form.reportValidity()) return;
  const data=Object.fromEntries(new FormData(form).entries());
  delete data.truthful;
  status.textContent="იგზავნება...";
  const button=form.querySelector("button[type=submit]");
  button.disabled=true;
  try{
    const response=await fetch("/api/copyright/report",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify(data)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||"შეტყობინების გაგზავნა ვერ მოხერხდა.");
    status.textContent="შეტყობინება მიღებულია. ნომერი: #"+result.reportId+". განხილვა მოხდება ხელით.";
    form.reset();
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
