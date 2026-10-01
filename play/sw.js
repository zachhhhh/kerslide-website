// Kerslide service worker: offline play for https://kerslide.com/play/ (its scope is this file's folder only, so
// the rest of kerslide.com and every portal page are never touched).
//
// pwa.js registers it as sw.js?build=<id>&files=<Build file names>. A new game build has new hashed file names, so
// it registers a new worker URL; that worker precaches the new build in its own cache ("kerslide-play-<id>"),
// takes over at once and deletes the older caches. Strategies:
//   the page (index.html)          network first (revalidated, 5 s timeout), cached copy when offline
//   Build/* (hashed names)         cache first
//   StreamingAssets/* (music)      cache first, per build cache
//   anything else in scope         network first, cached copy when offline
// Requests outside the scope are never answered here, so other origins (Google's adsbygoogle.js and ad frames on
// kerslide.com/play) are never cached: offline they just fail and the game runs without ads.
"use strict";

var params = new URL(self.location.href).searchParams;
var PREFIX = "kerslide-play-";
var CACHE = PREFIX + (params.get("build") || "dev");
var SCOPE = self.registration.scope;               // e.g. https://kerslide.com/play/
var SCOPE_PATH = new URL(SCOPE).pathname;
var SHELL = ["manifest.webmanifest", "pwa.js", "favicon.png", "apple-touch-icon.png",
             "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
var BUILD_FILES = (params.get("files") || "").split(",").filter(Boolean).map(function (f) { return "Build/" + f; });
var MUSIC_LIST = "StreamingAssets/Audio/music.txt";

function ok(res) {
  if (!res || !res.ok) throw new Error("HTTP " + (res && res.status));
  return res;
}

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    var fresh = function (u) { return new Request(u, { cache: "reload" }); };
    return Promise.all([
      fetch(fresh(SCOPE)).then(ok).then(function (res) { return cache.put(SCOPE, res); }),
      cache.addAll(SHELL.map(fresh)),
      cache.addAll(BUILD_FILES),   // hashed names: the copies the game just downloaded (HTTP cache) are fine
      // Music is optional: without it the game still plays offline, just silently.
      fetch(fresh(MUSIC_LIST)).then(ok).then(function (res) {
        return res.clone().text().then(function (text) {
          var tracks = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
            .map(function (t) { return "StreamingAssets/Audio/" + t; });
          return Promise.all([cache.put(MUSIC_LIST, res), cache.addAll(tracks)]);
        });
      }).catch(function (e) { console.warn("[sw] music not cached for offline play:", e); }),
    ]);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromCache(req) {
  return caches.open(CACHE).then(function (cache) { return cache.match(req, { ignoreSearch: true }); });
}

function store(key, res) {
  if (res && res.ok && res.type === "basic") {
    var copy = res.clone();
    caches.open(CACHE).then(function (cache) { return cache.put(key, copy); }).catch(function () {});
  }
  return res;
}

function page() {
  var network = fetch(new Request(SCOPE, { cache: "no-cache", credentials: "same-origin" }))
    .then(function (res) { return store(SCOPE, res); });
  return fromCache(SCOPE).then(function (cached) {
    if (!cached) return network;
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(cached); }, 5000); });
    return Promise.race([network.catch(function () { return cached; }), timeout]);
  });
}

function cacheFirst(req) {
  return fromCache(req).then(function (cached) {
    return cached || fetch(req).then(function (res) { return store(req, res); });
  });
}

function networkFirst(req) {
  return fetch(req).then(function (res) { return store(req, res); }).catch(function (e) {
    return fromCache(req).then(function (cached) { if (cached) return cached; throw e; });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || req.url.indexOf(SCOPE) !== 0 || req.headers.has("range")) return;
  var rel = new URL(req.url).pathname.slice(SCOPE_PATH.length);
  if (rel === "" || rel === "index.html") event.respondWith(page());
  else if (req.mode === "navigate") return;
  else if (rel.indexOf("Build/") === 0 || rel.indexOf("StreamingAssets/") === 0) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});
