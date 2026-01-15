from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from filelock import FileLock
import ssl
import subprocess
import certifi

try:
    import truststore
    truststore.inject_into_ssl()  # use macOS system trust store
except Exception:
    pass


TERM_RE = re.compile(r"^\d{4}$")         # e.g., 2530
SUBJECT_RE = re.compile(r"^[A-Z]{3,5}$") # e.g., COMP, MATH, ECON


@dataclass
class FetchResult:
    html: str
    fetched_at: float
    cache_hit: bool
    url: str


class WcqClient:
    def __init__(
        self,
        cache_dir: str | Path = ".cache_wcq",
        ttl_seconds: int = 20 * 60,  # 20 minutes
        base_url: str = "https://w5.ab.ust.hk/wcq/cgi-bin",
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.ttl_seconds = ttl_seconds
        self.base_url = base_url.rstrip("/")

        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _validate(self, term: str, subject: str) -> tuple[str, str]:
        term = term.strip()
        subject = subject.strip().upper()

        if not TERM_RE.match(term):
            raise ValueError("term must be 4 digits, e.g. 2530")
        if not SUBJECT_RE.match(subject):
            raise ValueError("subject must be 3-5 letters, e.g. COMP, MATH")

        return term, subject

    def _paths(self, term: str, subject: str) -> tuple[Path, Path]:
        folder = self.cache_dir / term
        folder.mkdir(parents=True, exist_ok=True)
        html_path = folder / f"subject_{subject}.html"
        meta_path = folder / f"subject_{subject}.meta"
        return html_path, meta_path

    def fetch_subject_html(self, term: str, subject: str, force_refresh: bool = False) -> FetchResult:
        term, subject = self._validate(term, subject)
        url = f"{self.base_url}/{term}/subject/{subject}"

        html_path, meta_path = self._paths(term, subject)
        lock_path = str(html_path) + ".lock"

        with FileLock(lock_path):
            now = time.time()

            if html_path.exists() and meta_path.exists() and not force_refresh:
                try:
                    fetched_at = float(meta_path.read_text().strip())
                except Exception:
                    fetched_at = 0.0

                if now - fetched_at <= self.ttl_seconds:
                    return FetchResult(
                        html=html_path.read_text(encoding="utf-8", errors="ignore"),
                        fetched_at=fetched_at,
                        cache_hit=True,
                        url=url,
                    )

            headers = {
                "User-Agent": "hkust-timetable-optimizer/0.1 (personal project; respectful caching)",
                "Accept": "text/html,application/xhtml+xml",
            }

            def fetch_via_httpx() -> str:
                # Force TLS 1.2 (some servers/network paths choke on TLS 1.3)
                ctx = ssl.create_default_context()
                ctx.minimum_version = ssl.TLSVersion.TLSv1_2
                ctx.maximum_version = ssl.TLSVersion.TLSv1_2
                ctx.load_verify_locations(certifi.where())

                transport = httpx.HTTPTransport(retries=3, http1=True, http2=False)

                with httpx.Client(
                    timeout=httpx.Timeout(25.0, connect=15.0),
                    headers=headers,
                    verify=ctx,
                    follow_redirects=True,
                    transport=transport,
                ) as client:
                    resp = client.get(url)
                    resp.raise_for_status()
                    return resp.text

            def fetch_via_curl() -> str:
                # Fallback to system curl (uses macOS TLS stack)
                cmd = [
                    "curl", "-L",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--compressed",
                    "--max-time", "25",
                    url,
                ]
                p = subprocess.run(cmd, capture_output=True, text=True)
                if p.returncode != 0:
                    raise RuntimeError(f"curl failed: {p.stderr.strip()}")
                return p.stdout

            try:
                html = fetch_via_httpx()
            except Exception as e:
                # If Python TLS path fails, try curl
                html = fetch_via_curl()


            # Atomic-ish write
            tmp_path = html_path.with_suffix(".html.tmp")
            tmp_path.write_text(html, encoding="utf-8")
            os.replace(tmp_path, html_path)
            meta_path.write_text(str(now), encoding="utf-8")

            return FetchResult(html=html, fetched_at=now, cache_hit=False, url=url)
