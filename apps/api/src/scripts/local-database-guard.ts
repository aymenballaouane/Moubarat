/* Garde commune aux scripts de démonstration qui EFFACENT du contenu avant de le reconstruire (demo:seed,
   demo:catalogue) : parfaitement sûrs sur la base locale de dev, catastrophiques si `DATABASE_URL` pointait
   un jour vers une vraie base hébergée. Seuls localhost/127.0.0.1/::1 passent sans rien demander ;
   `DEMO_SEED_FORCE_REMOTE=true` outrepasse explicitement, jamais un défaut. */
export function assertLocalDatabase(url: string, script: string): void {
  if (process.env.DEMO_SEED_FORCE_REMOTE === 'true') return;
  let host: string;
  try { host = new URL(url).hostname; }
  catch { throw new Error(`DATABASE_URL illisible : « ${url} ».`); }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!isLocal) {
    throw new Error(
      `${script} refusé : DATABASE_URL pointe vers « ${host} », pas une base locale. `
      + `Ce script EFFACE du contenu à chaque lancement — jamais sans le confirmer `
      + `explicitement en dehors d'une base locale. Pour continuer quand même, en connaissance de cause : `
      + `DEMO_SEED_FORCE_REMOTE=true pnpm ${script}`,
    );
  }
}
