#!/usr/bin/env python3
"""
Gardien anti-régression des QR en PROD (Smart Dynamic QR).

Vérifie, SANS jamais appeler /r/<id> (donc zéro faux scan) :
  - PRÉSENCE   : aucune redirection (short_id) ne disparaît.
  - REDIRECTION: target_url / qr_type / status inchangés pour chaque short_id
                 (la redirection /r/<id> est une fonction pure de cette ligne).
  - STATS      : le nombre de scans par QR ne BAISSE jamais (append-only).

Usage :
  python3 scripts/qr_prod_guard.py snapshot <fichier.json>      # capture l'état
  python3 scripts/qr_prod_guard.py verify   <baseline.json>     # compare au baseline
Sortie verify : code 0 = OK, code 1 = régression détectée (détaillée).
"""
import sys, os, json, subprocess

DB = "keystone-os"
WORKERS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "workers")


def q(sql):
    p = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
        cwd=WORKERS_DIR, capture_output=True, text=True,
    )
    if p.returncode != 0:
        sys.stderr.write(p.stderr or p.stdout)
        raise SystemExit("wrangler a échoué (auth / réseau ?)")
    out = p.stdout
    i = out.find("[")
    if i < 0:
        raise SystemExit("sortie wrangler inattendue:\n" + out[:400])
    return json.loads(out[i:])[0]["results"]


def snapshot():
    reds = q("SELECT short_id, qr_type, status, target_url, "
             "(encoded_payload IS NOT NULL) AS has_payload FROM qr_redirects")
    scans = q("SELECT short_id, count(*) AS c FROM qr_scans GROUP BY short_id")
    scanmap = {r["short_id"]: r["c"] for r in scans}
    snap = {"redirects": {}, "scans": scanmap,
            "totals": {"redirects": len(reds),
                       "scans_total": sum(scanmap.values()),
                       "scanned_ids": len(scanmap)}}
    for r in reds:
        snap["redirects"][r["short_id"]] = {
            "type": r["qr_type"], "status": r["status"],
            "target": r["target_url"], "has_payload": bool(r["has_payload"])}
    return snap


def verify(baseline_path):
    with open(baseline_path) as f:
        base = json.load(f)
    cur = snapshot()
    fails = []
    for sid, b in base["redirects"].items():
        c = cur["redirects"].get(sid)
        if not c:
            fails.append(f"DISPARU — la redirection {sid} n'existe plus")
            continue
        if c["target"] != b["target"]:
            fails.append(f"CIBLE CHANGÉE — {sid} : {b['target']} -> {c['target']}")
        if c["type"] != b["type"]:
            fails.append(f"TYPE CHANGÉ — {sid} : {b['type']} -> {c['type']}")
        if c["status"] != b["status"]:
            fails.append(f"STATUT CHANGÉ — {sid} : {b['status']} -> {c['status']}")
    for sid, bc in base["scans"].items():
        cc = cur["scans"].get(sid, 0)
        if cc < bc:
            fails.append(f"SCANS PERDUS — {sid} : {bc} -> {cc}")
    if cur["totals"]["scans_total"] < base["totals"]["scans_total"]:
        fails.append("TOTAL SCANS EN BAISSE — "
                     f"{base['totals']['scans_total']} -> {cur['totals']['scans_total']}")
    return cur, fails


def main():
    if len(sys.argv) < 3:
        print(__doc__); raise SystemExit(2)
    mode, path = sys.argv[1], sys.argv[2]
    if mode == "snapshot":
        snap = snapshot()
        with open(path, "w") as f:
            json.dump(snap, f, ensure_ascii=False, indent=2)
        t = snap["totals"]
        print(f"✓ Snapshot écrit : {path}")
        print(f"  redirections={t['redirects']}  scans_total={t['scans_total']}  "
              f"QR_avec_scans={t['scanned_ids']}")
    elif mode == "verify":
        cur, fails = verify(path)
        t = cur["totals"]
        if fails:
            print("✗ RÉGRESSION DÉTECTÉE — NE PAS DÉPLOYER / ROLLBACK :")
            for x in fails:
                print("   •", x)
            raise SystemExit(1)
        print("✓ OK — aucun QR perdu, aucune cible modifiée, aucun scan perdu.")
        print(f"  redirections={t['redirects']}  scans_total={t['scans_total']} (≥ baseline)")
    else:
        print(__doc__); raise SystemExit(2)


if __name__ == "__main__":
    main()
