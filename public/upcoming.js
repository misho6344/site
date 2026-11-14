/* Generated upcoming titles for the homepage demo. These are fictional placeholders, not real announcements. */
(() => {
  "use strict";
  const year = new Date().getFullYear() + 1;
  const items = [
    { title_en:"The Last Horizon", title_ka:"უკანასკნელი ჰორიზონტი", release_year:year, month:2, day:12, genre:"Adventure, Sci-Fi" },
    { title_en:"Midnight Signal", title_ka:"შუაღამის სიგნალი", release_year:year, month:4, day:8, genre:"Mystery, Thriller" },
    { title_en:"Solar Drift", title_ka:"მზის ორბიტა", release_year:year, month:6, day:19, genre:"Sci-Fi, Drama" },
    { title_en:"Paper Kingdom", title_ka:"ქაღალდის სამეფო", release_year:year, month:8, day:3, genre:"Fantasy, Adventure" },
    { title_en:"The Quiet City", title_ka:"ჩუმი ქალაქი", release_year:year, month:10, day:21, genre:"Drama, Mystery" }
  ].map(item => ({ ...item, release_date:`${item.release_year}-${String(item.month).padStart(2,"0")}-${String(item.day).padStart(2,"0")}`, poster_url:"/assets/upcoming-poster.svg" }));
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const formatDate = value => new Intl.DateTimeFormat(undefined, { month:"short", day:"numeric", year:"numeric" }).format(new Date(`${value}T12:00:00`));

  function appendUpcoming() {
    const rows = document.getElementById("homeRows");
    const home = document.querySelector('[data-view="home"]');
    if (!rows || !home || home.hidden || !rows.children.length || rows.querySelector("[data-upcoming-row]")) return;
    const section = document.createElement("section");
    section.className = "row upcoming-row";
    section.dataset.upcomingRow = "true";
    section.innerHTML = `<div class="row-head"><div><h2>Coming Soon</h2><span class="count">Fictional demo titles — placeholder release dates</span></div></div><div class="row-track">${items.map(item => `
      <article class="card upcoming-card" aria-label="${esc(item.title_en)}, expected ${esc(formatDate(item.release_date))}">
        <div class="poster"><img src="${item.poster_url}" alt="Demo poster for ${esc(item.title_en)}" loading="lazy"><span class="imdb none">DEMO</span></div>
        <h3>${esc(item.title_en)}</h3><div class="ka">${esc(item.title_ka)}</div>
        <div class="year">${esc(formatDate(item.release_date))}</div><div class="year">${esc(item.genre)}</div>
      </article>`).join("")}</div>`;
    rows.appendChild(section);
  }

  const rows = document.getElementById("homeRows");
  if (rows) new MutationObserver(appendUpcoming).observe(rows, { childList:true });
  window.addEventListener("hashchange", () => requestAnimationFrame(appendUpcoming));
  appendUpcoming();
})();
