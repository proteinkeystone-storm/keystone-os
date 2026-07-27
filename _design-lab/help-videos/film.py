# ═══════════════════════════════════════════════════════════════
# Atelier vidéos d'aide — RÉALISATEUR
# ─────────────────────────────────────────────────────────────
# Pilote Chrome headless en CDP, fait avancer le scénario image
# par image (window.__film.tick(t), cf. tournage.js) et assemble
# le MP4 via le ffmpeg embarqué d'imageio-ffmpeg.
#
#   python3 film.py tournage-missive.html /chemin/sortie.mp4
#
# Dépendances : pip3 install websocket-client imageio-ffmpeg
# Le serveur HTTP (racine du repo) et Chrome sont lancés/tués ici.
# ═══════════════════════════════════════════════════════════════
import json, subprocess, sys, time, base64, urllib.request, os, signal, tempfile

import websocket                      # websocket-client
from imageio_ffmpeg import get_ffmpeg_exe

# urllib applique le proxy système même à 127.0.0.1 → CDP « injoignable »
# alors que Chrome tourne. On force l'accès direct.
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))

FPS       = 12
VIEW_W, VIEW_H = 1280, 800
DSF       = 2                          # rendu 2x, encodé en 1280x800
HTTP_PORT = 3010
CDP_PORT  = 9333
CHROME    = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REPO      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STALL_MAX_S = 25                       # garde-fou waitFor

def main():
    harness, out_mp4 = sys.argv[1], sys.argv[2]
    url = f"http://127.0.0.1:{HTTP_PORT}/_design-lab/help-videos/{harness}"

    httpd = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(HTTP_PORT), "--directory", REPO],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    profile = tempfile.mkdtemp(prefix="film-profile-")
    chrome = subprocess.Popen([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        # sans quoi le handshake WebSocket CDP répond 403 (contrôle d'Origin)
        "--remote-allow-origins=*",
        f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={profile}",
        f"--window-size={VIEW_W},{VIEW_H}", "--no-first-run", "--mute-audio",
        url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        ws = _connect_page()
        _msg_id = [0]

        def cdp(method, params=None, timeout=30):
            _msg_id[0] += 1
            mid = _msg_id[0]
            ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            deadline = time.time() + timeout
            while time.time() < deadline:
                raw = json.loads(ws.recv())
                if raw.get("id") == mid:
                    if "error" in raw:
                        raise RuntimeError(f"{method}: {raw['error']}")
                    return raw.get("result", {})
            raise TimeoutError(method)

        cdp("Page.enable")
        cdp("Runtime.enable")
        cdp("Emulation.setDeviceMetricsOverride", {
            "width": VIEW_W, "height": VIEW_H, "deviceScaleFactor": DSF, "mobile": False,
        })

        # Attend le driver de tournage
        for _ in range(100):
            r = cdp("Runtime.evaluate", {"expression": "!!window.__filmReady", "returnByValue": True})
            if r.get("result", {}).get("value"):
                break
            time.sleep(0.15)
        else:
            raise RuntimeError("tournage.js ne s'est pas annoncé (__filmReady)")

        # ffmpeg en pipe PNG
        ff = subprocess.Popen([
            get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-f", "image2pipe", "-vcodec", "png", "-r", str(FPS), "-i", "-",
            "-vf", f"scale={VIEW_W}:-2",
            "-c:v", "libx264", "-preset", "medium", "-crf", "22",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            out_mp4,
        ], stdin=subprocess.PIPE)

        t, frames, stall_start = 0.0, 0, None
        step_ms = 1000.0 / FPS
        while True:
            r = cdp("Runtime.evaluate", {
                "expression": f"window.__film.tick({t})",
                "awaitPromise": True, "returnByValue": True,
            })
            state = r.get("result", {}).get("value") or {}

            shot = cdp("Page.captureScreenshot", {"format": "png"})
            ff.stdin.write(base64.b64decode(shot["data"]))
            frames += 1

            if state.get("waiting"):
                stall_start = stall_start or time.time()
                if time.time() - stall_start > STALL_MAX_S:
                    raise RuntimeError(f"waitFor bloqué à t={t:.0f} ms")
                continue                       # le temps scénario ne bouge pas
            stall_start = None

            if state.get("done"):
                break
            t += step_ms
            if frames % 60 == 0:
                print(f"  … t={t/1000:.1f}s, {frames} images")

        ff.stdin.close()
        ff.wait()
        print(f"✓ {out_mp4} — {frames} images ({frames/FPS:.1f} s à {FPS} img/s)")
    finally:
        chrome.terminate(); httpd.terminate()
        try: chrome.wait(timeout=5)
        except Exception: chrome.kill()
        httpd.kill()

def _connect_page():
    deadline = time.time() + 45
    while time.time() < deadline:
        try:
            with _direct.open(f"http://127.0.0.1:{CDP_PORT}/json") as f:
                targets = json.loads(f.read())
            pages = [t for t in targets if t.get("type") == "page" and "help-videos" in t.get("url", "")]
            if not pages:
                # repli : n'importe quel onglet http (le harnais est le seul)
                pages = [t for t in targets if t.get("type") == "page" and t.get("url", "").startswith("http")]
            if pages:
                ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=60,
                                                 http_proxy_host=None, enable_multithread=False)
                ws.settimeout(60)
                return ws
        except Exception as e:
            print(f"  (cdp retry: {type(e).__name__}: {str(e)[:100]})")
        time.sleep(0.5)
    raise RuntimeError("Chrome CDP injoignable")

if __name__ == "__main__":
    main()
