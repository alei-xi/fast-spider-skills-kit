"""Persistent Node-process signer wrapper.

Spawns one `node core/sign.js --server` subprocess and reuses it for all signs.
~85x faster than one-shot subprocess per call.

Protocol over stdin/stdout (JSONL):
    -> {"id": <int>, "url": "<url>"}
    <- {"id": <int>, "ok": true, "signed_url": "<url>", "<sig-param>": "..."}
    <- {"id": <int>, "ok": false, "error": "<message>"}

Companion Node process (`core/sign.js`) is expected to:
  1. On startup, write `{"ready": true}` to stdout.
  2. For each line on stdin, parse JSON, sign, reply with one JSON line.
  3. Exit cleanly on SIGTERM.
"""

from __future__ import annotations

import atexit
import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional


class SigningError(RuntimeError):
    pass


class PersistentSigner:
    """Thread-safe wrapper for a long-lived Node signing subprocess."""

    def __init__(
        self,
        sign_js_path: str | Path,
        user_agent: Optional[str] = None,
        node_bin: str = 'node',
        startup_timeout: float = 15.0,
    ) -> None:
        self._sign_js = str(Path(sign_js_path).resolve())
        if not Path(self._sign_js).exists():
            raise FileNotFoundError(self._sign_js)

        cmd = [node_bin, self._sign_js, '--server']
        if user_agent:
            cmd += ['--ua', user_agent]

        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding='utf-8',
            bufsize=1,
            cwd=str(Path(self._sign_js).parent),
        )
        self._lock = threading.Lock()
        self._next_id = 0

        # Wait for ready signal
        line = self._readline_with_timeout(startup_timeout)
        if not line:
            self._dump_stderr_and_die('signer process exited before ready')
        try:
            ready = json.loads(line)
        except json.JSONDecodeError:
            self._dump_stderr_and_die(f'unparseable startup line: {line!r}')
        if not ready.get('ready'):
            self._dump_stderr_and_die(f'signer not ready: {ready}')

        atexit.register(self.close)

    def _readline_with_timeout(self, timeout: float) -> str:
        line_holder: list[str] = []

        def _read():
            line_holder.append(self._proc.stdout.readline())

        t = threading.Thread(target=_read, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            raise SigningError(f'signer startup timed out after {timeout}s')
        return line_holder[0]

    def _dump_stderr_and_die(self, msg: str) -> None:
        try:
            err = self._proc.stderr.read() if self._proc.stderr else ''
        except Exception:
            err = ''
        self.close()
        raise SigningError(f'{msg}; stderr: {err[:1000]}')

    def sign(self, url: str) -> dict:
        """Sign one URL. Returns the parsed JSON reply from Node."""
        if self._proc.poll() is not None:
            raise SigningError(f'signer process exited (code={self._proc.returncode})')

        with self._lock:
            self._next_id += 1
            req = {'id': self._next_id, 'url': url}
            try:
                self._proc.stdin.write(json.dumps(req) + '\n')
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError) as e:
                raise SigningError(f'failed to write request: {e}') from e

            line = self._proc.stdout.readline()
            if not line:
                self._dump_stderr_and_die('signer closed stdout mid-request')

            try:
                resp = json.loads(line)
            except json.JSONDecodeError as e:
                raise SigningError(f'unparseable reply: {line!r}') from e

        if not resp.get('ok'):
            raise SigningError(resp.get('error', 'unknown error'))
        return resp

    def close(self) -> None:
        if getattr(self, '_proc', None) is None:
            return
        try:
            if self._proc.poll() is None:
                try:
                    self._proc.stdin.close()
                except Exception:
                    pass
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
        finally:
            self._proc = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


# ------------ smoke test ------------
# Run: SIGN_JS=path/to/your/sign.js TARGET_URL=https://... python persistent_signer.py
if __name__ == '__main__':
    import time

    sign_js = os.environ.get('SIGN_JS', './core/sign.js')
    ua = os.environ.get(
        'UA',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    )
    # Replace with your target URL. Whatever the page calls when it normally
    # signs — query params and all (the signer hashes the raw query string).
    target = os.environ.get(
        'TARGET_URL',
        'https://www.example.com/api/v1/feed/list?param1=value1&param2=value2',
    )

    with PersistentSigner(sign_js, user_agent=ua) as s:
        t0 = time.time()
        r = s.sign(target)
        print(f'first sign in {(time.time() - t0) * 1000:.0f} ms: {r["signed_url"][-80:]}')

        n = 20
        t0 = time.time()
        for _ in range(n):
            s.sign(target)
        avg = (time.time() - t0) * 1000 / n
        print(f'avg of {n} subsequent signs: {avg:.1f} ms')
