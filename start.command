#!/bin/bash
#
# Court Search launcher — double-click this file in Finder.
#
# Why serve it instead of just opening the .html?
# Safari extensions cannot inject scripts into file:// pages at all, so the
# tennisvenues helper can never load there. Serving over HTTP works in Safari
# and also lets an iPhone on the same Wi-Fi open the page from this Mac.
#
# Leave the Terminal window open while you use the page; closing it stops the
# server. Re-running this file when it's already going just opens the page.

set -u

PORT=8777
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:${PORT}/index.html"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

cd "$DIR" || { echo "Could not enter $DIR"; exit 1; }

if [ ! -f index.html ]; then
  echo "index.html not found in:"
  echo "  $DIR"
  echo "Keep start.command in the same folder as the page."
  read -r -p "Press return to close. "
  exit 1
fi

# Already serving on this port? Just open the page again.
if curl -s -o /dev/null --max-time 2 "$URL"; then
  echo "Already running — opening $URL"
  open "$URL"
  exit 0
fi

echo "Serving $DIR"
echo "        on $URL"
if [ -n "$LAN_IP" ]; then
  echo "    iPhone: http://${LAN_IP}:${PORT}/index.html"
  echo "            (Mac and iPhone must be on the same Wi-Fi)"
fi
echo
echo "Keep this window open. Press Control-C to stop."
echo

# Give the server a moment to bind, then open the browser.
( sleep 1; open "$URL" ) &

exec python3 -m http.server "$PORT" --bind 0.0.0.0
