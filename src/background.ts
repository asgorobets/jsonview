/**
 * This is the background script that runs independent of any document. It
 * listens to main frame requests and kicks in if the headers indicate JSON. If
 * we have the filterResponseData API available, we will use that to change the
 * page to what Chrome displays for JSON (this is only used in Firefox). Then a
 * content script reformats the page.
 */

// Look for JSON if the content type is "application/json",
// or "application/whatever+json" or "application/json; charset=utf-8"
const jsonContentType = /^application\/(\w!#$&\.-\^\+)?json($|;)/;

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

/**
 * Use the filterResponseData API to transform a JSON document to HTML. This
 * converts to the same HTML that Chrome does by default - it's only used in
 * Firefox.
 */
function transformResponseToJSON(details: chrome.webRequest.WebResponseHeadersDetails) {
  const filter = browser.webRequest.filterResponseData(details.requestId);

  const dec = new TextDecoder("utf-8");
  const enc = new TextEncoder();

  filter.onstart = (_event) => {
    filter.write(enc.encode("<!DOCTYPE html><html><body><pre>"));
  };

  filter.ondata = (event) => {
    filter.write(enc.encode(dec.decode(event.data)));
  };

  filter.onstop = (_event: Event) => {
    filter.write(enc.encode("</pre></body></html>"));
    filter.disconnect();
  };
}

function detectJSON(event: chrome.webRequest.WebResponseHeadersDetails) {
  if (!event.responseHeaders || isRedirect(event.statusCode)) {
    return;
  }
  for (const header of event.responseHeaders) {
    if (
      header.name.toLowerCase() === "content-type" &&
      header.value &&
      jsonContentType.test(header.value)
    ) {
      addJsonUrl(event.url);
      if (typeof browser !== "undefined" && "filterResponseData" in browser.webRequest) {
        header.value = "text/html";
        transformResponseToJSON(event);
      }
    }
  }

  return { responseHeaders: event.responseHeaders };
}

// Listen for onHeaderReceived for the target page.
// Set "blocking" and "responseHeaders".
chrome.webRequest.onHeadersReceived.addListener(
  detectJSON,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking", "responseHeaders"]
);

// Listen for a message from the content script to decide whether to operate on
// the page. Calls sendResponse with a boolean that's true if the content script
// should run, and false otherwise.
chrome.runtime.onMessage.addListener((_message, sender, sendResponse) => {
  if (!sender.url) {
    sendResponse(false);
    return;
  }

  if (sender.url.startsWith("file://") && sender.url.endsWith(".json")) {
    sendResponse(true);
    return;
  }
  const isKnownJsonUrl = hasJsonUrl(sender.url);
  sendResponse(isKnownJsonUrl);
});

async function addJsonUrl(url: string) {
  await chrome.storage.session.set({ [url]: true });
}

async function hasJsonUrl(url: string) {
  const stored = await chrome.storage.session.get(url);
  const present = url in stored;
  await chrome.storage.session.remove(url);
  return present;
}
