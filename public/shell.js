/* Shared menu behavior for pages other than the home page. */
(function(){
  "use strict";
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
})();
