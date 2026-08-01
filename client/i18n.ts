/**
 * Spanish first, English available.
 *
 * Not a full i18n framework — a dictionary and a lookup. Adding a language is
 * adding a key here, and the type system makes a missing string a build error
 * rather than a blank label in production.
 */
export const STRINGS = {
  es: {
    'app.name': 'CANICARRERA',
    'app.tagline': 'Generador de carreras',
    'app.langToggle': 'EN',

    'action.new': 'Nueva carrera',
    'action.newShort': 'Nueva',
    'action.watch': 'Ver la carrera',
    'action.replay': 'Repetir',
    'action.export': 'Exportar MP4',
    'action.exporting': 'Exportando…',
    'action.cancel': 'Cancelar',
    'action.copyLink': 'Copiar enlace',
    'action.copied': 'Enlace copiado',
    'action.advanced': 'Opciones avanzadas',
    'action.remeasure': 'Volver a medir',
    'action.useSeed': 'Usar semilla',
    'action.random': 'Semilla al azar',
    'action.close': 'Cerrar',
    'action.skip': 'Saltar al final',

    'state.creating': 'Inventando la carrera',
    'state.curating': 'Eligiendo la mejor de {n}',
    'state.measuring': 'Midiendo tu equipo',
    'state.waking': 'Despertando el servidor',
    'state.offline': 'Sin servidor: la carrera se generó en tu equipo.',

    'hud.seed': 'Semilla',
    'hud.track': 'Trazado',
    'hud.section': 'Sector',
    'hud.clock': 'Tiempo',
    'hud.leader': 'Líder',
    'hud.gap': 'Ventaja',

    'lights.go': '¡FUERA!',

    'results.title': 'Clasificación final',
    'results.winner': 'Gana',
    'results.duration': 'Duración',
    'results.margin': 'Margen',
    'results.changes': 'Cambios de líder',
    'results.dnf': 'Sin terminar',

    'export.title': 'Exportar video',
    'export.recommended': 'recomendado para tu equipo',
    'export.frames': 'Cuadro {frame} de {total}',
    'export.eta': 'faltan ~{seconds}',
    'export.rate': '{fps} cuadros/s',
    'export.preparing': 'Preparando',
    'export.finishing': 'Cerrando el archivo',
    'export.done': 'Video listo',
    'export.doneDetail': '{frames} cuadros en {seconds} · {size}',
    'export.keepVisible': 'Deja esta pestaña visible mientras exporta.',
    'export.warmDevice': 'Puede calentar tu dispositivo',
    'export.measured': 'Medido en tu equipo: {fps} cuadros/s a 1080p',
    'export.notMeasured': 'Todavía sin medir',
    'export.cancelled': 'Exportación cancelada.',

    'error.title': 'Algo salió mal',
    'error.race': 'No pudimos crear la carrera. Inténtalo otra vez.',
    'error.export': 'La exportación falló: {detail}',
    'error.noWebgl':
      'Tu navegador no puede dibujar en 3D. Prueba con Chrome, Edge o Safari actualizados.',
    'error.retry': 'Reintentar',
  },
  en: {
    'app.name': 'CANICARRERA',
    'app.tagline': 'Marble race generator',
    'app.langToggle': 'ES',

    'action.new': 'New race',
    'action.newShort': 'New',
    'action.watch': 'Watch the race',
    'action.replay': 'Replay',
    'action.export': 'Export MP4',
    'action.exporting': 'Exporting…',
    'action.cancel': 'Cancel',
    'action.copyLink': 'Copy link',
    'action.copied': 'Link copied',
    'action.advanced': 'Advanced options',
    'action.remeasure': 'Measure again',
    'action.useSeed': 'Use seed',
    'action.random': 'Random seed',
    'action.close': 'Close',
    'action.skip': 'Skip to the end',

    'state.creating': 'Inventing the race',
    'state.curating': 'Picking the best of {n}',
    'state.measuring': 'Measuring your machine',
    'state.waking': 'Waking the server',
    'state.offline': 'No server: this race was generated on your machine.',

    'hud.seed': 'Seed',
    'hud.track': 'Track',
    'hud.section': 'Sector',
    'hud.clock': 'Time',
    'hud.leader': 'Leader',
    'hud.gap': 'Gap',

    'lights.go': 'GO!',

    'results.title': 'Final classification',
    'results.winner': 'Winner',
    'results.duration': 'Duration',
    'results.margin': 'Margin',
    'results.changes': 'Lead changes',
    'results.dnf': 'Did not finish',

    'export.title': 'Export video',
    'export.recommended': 'recommended for your machine',
    'export.frames': 'Frame {frame} of {total}',
    'export.eta': '~{seconds} left',
    'export.rate': '{fps} frames/s',
    'export.preparing': 'Preparing',
    'export.finishing': 'Closing the file',
    'export.done': 'Video ready',
    'export.doneDetail': '{frames} frames in {seconds} · {size}',
    'export.keepVisible': 'Keep this tab visible while it exports.',
    'export.warmDevice': 'May warm up your device',
    'export.measured': 'Measured on your machine: {fps} frames/s at 1080p',
    'export.notMeasured': 'Not measured yet',
    'export.cancelled': 'Export cancelled.',

    'error.title': 'Something went wrong',
    'error.race': "We couldn't create the race. Try again.",
    'error.export': 'The export failed: {detail}',
    'error.noWebgl': 'Your browser cannot draw in 3D. Try an up-to-date Chrome, Edge or Safari.',
    'error.retry': 'Retry',
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type StringKey = keyof (typeof STRINGS)['es'];

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

export function makeTranslate(lang: Lang): Translate {
  const table = STRINGS[lang] ?? STRINGS.es;
  return (key, vars) => {
    let value: string = table[key] ?? STRINGS.es[key] ?? key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return value;
  };
}

/**
 * Spanish-first means Spanish by default, not "Spanish if the browser asks for
 * it". The marbles are named in Spanish and the audience is Spanish-speaking;
 * English is one click away for everyone else, and the choice sticks.
 */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem('canicarrera.lang');
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    // Private browsing — fall through to the default.
  }
  return 'es';
}
