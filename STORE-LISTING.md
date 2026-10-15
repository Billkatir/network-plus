# Chrome Web Store listing — copy/paste helper

Everything below is text to paste into the Developer Dashboard when you submit
`network-plus-vX.Y.Z.zip`. Not shipped with the extension (it's just notes).

---

## Item name
Network+

## Summary (max 132 chars)
A better DevTools Network tab: capture, search, inspect, and export requests as Python or cURL.

## Category
Developer Tools

## Description (store "Detailed description")
Network+ adds a panel to Chrome DevTools that makes working with network traffic faster and friendlier.

• Live capture of every request (method, status, type, URL)
• Instant search across URLs, headers, and query params — with optional deep search inside response bodies and regex support
• "Grab docs" captures rendered page + same-origin iframe HTML so server-rendered values become searchable
• Detail inspector for request/response headers, query, bodies (pretty-printed JSON)
• Export any request as clean, parameterized Python (requests)
• Export a Python pipeline that traces how a token/id/session was produced by an earlier response and wires it through automatically
• Export as cURL, or save the whole session as a .har file
• Preserve-log option across reloads

Everything runs locally in your browser. No servers, no analytics, no telemetry.

## Single purpose (required field)
Network+ provides a Chrome DevTools panel for inspecting, searching, and exporting the network requests of the page being debugged.

## Permission justifications
- devtools_page: Network+ is a DevTools extension; it registers a panel via the standard chrome.devtools APIs. It requests no host permissions and no other Chrome permissions. It can access request/response and page data only for the tab whose DevTools is open, and only while DevTools is open.

## Data usage disclosures (Privacy tab checkboxes)
- Does your extension collect user data? → It processes request/response and page content locally to provide its features, but does NOT collect, transmit, sell, or share any user data.
- I do NOT sell or transfer user data to third parties → ✔
- I do NOT use or transfer user data for purposes unrelated to the item's single purpose → ✔
- I do NOT use or transfer user data to determine creditworthiness / for lending → ✔

## Privacy policy URL
Host PRIVACY.md somewhere public and paste its URL here, e.g.:
https://github.com/<you>/network-plus/blob/main/PRIVACY.md

## Assets you still need to upload
- At least one screenshot: 1280x800 or 640x400 PNG/JPEG (a shot of the panel in action)
- Icon 128x128 is already in the package (icons/icon128.png)
- Optional: small promo tile 440x280
