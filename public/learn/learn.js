// Renders the cards on the Learn hub and on course index pages from one data array.
// Each page loads its own data file first, which sets window.LEARN_ITEMS:
//   [{ number?, title, description, status: "live" | "coming soon", url }]
// Only items with status "live" and a safe url become links. Nothing here needs editing to add content.
(function () {
  "use strict";

  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  var list = document.getElementById("learn-list");
  var items = window.LEARN_ITEMS;
  if (!list) return;

  if (!Array.isArray(items) || items.length === 0) {
    var p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing here yet. Check back soon.";
    list.replaceWith(p);
    return;
  }

  function isSafeUrl(u) {
    return typeof u === "string" && u.trim() !== "" && !/^\s*(javascript|data|vbscript):/i.test(u);
  }

  items.forEach(function (item) {
    var live = String(item.status).toLowerCase() === "live" && isSafeUrl(item.url);
    var li = document.createElement("li");
    var card = document.createElement(live ? "a" : "div");
    card.className = "card " + (live ? "is-live" : "is-soon");
    if (live) card.href = item.url;

    if (item.number !== undefined && item.number !== null && item.number !== "") {
      var num = document.createElement("span");
      num.className = "num";
      num.textContent = "MODULE " + String(item.number).padStart(2, "0");
      card.appendChild(num);
    }

    var h = document.createElement("h2");
    h.textContent = item.title || "Untitled";
    card.appendChild(h);

    if (item.description) {
      var d = document.createElement("p");
      d.textContent = item.description;
      card.appendChild(d);
    }

    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = live ? "Live" : "Coming soon";
    card.appendChild(tag);

    li.appendChild(card);
    list.appendChild(li);
  });
})();
