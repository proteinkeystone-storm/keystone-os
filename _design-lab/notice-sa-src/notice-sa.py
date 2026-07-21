# ═══════════════════════════════════════════════════════════════
#  NOTICE SMART AGENT — source régénérable
#  Produit NOTICE_SMART_AGENT.html puis le PDF via Chrome headless.
#
#  L'édition du 16/07/2026 n'avait AUCUNE source : le PDF avait été
#  produit une fois, la mise en page perdue. D'où ce fichier — la
#  prochaine mise à jour sera une édition de texte, pas une refonte.
#
#  Les captures sont celles de l'édition précédente, ré-encodées en
#  base64 (assets.py) : le document reste autoportant, sans dossier
#  d'images à traîner.
# ═══════════════════════════════════════════════════════════════
from assets import ASSETS
import pathlib

EDITION = "21 juillet 2026"

CSS = """
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; background: #fff; color: #111827;
  font: 400 10pt/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  letter-spacing: -0.011em; -webkit-font-smoothing: antialiased;
}
/* Pages EXPLICITES : la pagination est décidée ici, pas subie.
   C'est ce qui permet de placer chaque capture en tête de page. */
.page {
  position: relative; width: 210mm; height: 297mm;
  padding: 20mm 18mm 16mm; overflow: hidden;
  break-after: page; page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.folio {
  position: absolute; left: 0; right: 0; bottom: 9mm;
  text-align: center; font-size: 8pt; color: #9aa2b1;
}

/* ── Couverture ─────────────────────────────────────────────── */
.cover { padding: 0; }
.cover-panel {
  position: absolute; inset: 12mm 12mm 22mm;
  border-radius: 6mm; padding: 14mm 13mm;
  background: radial-gradient(120% 90% at 85% 8%, #29306b 0%, #171d3d 42%, #0d1122 100%);
  color: #fff; display: flex; flex-direction: column;
}
.cover-logo { width: 46mm; margin-bottom: auto; }
.pill {
  display: inline-block; align-self: flex-start;
  padding: 2.2mm 4mm; border-radius: 99px;
  background: rgba(129,140,248,.16); border: 1px solid rgba(129,140,248,.42);
  color: #b6bcff; font-size: 7.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  margin-bottom: 6mm;
}
.cover h1 { margin: 0; font-size: 30pt; font-weight: 900; letter-spacing: -0.035em; line-height: 1.08; }
.cover h1 em { display: block; font-style: normal; color: #8b93f8; }
.cover .lede { margin: 6mm 0 0; max-width: 118mm; font-size: 10.5pt; line-height: 1.55; color: rgba(255,255,255,.8); }
.meta {
  margin-top: 12mm; padding-top: 7mm; border-top: 1px solid rgba(255,255,255,.16);
  display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 10mm;
}
.meta dt { font-size: 7pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.42); }
.meta dd { margin: 1.2mm 0 0; font-size: 9.5pt; color: #fff; }

/* ── Sections ───────────────────────────────────────────────── */
.sec { border-top: 2.2px solid #111827; padding-top: 4mm; margin-bottom: 5mm; }
.sec h2 { margin: 0; font-size: 15pt; font-weight: 900; letter-spacing: -0.028em; }
.sec h2 b { color: #4f46e5; margin-right: 2.5mm; }
.sec .kicker { margin: 2.5mm 0 0; font-size: 9pt; line-height: 1.5; color: #5b6474; }
h3 { margin: 6mm 0 2mm; font-size: 11pt; font-weight: 800; letter-spacing: -0.022em; }
h4 { margin: 5mm 0 1.5mm; font-size: 9.5pt; font-weight: 800; letter-spacing: -0.02em; }
p { margin: 0 0 2.6mm; }
strong, b { font-weight: 700; }
.ui { font-weight: 600; background: #eef0f6; border-radius: 2px; padding: 0.3mm 1.4mm; white-space: nowrap; }
code { font: 500 8.5pt ui-monospace, SFMono-Regular, Menlo, monospace; background: #eef0f6; padding: .3mm 1.2mm; border-radius: 2px; color: #3f3fb5; }
ul { margin: 0 0 2.6mm; padding-left: 5mm; }
li { margin-bottom: 1.6mm; }

/* ── Étapes numérotées ──────────────────────────────────────── */
.step { display: flex; gap: 4mm; margin-bottom: 5mm; }
.step-n {
  flex: none; width: 7mm; height: 7mm; border-radius: 50%;
  background: #4f46e5; color: #fff; font-size: 9pt; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.step-b { flex: 1; min-width: 0; }
.step-b h3 { margin-top: 0.6mm; }

/* ── Encadrés ───────────────────────────────────────────────── */
.callout {
  margin: 4mm 0; padding: 4mm 5mm; border-radius: 3px;
  background: #eefaf1; border: 1px solid #bfe6cb; border-left: 3px solid #16a34a;
}
.callout .t { font-weight: 800; color: #15803d; font-size: 9.5pt; margin-bottom: 1.5mm; }
.callout p { margin: 0; font-size: 9pt; }
.callout.warn { background: #fdf1f1; border-color: #ecc3c3; border-left-color: #c53030; }
.callout.warn .t { color: #b02a2a; }
.callout.neutral { background: #f2f4fb; border-color: #cfd5ee; border-left-color: #4f46e5; }
.callout.neutral .t { color: #3f3fb5; }

/* ── Tableaux ───────────────────────────────────────────────── */
table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 2mm 0 3mm; }
th { text-align: left; vertical-align: bottom; padding: 0 3mm 2mm 0;
     font-size: 7pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #7c8494;
     border-bottom: 1.4px solid #111827; }
td { padding: 2.6mm 3mm 2.6mm 0; vertical-align: top; border-bottom: 1px solid #e6e9ef; line-height: 1.45; }
td:first-child { font-weight: 700; width: 26mm; }
tr:last-child td { border-bottom: 0; }

/* ── Captures ───────────────────────────────────────────────── */
figure { margin: 0 0 5mm; }
figure img { width: 100%; display: block; border: 1px solid #dfe3ec; border-radius: 3px; }
figcaption { margin-top: 2mm; font-size: 8pt; line-height: 1.4; color: #7c8494; }

.colophon { font-size: 8.5pt; line-height: 1.6; color: #5b6474; }
.new { display: inline-block; margin-left: 2mm; padding: .4mm 1.8mm; border-radius: 2px;
       background: #4f46e5; color: #fff; font-size: 6.5pt; font-weight: 800; letter-spacing: .08em;
       text-transform: uppercase; vertical-align: 1.2mm; }
"""

