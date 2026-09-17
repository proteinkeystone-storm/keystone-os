#!/usr/bin/env python3
"""
Gardien anti-régression des QR en PROD (Smart Dynamic QR).

Vérifie, SANS jamais appeler /r/<id> (donc zéro faux scan) :
  - PRÉSENCE   : aucune redirection (short_id) ne disparaît.
  - REDIRECTION: target_url / qr_type / status inchangés pour chaque short_id
                 (la redirection /r/<id> est une fonction pure de cette ligne).
  - COMPTEUR   : le total montré au client (compteur journalier durable +
                 brut non encore consolidé) ne BAISSE jamais. C'est LUI
                 l'invariant, pas le journal brut.

⚠ Corrigé le 17/09/2026. L'ancienne version surveillait `qr_scans`, le
journal brut — qui s'efface LÉGITIMEMENT à 90 jours (RGPD, cron 3 h UTC).
Premier scan le 11/05, donc premier rognage le 09/08 : depuis, le gardien
criait « SCANS PERDUS » à chaque deploy, et la tentation était de refaire
un baseline pour repasser au vert — la meilleure façon de laisser filer une
vraie régression. Le brut est désormais affiché pour information, et seule
une baisse du COMPTEUR DURABLE (cf. workers/src/lib/qr-history.js) bloque.

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


# Total tel que le client le voit : compteur journalier + brut des jours pas
# encore consolidés (même frontière par QR que lib/qr-history.js).
COUNTER_SQL = """
SELECT short_id, SUM(n) AS c FROM (
  SELECT short_id, scans AS n FROM qr_scan_daily
  UNION ALL
  SELECT s.short_id, 1 AS n FROM qr_scans s
   WHERE date(s.ts) > IFNULL((SELECT MAX(d.day) FROM qr_scan_daily d WHERE d.short_id = s.short_id), '0000-00-00')
) GROUP BY short_id
"""


def snapshot():
    reds = q("SELECT short_id, qr_type, status, target_url, "
             "(encoded_payload IS NOT NULL) AS has_payload FROM qr_redirects")
    scans = q("SELECT short_id, count(*) AS c FROM qr_scans GROUP BY short_id")
    scanmap = {r["short_id"]: r["c"] for r in scans}
    try:
        counters = q(COUNTER_SQL)
        countmap = {r["short_id"]: r["c"] for r in counters}
    except (SystemExit, Exception):
        # Base d'avant la migration 020 : pas encore de compteur durable —
        # on retombe sur les comptes bruts, équivalents à cette date.
        sys.stderr.write("  i table qr_scan_daily absente — repli sur le journal brut\n")
        countmap = dict(scanmap)
    snap = {"redirects": {}, "scans": scanmap, "counter": countmap,
            "totals": {"redirects": len(reds),
                       "scans_total": sum(scanmap.values()),
                       "counter_total": sum(countmap.values()),
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
    # L'INVARIANT : le compteur montré au client ne baisse jamais.
    # Un baseline d'avant la migration 020 n'a pas de "counter" : on retombe
    # alors sur ses comptes bruts, qui en étaient l'équivalent à l'époque.
    base_counter = base.get("counter") or base.get("scans", {})
    for sid, bc in base_counter.items():
        cc = cur["counter"].get(sid, 0)
        if cc < bc:
            fails.append(f"HISTORIQUE PERDU — {sid} : {bc} -> {cc} (compteur durable)")
    if cur["totals"]["counter_total"] < sum(base_counter.values()):
        fails.append("TOTAL DURABLE EN BAISSE — "
                     f"{sum(base_counter.values())} -> {cur['totals']['counter_total']}")

    # Le journal brut, lui, s'efface à 90 jours : pour information seulement.
    notes = []
    for sid, bc in base.get("scans", {}).items():
        cc = cur["scans"].get(sid, 0)
        if cc < bc:
            notes.append(f"{sid} : {bc} -> {cc}")
    return cur, fails, notes


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
        print(f"  redirections={t['redirects']}  compteur_durable={t['counter_total']}  "
              f"brut={t['scans_total']}  QR_avec_scans={t['scanned_ids']}")
    elif mode == "verify":
        cur, fails, notes = verify(path)
        t = cur["totals"]
        if fails:
            print("✗ RÉGRESSION DÉTECTÉE — NE PAS DÉPLOYER / ROLLBACK :")
            for x in fails:
                print("   •", x)
            raise SystemExit(1)
        print("✓ OK — aucun QR perdu, aucune cible modifiée, aucun historique perdu.")
        print(f"  redirections={t['redirects']}  compteur_durable={t['counter_total']} (≥ baseline)  "
              f"brut={t['scans_total']}")
        if notes:
            print(f"  i {len(notes)} QR ont moins de lignes BRUTES qu'au baseline — "
                  "purge de rétention (90 j), sans effet sur l'historique :")
            for x in notes[:5]:
                print("     ·", x)
    else:
        print(__doc__); raise SystemExit(2)


if __name__ == "__main__":
    main()
