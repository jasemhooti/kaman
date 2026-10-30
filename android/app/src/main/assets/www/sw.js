/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "402b66900e731ca748771b6fc5e7a068"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "7a189ee07b26824ca4eb0e2512edadf0"
  }, {
    "url": "pwa-512x512.png",
    "revision": "7a189ee07b26824ca4eb0e2512edadf0"
  }, {
    "url": "pwa-192x192.png",
    "revision": "dcf28661f1cd3984a9dc114a79285e56"
  }, {
    "url": "index.html",
    "revision": "540270e9829ea946deaac45cfbaa1665"
  }, {
    "url": "icon.svg",
    "revision": "6f9d3733312dcc091c011b106ae877fa"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "9b07372012f2bb07c6bb06c9ee433539"
  }, {
    "url": "assets/index-DknPtx31.js",
    "revision": null
  }, {
    "url": "assets/index-BVCLjgf8.css",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "9b07372012f2bb07c6bb06c9ee433539"
  }, {
    "url": "icon.svg",
    "revision": "6f9d3733312dcc091c011b106ae877fa"
  }, {
    "url": "pwa-192x192.png",
    "revision": "dcf28661f1cd3984a9dc114a79285e56"
  }, {
    "url": "pwa-512x512.png",
    "revision": "7a189ee07b26824ca4eb0e2512edadf0"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "7a189ee07b26824ca4eb0e2512edadf0"
  }, {
    "url": "manifest.webmanifest",
    "revision": "a856dd30cb31edf0f84681b01af91482"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));

}));