def page(inner, n, total, cls=""):
    return f'<section class="page {cls}">{inner}<div class="folio">{n} / {total}</div></section>'

def build():
    P = []

    # ── 1. Couverture ────────────────────────────────────────
    P.append(f"""
      <div class="cover-panel">
        <img class="cover-logo" src="{ASSETS['logo']}" alt="Keystone">
        <span class="pill">Keystone OS · Notice d'utilisation</span>
        <h1>Smart Agent<em>Votre jumeau de savoir-faire</em></h1>
        <p class="lede">L'assistant IA qui répond à vos clients uniquement depuis le savoir
        que vous avez validé — jamais d'invention. Description de l'application et guide pas à pas.</p>
        <dl class="meta">
          <div><dt>Application</dt><dd>Smart Agent (pad O-AGT-001)</dd></div>
          <div><dt>Éditeur</dt><dd>Protein Studio — Keystone OS</dd></div>
          <div><dt>Édition</dt><dd>{EDITION}</dd></div>
          <div><dt>Formule</dt><dd>Max (pendant la beta)</dd></div>
          <div><dt>Langues côté visiteur</dt><dd>Français · Anglais · Espagnol · Allemand</dd></div>
          <div><dt>Accès visiteur</dt><dd>Lien public ou QR code, sans compte</dd></div>
        </dl>
      </div>""")

    # ── 2. Sommaire + avertissement ──────────────────────────
    P.append("""
      <div class="sec"><h2><b>—</b>Ce que contient cette notice</h2></div>
      <table>
        <tr><td>01</td><td>Qu'est-ce que le Smart Agent ? — le principe, les concepts, la garantie fondatrice</td></tr>
        <tr><td>02</td><td>Prise en main — de zéro à l'agent publié, en sept étapes</td></tr>
        <tr><td>03</td><td>Les documents illustrés — vos PDF, leurs planches, et pourquoi ils ne quittent pas votre poste</td></tr>
        <tr><td>04</td><td>Pour aller plus loin — savoir-être, multilingue, mode vocal, personnalisation</td></tr>
        <tr><td>05</td><td>Limites, crédits et bonnes pratiques</td></tr>
      </table>
      <div class="callout neutral">
        <div class="t">À propos de cette édition</div>
        <p>Cette notice décrit l'application telle que déployée en production à la date d'édition.
        Keystone OS est en beta jusqu'à septembre 2026 ; certaines limites de formule peuvent évoluer.
        Les nouveautés de cette édition sont signalées par la pastille <span class="new">nouveau</span>.</p>
      </div>""")

    # ── 3. Section 01 ────────────────────────────────────────
    P.append("""
      <div class="sec">
        <h2><b>01</b>Qu'est-ce que le Smart Agent ?</h2>
        <p class="kicker">Un chatbot généraliste invente — un horaire faux, un tarif imaginaire.
        Le Smart Agent est construit sur le principe inverse : il ne parle que de ce que vous lui
        avez appris et validé.</p>
      </div>
      <p>Le Smart Agent est votre <strong>jumeau numérique de savoir-faire</strong>. Vous le nourrissez
      avec votre connaissance métier (texte collé, page de votre site, fichier, ou interview guidée à
      l'oral), vous validez chaque fiche de savoir, puis vous le publiez par lien ou QR code. Vos
      visiteurs lui parlent sans créer de compte, à l'écrit ou à la voix, dans leur langue — il répond
      dans la même langue, en citant ses sources.</p>
      <p><strong>S'il ne sait pas, il le dit.</strong> Et la question rejoint automatiquement sa liste
      de travail (les « Trous ») pour que vous la combliez. C'est ce mécanisme qui fait progresser
      votre agent semaine après semaine, guidé par les vraies questions de vos clients.</p>
      <h3>Pour qui ?</h3>
      <p>Commerçant, agent immobilier, musée, concierge d'accueil, guide, service après-vente,
      artisan, organisme de formation — tout professionnel qui veut qu'une IA parle en son nom
      <strong>sans risque d'hallucination</strong>.</p>
      <div class="callout">
        <div class="t">▸ La garantie fondatrice</div>
        <p>L'agent répond <strong>uniquement</strong> depuis les fiches que vous avez validées. Hors de
        ce savoir, il préfère se taire plutôt qu'inventer — et le crédit IA de la question vous est
        <strong>rendu</strong>. Chaque réponse cite ses fiches sources, vérifiables d'un clic.</p>
      </div>
      """)

    # ── Le tableau des concepts occupe sa propre page : à neuf lignes,
    #    il débordait de 26 mm sous la prose de la section 01.
    P.append("""
      <h3 style="margin-top:0">Les concepts en une page</h3>
      <table>
        <tr><th>Concept</th><th>Ce que c'est</th></tr>
        <tr><td>Kortex<br>(le coffre)</td><td>La base de savoir de l'agent. Chaque agent a un <strong>coffre privé</strong> ; un <strong>dossier</strong> regroupe plusieurs agents et peut porter un <strong>coffre partagé</strong> (horaires, règles maison) que tous ses agents consultent.</td></tr>
        <tr><td>Fiches<br>(7 types)</td><td>Fait · Procédure · Question / Réponse · Cas vécu · Règle · Objection · Définition. Une fiche ne sert l'agent que <strong>validée</strong> — les brouillons sont inactifs.</td></tr>
        <tr><td>Avertissement</td><td>Sur une procédure, un champ réservé au <strong>danger</strong> : ce qui blesse, ce qui est irréversible, ce qui est formellement interdit. Il s'affiche en rouge partout, y compris sous les réponses de l'agent.<span class="new">nouveau</span></td></tr>
        <tr><td>Planches</td><td>L'image d'une page de document, rattachée à une fiche. Sur un manuel technique, la photo montre ce que le texte ne dit pas.<span class="new">nouveau</span></td></tr>
        <tr><td>Persona</td><td>Le caractère de l'agent : rôle, mission, ton, style, interdits, objectif (informer / conseiller / vendre), posture, message d'accueil, phrases de repli.</td></tr>
        <tr><td>Packs métier</td><td>6 kits prêts à relire (Vendeur, Agent immobilier, Gardien de musée, Concierge, Guide, Conseiller SAV) : 8-9 fiches méthode + questions d'interview curées.</td></tr>
        <tr><td>Trous</td><td>Les questions auxquelles l'agent n'a pas su répondre — chez vous ou face au public. Dédupliquées, comptées, à combler par interview guidée.</td></tr>
        <tr><td>Publication</td><td>Un lien public <code>/a/&lt;votre-agent&gt;</code> + un QR code. Le visiteur ne voit jamais vos fiches ni vos sources — seulement le nom, le métier et les réponses.</td></tr>
        <tr><td>À revérifier le…</td><td>Date optionnelle sur une fiche : échue, la fiche est mise en <strong>quarantaine</strong> automatiquement (retirée du service, réactivable après relecture).</td></tr>
      </table>""")

    # ── 4. Section 02, étapes 1-2 ────────────────────────────
    P.append(f"""
      <div class="sec">
        <h2><b>02</b>Prise en main — de zéro à l'agent publié</h2>
        <p class="kicker">Sept étapes, dans l'ordre où vous les vivrez. Les libellés en surbrillance
        sont ceux de l'interface réelle.</p>
      </div>
      <div class="step"><div class="step-n">1</div><div class="step-b">
        <h3>Créer l'agent</h3>
        <p>Sur l'écran <span class="ui">Mes agents</span>, touchez <span class="ui">Nouvel agent</span>
        et choisissez un gabarit métier — il pré-remplit rôle, style et objectif, tout reste modifiable.
        Le bouton <span class="ui">Nouveau dossier</span> permet de regrouper des agents (par
        établissement, par équipe) et d'ouvrir un coffre partagé entre eux.</p>
      </div></div>
      <figure>
        <img src="{ASSETS['cap1']}" alt="Écran Mes agents">
        <figcaption>L'écran « Mes agents » : dossiers, badges « En ligne » / « En pause », et compteur
        de questions à combler sur chaque carte.</figcaption>
      </figure>
      <div class="step"><div class="step-n">2</div><div class="step-b">
        <h3>Nourrir le coffre (onglet <span class="ui">Savoir</span>)</h3>
        <p>Trois voies, cumulables :</p>
        <ul>
          <li><span class="ui">Démarrer avec un pack métier</span> — installe les fiches du pack en
          brouillon. Relisez-les, remplacez les mentions <span class="ui">[À compléter]</span> par vos
          vraies informations, puis <span class="ui">Tout valider</span> (les fiches encore incomplètes
          sont automatiquement écartées de la validation).</li>
          <li><span class="ui">Répondre aux questions du métier</span> — l'interview guidée : vous
          répondez à l'oral (dictée) ou au clavier, l'IA structure vos réponses en fiches proposées à
          votre validation.</li>
          <li><span class="ui">Nourrir le coffre</span> — collez du texte, indiquez l'adresse d'une page
          de votre site, ou déposez un fichier. Un document volumineux est découpé en <strong>lots</strong>
          que vous relisez l'un après l'autre, avec une barre de progression : vous pouvez vous arrêter
          et reprendre plus tard. Le nombre de lots et le coût en crédits vous sont annoncés
          <strong>avant</strong> de lancer quoi que ce soit.<span class="new">nouveau</span></li>
        </ul>
      </div></div>""")

    # ── 5. Capture savoir + étapes 3-4 ───────────────────────
    P.append(f"""
      <figure>
        <img src="{ASSETS['cap2']}" alt="Onglet Savoir">
        <figcaption>L'onglet Savoir : fiches typées avec statuts (Validée · Brouillon), filtres par type,
        bandeau de pack « Tout valider » et recherche naturelle du coffre.</figcaption>
      </figure>
      <div class="step"><div class="step-n">3</div><div class="step-b">
        <h3>Valider — le geste qui compte</h3>
        <p>Seules les fiches validées servent l'agent. C'est votre signature : en validant, vous
        certifiez l'information. Une fiche corrigée est prise en compte dès la seconde suivante.</p>
      </div></div>
      <div class="step"><div class="step-n">4</div><div class="step-b">
        <h3>Tester (onglet <span class="ui">Tester</span>)</h3>
        <p>Le bac à sable : posez vos questions, vérifiez les réponses. Chaque réponse porte des
        pastilles <span class="ui">[1] [2]</span> cliquables vers les fiches utilisées. Épinglez vos
        questions importantes en <span class="ui">Tests étalons</span> (« doit répondre » / « doit
        ignorer ») et rejouez-les en un clic après chaque changement — un score de santé en % vous dit
        si tout tient. Les tests étalons sont gratuits.</p>
      </div></div>
      <div class="callout neutral">
        <div class="t">Sur un import volumineux</div>
        <p>Chaque fiche proposée porte une pastille <strong>Fort · Moyen · Faible</strong> qui estime son
        utilité pour répondre aux questions, et les plus utiles passent en premier. Rien n'est filtré ni
        rejeté automatiquement : c'est une aide au tri, vous restez seul juge.</p>
      </div>""")

    # ── 6. Capture tester + étape 5 ──────────────────────────
    P.append(f"""
      <figure>
        <img src="{ASSETS['cap3']}" alt="Onglet Tester">
        <figcaption>L'onglet Tester : le bac à sable avec le message d'accueil de l'agent, et les Tests
        étalons (« doit répondre » / « doit ignorer ») rejouables en un clic.</figcaption>
      </figure>
      <div class="step"><div class="step-n">5</div><div class="step-b">
        <h3>Combler les trous (onglet <span class="ui">Trous</span>)</h3>
        <p>Chaque question restée sans réponse y atterrit — les reformulations d'une même question se
        cumulent. <span class="ui">Démarrer l'interview</span> les comble une par une, les plus demandées
        d'abord. En fin d'interview, <span class="ui">Explorer d'autres questions</span> demande à l'IA
        d'anticiper ce qu'on ne vous a pas encore demandé (1 crédit).</p>
      </div></div>""")

    # ── Capture « Trous » + étape 6 ──────────────────────────
    P.append(f"""
      <figure>
        <img src="{ASSETS['cap4']}" alt="Onglet Trous">
        <figcaption>L'onglet Trous : chaque question comptée (7×, 3×…), les plus demandées en tête,
        bouton « Démarrer l'interview ».</figcaption>
      </figure>
      <div class="step"><div class="step-n">6</div><div class="step-b">
        <h3>Publier (onglet <span class="ui">Réglages</span>, section <span class="ui">Partager</span>)</h3>
        <p><span class="ui">Publier cet agent</span> crée le lien public. <span class="ui">Afficher le QR</span>
        pour l'imprimer tel quel, ou <span class="ui">Designer le QR</span> pour ouvrir Smart Dynamic QR
        pré-rempli (QR au design personnalisé, avec statistiques de scan). Le bloc
        <span class="ui">Réglages du lien</span> fixe un plafond de questions par jour et une date
        d'expiration. <span class="ui">Dépublier</span> coupe le lien et le QR immédiatement.</p>
      </div></div>""")

    # ── Capture « Réglages » + étape 7 ───────────────────────
    P.append(f"""
      <figure>
        <img src="{ASSETS['cap5']}" alt="Réglages de l'agent">
        <figcaption>Les Réglages : la persona de l'agent — nom, rôle incarné, mission, ton, langue,
        style, interdits.</figcaption>
      </figure>
      <div class="step"><div class="step-n">7</div><div class="step-b">
        <h3>Côté visiteur — il n'a rien à installer</h3>
        <p>Il scanne ou clique, et discute : réponse en streaming à l'écrit, lecture à voix haute en
        option, mode conversation vocale façon assistant moderne (il parle, l'agent répond à voix haute,
        le micro se rouvre seul). À l'écrit, la langue est détectée automatiquement (FR·EN·ES·DE) ; en
        vocal, des pilules de langue font le choix. Des cartes-questions cliquables (avec photos) guident
        les premiers pas.</p>
      </div></div>""")

    # ── 8. Capture publique + section 03 (planches) ──────────
    P.append(f"""
      <figure>
        <img src="{ASSETS['cap6']}" alt="Page publique">
        <figcaption>La page publique côté visiteur : message d'accueil, champ « Posez-nous vos questions »,
        micro (dictée) et bouton du mode conversation vocale.</figcaption>
      </figure>
      <div class="sec">
        <h2><b>03</b>Les documents illustrés<span class="new">nouveau</span></h2>
        <p class="kicker">Sur un manuel technique, une procédure de sécurité ou un mode d'emploi,
        l'image porte souvent ce que le texte ne dit pas. Vos PDF entrent désormais en entier —
        et ils ne quittent pas votre poste.</p>
      </div>
      <h3>Votre PDF est lu sur votre appareil</h3>
      <p>Quand vous déposez un PDF, Keystone le lit <strong>sur votre poste</strong>. Le fichier
      lui-même n'est jamais envoyé : seuls le texte et les images de pages que vous retenez sont
      transmis. Deux conséquences concrètes : <strong>il n'y a plus de limite de taille</strong>
      (un manuel de plusieurs centaines de mégaoctets passe, alors qu'il était refusé), et la lecture
      elle-même <strong>ne consomme aucun crédit</strong>.</p>
      <h3>Les planches</h3>
      <p>Chaque page du document vous propose sa <strong>planche</strong> — l'image de la page telle
      qu'imprimée, schémas et photos compris. Pendant la relecture, vous la rattachez d'un clic aux
      fiches de votre choix, et vous décochez celles dont vous ne voulez pas. Le poids exact de ce qui
      va être envoyé s'affiche avant que vous validiez.</p>
      """)

    # ── La capture de la relecture avec planches ─────────────
    P.append(f"""
      <figure style="margin-top:0">
        <img src="{ASSETS['cap7']}" alt="Relecture d'un lot avec les planches">
        <figcaption>La relecture d'un lot : sous chaque fiche proposée, les planches des pages dont elle
        provient. Celles en surbrillance sont rattachées à cette fiche — un clic les attache ou les
        détache. En bas à gauche, le poids exact de ce qui partira de votre poste si vous validez.</figcaption>
      </figure>
      <div class="callout neutral">
        <div class="t">Pourquoi la page entière, et pas la photo découpée</div>
        <p>Les planches d'un manuel sont composites : photos, tracés, flèches, étiquettes numérotées.
        Extraire les seules photos rendrait des silhouettes détourées et perdrait le sens. La page
        entière conserve la légende avec le geste.</p>
      </div>
      """)

    # ── Suite de la section 03 : renvois + avertissement ─────
    P.append("""
      <h3 style="margin-top:0">Les renvois « Photo 2 » sont conservés</h3>
      <p>Quand une procédure dit « pivotez le pied d'appui — Photo 2 », la mention reste à sa place dans
      l'étape, et l'agent affiche la planche correspondante sous sa réponse. Le geste décrit et l'image
      qui le montre ne sont plus séparés.</p>
      <h3>Le champ « Avertissement » ne sert qu'au danger</h3>
      <p>Sur une fiche de type <strong>Procédure</strong>, le champ d'avertissement est réservé à ce qui
      blesse, à ce qui est irréversible et à ce qui est formellement interdit. Les avantages et les
      justifications, qui s'y glissaient parfois, partent désormais là où ils doivent aller.</p>
      <p>Un avertissement s'affiche <strong>à son propre niveau, en rouge</strong> — dans la fiche, dans
      la liste du coffre et sous les réponses de l'agent, où il est repris <strong>mot pour mot</strong>
      depuis votre fiche.</p>
      <div class="callout warn">
        <div class="t">▸ Pourquoi c'est un point de sécurité, pas de confort</div>
        <p>Un champ de danger qui contient aussi des bénéfices finit par ne plus être lu — et le jour où
        il porte un vrai risque, il passe inaperçu. C'est la raison pour laquelle ce champ est isolé
        visuellement partout où il apparaît, et transmis sans reformulation.</p>
      </div>
      <div class="sec">
        <h2><b>04</b>Pour aller plus loin</h2>
      </div>
      <h4>Savoir-être intégré</h4>
      <p>Tous les agents partagent un socle de bonnes manières : réponses courtes et sobres, accueil des
      émotions, question de clarification quand la demande est ambiguë, pas de radotage dans les
      relances. Un « bonjour » ou un « merci » reçoit une réponse chaleureuse instantanée — sans
      consommer de crédit.</p>
      <h4>Multilingue, en vrai</h4>
      <p>Votre coffre reste rédigé en français ; la recherche est multilingue. L'agent répond ancré sur
      vos fiches en français, anglais, espagnol ou allemand, avec une voix neuronale par langue (exécutée
      dans le navigateur du visiteur, gratuite). L'accueil et les titres des cartes peuvent être traduits
      par langue dans les Réglages, avec repli automatique sur la langue native.</p>
      <h4>Mode conversation vocale</h4>
      <p>Sur la page publique, un bouton dédié ouvre la conversation à la voix. À la première utilisation,
      un écran de préparation télécharge la voix (~60 Mo, puis en cache) avec une progression et trois
      conseils. Le fonctionnement est en alternance stricte : le micro n'est jamais ouvert pendant que
      l'agent parle ; toucher l'orbe interrompt ou reprend.</p>""")

    # ── 10. Personnaliser + suivre + section 05 ──────────────
    P.append("""
      <h4>Personnaliser la page publique</h4>
      <p>Couleur du dégradé, image en filigrane et son opacité, nom personnalisé du lien, titre en
      pastille par carte-question, couleur des éléments interactifs — tout se règle dans l'onglet
      <span class="ui">Réglages</span>. L'IA peut vous proposer un message d'accueil
      (<span class="ui">Proposer un accueil avec l'IA</span>) et des variantes de phrases de repli.</p>
      <h4>Suivre l'activité</h4>
      <p>Le compteur du lien affiche « X questions aujourd'hui · Y au total ». Le badge doré sur la carte
      de l'agent annonce « N questions à combler · X cette semaine ». Pour des statistiques de scan
      détaillées (heures, jours, appareils), passez par le QR designé dans Smart Dynamic QR.</p>
      <div class="sec">
        <h2><b>05</b>Limites, crédits et bonnes pratiques</h2>
        <p class="kicker">Ce que l'application ne fait pas, ce qu'elle consomme, et comment en tirer le
        meilleur.</p>
      </div>
      <h4>Le périmètre, honnêtement</h4>
      <ul>
        <li>L'agent ne répond que depuis les fiches validées (coffre privé + coffre partagé du dossier).
        Il ne fait pas de recherche web, ne prend pas de rendez-vous, ne capture pas de coordonnées.</li>
        <li>Le back-office est en français ; seule la surface visiteur est multilingue.</li>
        <li>La dictée et le mode vocal ne sont pas disponibles sur Firefox (fonction absente du
        navigateur) ; privilégiez Safari, Chrome ou Edge.</li>
        <li>Un PDF <strong>scanné en images</strong>, sans couche texte, ne peut pas alimenter le coffre :
        les planches seules ne suffisent pas, il faut du texte. L'application vous prévient avant de
        consommer le moindre crédit.<span class="new">nouveau</span></li>
        <li>Les planches d'un import interrompu ne sont pas rechargées si vous fermez l'onglet : elles
        vivaient sur votre poste. Le texte, lui, est conservé 7 jours.<span class="new">nouveau</span></li>
      </ul>
      <h4>Crédits IA</h4>
      <table>
        <tr><th>Consomme 1 crédit</th><th>Gratuit</th></tr>
        <tr>
          <td style="font-weight:400;width:50%">Une question posée (par vous ou un visiteur) ; une
          extraction de fiches — <strong>par lot</strong> sur un document découpé ;
          « Explorer d'autres questions ». Crédit rendu si l'agent ne peut pas répondre.</td>
          <td style="font-weight:400">Lecture vocale, dictée, tests étalons, tours sociaux
          (bonjour/merci), suggestions d'accueil et de repli par l'IA, <strong>lecture d'un PDF sur votre
          poste</strong> et préparation des planches.</td>
        </tr>
      </table>
      <div class="callout">
        <div class="t">▸ Vos crédits sont protégés face au public</div>
        <p>Garde-fous automatiques : 50 questions par jour et par appareil visiteur, plafond quotidien par
        lien (500 par défaut, réglable), date d'expiration optionnelle, et dépublication instantanée. Un
        visiteur ne peut pas épuiser vos crédits.</p>
      </div>""")

    # ── 11. RGPD + réflexes ──────────────────────────────────
    P.append("""
      <h4>Données &amp; RGPD</h4>
      <ul>
        <li>Les questions des visiteurs ne sont pas rattachées à leur identité et sont effacées après
        90 jours ; la session n'est pas conservée après fermeture de l'onglet.</li>
        <li>Le visiteur ne voit jamais vos fiches, vos sources ni votre coffre.</li>
        <li>Vos documents PDF ne sont pas téléversés : ils sont lus sur votre appareil. Seuls le texte et
        les planches que vous retenez sont transmis.<span class="new">nouveau</span></li>
        <li>Si vos planches contiennent des personnes reconnaissables, assurez-vous de disposer de leur
        consentement : ce sont des données personnelles.<span class="new">nouveau</span></li>
      </ul>
      <h4>Les six réflexes qui font un bon agent</h4>
      <ol>
        <li>Remplacez tous les <span class="ui">[crochets]</span> des packs avant de valider.</li>
        <li>Rejouez les tests étalons après chaque changement de persona ou grosse mise à jour du
        coffre.</li>
        <li>Traitez les Trous chaque semaine, les plus demandés d'abord — c'est votre feuille de route
        dictée par vos vrais clients.</li>
        <li>Posez une date « À revérifier le… » sur tout ce qui périme (tarifs, horaires saisonniers) —
        la quarantaine automatique fera le reste.</li>
        <li>Sur un document illustré, n'attachez pas la même planche à toutes les fiches d'un lot : une
        planche par objet pédagogique se relit bien mieux.</li>
        <li>Corrigez à chaud : une fiche modifiée sert l'agent dès la seconde suivante.</li>
      </ol>
      <div class="callout neutral">
        <div class="t">Le goulot, dit franchement</div>
        <p>Sur un gros document, la machine va vite — c'est votre relecture qui prend le temps. Un manuel
        de 200 pages reste 200 pages à relire. Prévoyez-le, et avancez chapitre par chapitre plutôt que
        d'un seul tenant : rien n'est perdu entre deux sessions.</p>
      </div>
      <p class="colophon" style="margin-top:8mm;padding-top:4mm;border-top:1px solid #e6e9ef">
      Protein Studio — Keystone OS · Notice Smart Agent, édition du """ + EDITION + """.
      Application réservée à la formule Max pendant la beta (jusqu'à septembre 2026). Un agent de
      démonstration est accessible depuis le pad (bouton <span class="ui">Démo</span>).
      Raccourcis : Échap = fermer · Entrée = envoyer · Maj+Entrée = nouvelle ligne.</p>""")

    total = len(P)
    body = "".join(page(inner, i + 1, total, "cover" if i == 0 else "")
                   for i, inner in enumerate(P))
    return ('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
            '<title>Notice Smart Agent — Keystone OS</title>'
            f'<style>{CSS}</style></head><body>{body}</body></html>')

if __name__ == "__main__":
    html = build()
    pathlib.Path("NOTICE_SMART_AGENT.html").write_text(html, encoding="utf-8")
    print("HTML écrit —", len(html) // 1024, "Ko")
