// Kerslide PWA glue: offline service worker + a small "Install" button (or an iOS "Add to Home Screen" hint).
// Active only on kerslide.com/play (and localhost for tests), top-level, not with ?portal=: portal copies of this
// page (itch.io, Game Jolt, Newgrounds, … zips) never register a worker or show install UI.
(function () {
  "use strict";
  var host = location.hostname;
  var official = /^(www\.)?kerslide\.com$/.test(host) && location.pathname.indexOf("/play/") === 0;
  var local = host === "localhost" || host === "127.0.0.1";
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  var noPortal = function () { return !/[?&]portal=/.test(location.search) && !window.kerslidePortal; };
  var enabled = (official || local) && !framed && noPortal() && window.isSecureContext && "serviceWorker" in navigator;
  var pwa = window.kerslidePwa = { enabled: enabled, registration: null, installed: false };
  if (!enabled) return;

  // ---- service worker (after the game is running, so it never competes with the first download) ----
  function register() {
    if (!noPortal()) return;
    var b = window.kerslideBuild || {};
    var files = (b.files || []).filter(Boolean);
    var id = (b.version || "0") + "-" + files.map(function (f) { return f.slice(0, 8); }).join("");
    var url = "sw.js?build=" + encodeURIComponent(id) + "&files=" + encodeURIComponent(files.join(","));
    navigator.serviceWorker.register(url, { scope: "./", updateViaCache: "none" })
      .then(function (reg) { pwa.registration = reg; })
      .catch(function (e) { console.warn("[pwa] service worker not registered:", e); });
  }
  function onReady(fn) { if (window.kerslideUnity) fn(); else window.addEventListener("kerslide-ready", fn, { once: true }); }
  onReady(register);

  // ---- install UI ----
  var standalone = navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches;
  if (standalone) { pwa.installed = true; return; }
  var KEY = "kerslide.installHintUntil";
  function snoozed() { try { return Date.now() < Number(localStorage.getItem(KEY) || 0); } catch (e) { return false; } }
  function snooze(days) { try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch (e) {} }

  var bar = null, timer = 0;
  function hide() { clearTimeout(timer); if (bar) { bar.remove(); bar = null; } }
  function show(text, action, autoHideSeconds) {
    hide();
    if (!document.getElementById("kerslide-pwa-css")) {
      var css = document.createElement("style");
      css.id = "kerslide-pwa-css";
      css.textContent =
        "#kerslide-install{position:fixed;left:max(10px,env(safe-area-inset-left));bottom:max(10px,env(safe-area-inset-bottom));" +
        "z-index:10;display:flex;align-items:center;gap:2px;max-width:calc(100vw - 20px);background:#fff;color:#1D2433;" +
        "border:1px solid #DCE3EE;border-radius:999px;box-shadow:0 2px 10px rgba(29,36,51,.12);font:600 14px/1.2 -apple-system," +
        "BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:.95}" +
        "#kerslide-install button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:8px 6px 8px 14px}" +
        "#kerslide-install .x{padding:8px 12px 8px 6px;color:#5D6679;font-weight:400}" +
        "#kerslide-install span{padding:8px 4px 8px 14px;font-weight:500}";
      document.head.appendChild(css);
    }
    bar = document.createElement("div");
    bar.id = "kerslide-install";
    var main = document.createElement(action ? "button" : "span");
    main.textContent = text;
    if (action) main.onclick = action;
    var close = document.createElement("button");
    close.className = "x";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.onclick = function () { snooze(30); hide(); };
    bar.appendChild(main);
    bar.appendChild(close);
    document.body.appendChild(bar);
    if (autoHideSeconds) timer = setTimeout(hide, autoHideSeconds * 1000);
  }

  // Chrome, Edge, Samsung Internet, …: the browser says when the game is installable.
  var prompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    prompt = e;
    pwa.canInstall = true;
    if (snoozed()) return;
    show("Install app", function () {
      hide();
      prompt.prompt();
      prompt.userChoice.then(function (c) { if (c.outcome !== "accepted") snooze(30); prompt = null; });
    }, 15);
  });
  window.addEventListener("appinstalled", function () { pwa.installed = true; hide(); });

  // iOS/iPadOS Safari has no install prompt: show the Add to Home Screen steps once a week at most.
  var ua = navigator.userAgent;
  var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !snoozed()) {
    window.addEventListener("kerslide-ready", function () {
      setTimeout(function () {
        snooze(7);
        show("Install: tap Share → Add to Home Screen", null, 12);
      }, 4000);
    }, { once: true });
  }
})();
