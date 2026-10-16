"""Container health check: is the API answering? Stdlib only; slim images have no curl.

Sends the first ALLOWED_HOSTS name as the Host header, because Django refuses unknown hosts.
"""

import os
import sys
import urllib.request

host = (os.environ.get("ALLOWED_HOSTS") or "localhost").split(",")[0].strip()
request = urllib.request.Request(
    "http://127.0.0.1:8000/api/v1/health", headers={"Host": host, "X-Forwarded-Proto": "https"}
)
try:
    with urllib.request.urlopen(request, timeout=4) as response:  # noqa: S310 (fixed local URL)
        sys.exit(0 if response.status == 200 else 1)
except Exception:
    sys.exit(1)
