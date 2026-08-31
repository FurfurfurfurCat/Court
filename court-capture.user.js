// ==UserScript==
// @name         Court Search – Tennis Venues Capture
// @namespace    court-search.local
// @version      1.1.0
// @description  Returns visible Tennis Venues availability to Court Search, including seven-day batches.
// @match        https://www.tennisvenues.com.au/booking/*/timeslot*
// @grant        none
// @inject-into  content
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const handoff = new URLSearchParams(location.hash.slice(1));
  const token = handoff.get("courtSearchCapture") || "";
  const hasOpener = !!(window.opener && !window.opener.closed);

  function safeReturnUrl(raw) {
    try {
      const url = new URL(raw || "");
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.hash = "";
      return url.href;
    } catch (e) {
      return "";
    }
  }

  const returnUrl = safeReturnUrl(handoff.get("courtSearchReturn"));
  if (!token || (!returnUrl && !hasOpener)) return;

  let sent = false;

  function readVisibleAvailability() {
    const pathMatch = location.pathname.match(/^\/booking\/([^/]+)\/timeslot\/?$/);
    const venueSlug = pathMatch?.[1] || "";
    const date = new URL(location.href).searchParams.get("date") || "";
    const courtButtons = [...document.querySelectorAll(".v3-court-btn[id^='v3_court_btn_']:not(.v3-court-more)")];
    const links = [...document.querySelectorAll("a.v3-slot-btn[href*='/booking/request']")];

    // Court buttons remain visible on a valid zero-availability date. Without
    // them, the official page is still loading or showing a security check.
    if (!venueSlug || !/^\d{8}$/.test(date) || !courtButtons.length) return null;

    const courts = {};
    for (const button of courtButtons) {
      const name = button.textContent.replace(/\s+/g, " ").trim();
      if (name) courts[name] = [];
    }

    for (const link of links) {
      const url = new URL(link.href, location.href);
      const slug = url.searchParams.get("v") || "";
      const courtId = url.searchParams.get("id") || "";
      const ymd = url.searchParams.get("d") || "";
      const rawTime = (url.searchParams.get("t") || "").padStart(4, "0");

      if (!slug || !courtId || !/^\d{8}$/.test(ymd) || !/^\d{4}$/.test(rawTime)) continue;
      if (slug !== venueSlug || ymd !== date) continue;

      const courtButton = document.getElementById("v3_court_btn_" + courtId);
      const courtName = (courtButton?.textContent || courtId).replace(/\s+/g, " ").trim();
      const time = rawTime.slice(0, 2) + ":" + rawTime.slice(2);
      const item = { time, url: url.href };

      if (!courts[courtName]) courts[courtName] = [];
      if (!courts[courtName].some(existing => existing.time === time)) courts[courtName].push(item);
    }

    for (const entries of Object.values(courts)) {
      entries.sort((a, b) => a.time.localeCompare(b.time));
    }

    const venueName = (document.querySelector(".booking-topbar-venue-name a")?.textContent || document.title)
      .replace(/\s+/g, " ").trim();

    return {
      version: 1,
      source: "tennisvenues.com.au",
      venueSlug,
      venueName,
      date,
      capturedAt: new Date().toISOString(),
      pageUrl: location.href.split("#")[0],
      courts
    };
  }

  // Keep return URLs small enough for iPhone Safari by replacing each full
  // booking URL with only its court id. Court Search reconstructs and validates
  // the official booking URL before saving it.
  function compactPayload(payload) {
    const courts = {};
    for (const [name, entries] of Object.entries(payload.courts)) {
      courts[name] = entries.map(item => {
        const url = new URL(item.url);
        return { time: item.time, courtId: url.searchParams.get("id") || "" };
      });
    }
    return { ...payload, courts };
  }

  function courtSearchUrl(key, value) {
    const url = new URL(returnUrl);
    url.hash = new URLSearchParams({
      [key]: JSON.stringify({ token, ...value })
    }).toString();
    return url.href;
  }

  function showNotice(message, isError = false) {
    const notice = document.createElement("div");
    notice.textContent = message;
    notice.style.cssText = `position:fixed;inset:16px 16px auto;z-index:2147483647;padding:14px 18px;border-radius:12px;background:${isError ? "#991b1b" : "#173f35"};color:white;font:600 16px system-ui;text-align:center;box-shadow:0 8px 30px #0005`;
    document.documentElement.appendChild(notice);
  }

  function finishIfReady() {
    if (sent) return true;
    const payload = readVisibleAvailability();
    if (!payload) return false;

    sent = true;
    showNotice("Times captured — returning to Court Search…");

    if (returnUrl) {
      const next = courtSearchUrl("courtSearchResult", { payload: compactPayload(payload) });
      setTimeout(() => location.replace(next), 350);
    } else {
      window.opener.postMessage({ type: "court-search-capture", token, payload }, "*");
      setTimeout(() => window.close(), 250);
    }
    return true;
  }

  if (finishIfReady()) return;

  const observer = new MutationObserver(() => {
    if (finishIfReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    if (sent || !returnUrl) return;
    sent = true;
    showNotice("This page did not finish loading. Returning to Court Search…", true);
    const next = courtSearchUrl("courtSearchError", {
      message: "The official page did not expose its court times within 30 seconds.",
      pageUrl: location.href.split("#")[0]
    });
    setTimeout(() => location.replace(next), 700);
  }, 30000);
})();
