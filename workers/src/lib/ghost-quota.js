// Source UNIQUE du quota Ghost Writer par plan (appels/jour).
// Importe par l'enforcement (routes/ghostwriter.js) ET par l'affichage de la
// jauge Living Layer (routes/living-layer-board.js) → les deux ne peuvent plus
// deriver. null = illimite (ADMIN). 0 = plan inconnu (fail-closed).
export function quotaForPlan(plan) {
  const p = (plan || '').toUpperCase();
  if (p === 'DEMO')    return 1;
  if (p === 'STARTER') return 3;
  if (p === 'PRO')     return 10;
  if (p === 'MAX')     return 50;
  if (p === 'ADMIN')   return null;   // illimite
  return 0;                            // plan inconnu → bloque par defaut
}
