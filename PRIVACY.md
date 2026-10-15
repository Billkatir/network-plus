# Privacy Policy — Network+

_Last updated: 2026-10-16_

Network+ is a Chrome DevTools extension that helps developers capture, inspect, search, and export network requests made by the page they are actively debugging.

## What data the extension accesses

While its DevTools panel is open, Network+ can read, **only for the tab whose DevTools you have open**:

- Network requests and responses the page makes (URLs, methods, headers, query strings, request bodies, response bodies).
- The rendered HTML of the inspected page and its same-origin iframes, when you click **Grab docs**.

This is the same data the built-in Chrome **Network** panel shows. Network+ accesses it through Chrome's standard `chrome.devtools` APIs.

## How the data is used

- All processing happens **locally, in your browser**, to display the request list, power search, and generate exports (Python, cURL, HAR).
- Data is held in memory for the duration of the DevTools session and is cleared when you clear the list, navigate (unless *Preserve log* is on), or close DevTools.

## What the extension does NOT do

- It does **not** send any data to the developer or to any external server.
- It does **not** use analytics, tracking, or telemetry.
- It does **not** sell or transfer your data to third parties.
- It does **not** run outside the DevTools session, and it requests **no host permissions**.

## Exports you initiate

When you choose to copy a request as Python/cURL or export a HAR file, that output goes **only** where you send it — your clipboard or a file you save. The extension does not transmit it anywhere.

## Contact

Questions about this policy can be directed to the project's GitHub issues page.
