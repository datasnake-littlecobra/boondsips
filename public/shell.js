/* Shared behavior for pages other than the home page: the menu, the Auto / Light / Dark switch, and the back-to-top button. */
(function(){
  "use strict";
  var root = document.documentElement;
  var menu = document.getElementById("menu"), burger = document.getElementById("burger"), close = document.getElementById("menuClose");
  if (menu && burger && close) {
    var setMenu = function(open){
      menu.classList.toggle("open", open);
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
      if (open) close.focus(); else burger.focus();
    };
    burger.addEventListener("click", function(){ setMenu(true); });
    close.addEventListener("click", function(){ setMenu(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && menu.classList.contains("open")) setMenu(false); });
  }
  var yr = document.getElementById("yr"); if (yr) yr.textContent = new Date().getFullYear();

  var KEY = "boondTheme";
  function saved(){ try { var t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : "auto"; } catch (e) { return "auto"; } }
  function apply(c){
    if (c === "light" || c === "dark") root.setAttribute("data-theme", c); else root.removeAttribute("data-theme");
    document.querySelectorAll("[data-theme-choice]").forEach(function(b){ b.setAttribute("aria-pressed", b.getAttribute("data-theme-choice") === c ? "true" : "false"); });
  }
  function choose(c){ try { if (c === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch (e) {} apply(c); }
  apply(saved());
  document.addEventListener("click", function(e){ var b = e.target.closest("[data-theme-choice]"); if (b) choose(b.getAttribute("data-theme-choice")); });

  var top = document.getElementById("toTop"), reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (top) {
    var onScroll = function(){ top.classList.toggle("show", (window.pageYOffset || root.scrollTop) > 700); };
    window.addEventListener("scroll", onScroll, {passive:true}); onScroll();
    top.addEventListener("click", function(){
      window.scrollTo({top:0, behavior: reduce ? "auto" : "smooth"});
      if (burger) burger.focus({preventScroll:true});
    });
  }
})();
