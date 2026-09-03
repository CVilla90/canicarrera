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
    'action.fullscreen': 'Pantalla completa',
    'action.exitFullscreen': 'Salir de pantalla completa',
    'action.autoNext': 'Carrera automática',
    'action.autoNextOn': 'Carrera automática activada',
    'action.autoNextOff': 'Carrera automática desactivada',
    'action.autoNextIn': 'Siguiente en {seconds} s',

    'setup.title': 'Configurar carrera',
    'setup.note': 'Elige lo que quieras controlar. Las opciones al azar siguen pasando por la selección de las mejores carreras.',
    'setup.world': 'Mundo',
    'setup.track': 'Tipo de pista',
    'setup.music': 'Música',
    'setup.random': 'Al azar',
    'setup.available': 'Disponible',
    'setup.comingSoon': 'Próximamente',
    'setup.start': 'Iniciar carrera',
    'setup.world.surface': 'Mundos de superficie',
    'setup.world.orbit': 'Mundos orbitales',
    'setup.world.jungla': 'Jungla',
    'setup.world.desierto': 'Desierto',
    'setup.world.glaciar': 'Glaciar',
    'setup.world.neon': 'Neón',
    'setup.world.citrico': 'Cítrico',
    'setup.world.hielo': 'Órbita de hielo',
    'setup.world.magma': 'Magma',
    'setup.world.bruma': 'Bruma',
    'setup.world.arcade': 'Arcade',
    'setup.world.grandPrix': 'Grand Prix — inspirado en F1',
    'setup.track.descenso': 'Descenso — curvas largas y bajadas',
    'setup.track.helice': 'Hélice — espirales cerradas',
    'setup.track.guantelete': 'Guantelete — chicanas y rizos',
    'setup.track.acantilado': 'Acantilado — velocidad y grandes caídas',
    'setup.track.serpiente': 'Serpiente — horquillas encadenadas',
    'setup.music.arcade': 'Arcade',
    'setup.music.electronic': 'Electrónica',
    'setup.music.orchestral': 'Orquestal épica',
    'setup.music.latin': 'Ritmos latinos',

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
    'export.budget': '¿Cuánto quieres esperar?',
    'export.resolution': 'Resolución',
    'export.visual': 'Calidad visual',
    'export.auto': 'Elegido para tu equipo',
    'export.backToAuto': 'Volver a lo automático',
    'export.manual': 'Ajustes manuales',
    'export.presetLocked': 'Tu GPU no admite este nivel.',
    'export.motionBlur': 'con desenfoque de movimiento',
    'export.supersampled': 'súper-muestreado',
    'export.audio': 'Incluir sonido en el video',
    'export.audioUnsupported': 'Tu navegador no puede codificar audio, así que el video saldrá sin sonido.',
    'export.renderingAudio': 'Componiendo la música',
    'export.silent': 'sin sonido',

    'audio.label': 'Sonido',
    'audio.on': 'Activar el sonido',
    'audio.off': 'Silenciar',
    'audio.mix': 'Mezcla',
    'audio.genre': 'Género',
    'audio.genre.dnb': 'Drum & bass',
    'audio.genre.kids': 'Infantil',
    'audio.genre.rock': 'Rock',
    'audio.master': 'General',
    'audio.music': 'Música',
    'audio.sfx': 'Efectos',
    'audio.crowd': 'Público',
    'audio.note': 'La música se compone para esta carrera: la sección principal entra justo al apagarse las luces.',

    'error.title': 'Algo salió mal',
    'error.race': 'No pudimos crear la carrera. Inténtalo otra vez.',
    'error.export': 'La exportación falló: {detail}',
    'error.noWebgl':
      'Tu navegador no puede dibujar en 3D. Prueba con Chrome, Edge o Safari actualizados.',
    'error.retry': 'Reintentar',
    'error.contextLost': 'Tu dispositivo se quedó sin memoria de video y tuvimos que soltar el dibujo 3D. Reintentando…',
    'error.contextLostAction': 'Recargar la página',
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
    'action.fullscreen': 'Full screen',
    'action.exitFullscreen': 'Exit full screen',
    'action.autoNext': 'Auto next race',
    'action.autoNextOn': 'Auto next race on',
    'action.autoNextOff': 'Auto next race off',
    'action.autoNextIn': 'Next race in {seconds}s',

    'setup.title': 'Set up race',
    'setup.note': 'Choose what you want to control. Random choices are still curated for the best races.',
    'setup.world': 'World',
    'setup.track': 'Track type',
    'setup.music': 'Music',
    'setup.random': 'Random',
    'setup.available': 'Available',
    'setup.comingSoon': 'Coming soon',
    'setup.start': 'Start race',
    'setup.world.surface': 'Surface worlds',
    'setup.world.orbit': 'Orbit worlds',
    'setup.world.jungla': 'Jungle',
    'setup.world.desierto': 'Desert',
    'setup.world.glaciar': 'Glacier',
    'setup.world.neon': 'Neon',
    'setup.world.citrico': 'Citrus',
    'setup.world.hielo': 'Ice orbit',
    'setup.world.magma': 'Magma',
    'setup.world.bruma': 'Mist',
    'setup.world.arcade': 'Arcade',
    'setup.world.grandPrix': 'Grand Prix — F1-inspired',
    'setup.track.descenso': 'Descent — long curves and drops',
    'setup.track.helice': 'Helix — tight spirals',
    'setup.track.guantelete': 'Gauntlet — chicanes and rollers',
    'setup.track.acantilado': 'Cliffside — speed and big drops',
    'setup.track.serpiente': 'Serpent — chained hairpins',
    'setup.music.arcade': 'Arcade',
    'setup.music.electronic': 'Electronic',
    'setup.music.orchestral': 'Epic orchestral',
    'setup.music.latin': 'Latin rhythms',

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
    'export.budget': 'How long will you wait?',
    'export.resolution': 'Resolution',
    'export.visual': 'Visual quality',
    'export.auto': 'Chosen for your machine',
    'export.backToAuto': 'Back to automatic',
    'export.manual': 'Manual settings',
    'export.presetLocked': 'Your GPU does not support this level.',
    'export.motionBlur': 'with motion blur',
    'export.supersampled': 'supersampled',
    'export.audio': 'Include sound in the video',
    'export.audioUnsupported': 'Your browser cannot encode audio, so the video will be silent.',
    'export.renderingAudio': 'Composing the music',
    'export.silent': 'silent',

    'audio.label': 'Sound',
    'audio.on': 'Turn sound on',
    'audio.off': 'Mute',
    'audio.mix': 'Mix',
    'audio.genre': 'Genre',
    'audio.genre.dnb': 'Drum & bass',
    'audio.genre.kids': "Kids' music",
    'audio.genre.rock': 'Rock',
    'audio.master': 'Master',
    'audio.music': 'Music',
    'audio.sfx': 'Effects',
    'audio.crowd': 'Crowd',
    'audio.note': 'The music is written for this race: its main section starts exactly at lights-out.',

    'error.title': 'Something went wrong',
    'error.race': "We couldn't create the race. Try again.",
    'error.export': 'The export failed: {detail}',
    'error.noWebgl': 'Your browser cannot draw in 3D. Try an up-to-date Chrome, Edge or Safari.',
    'error.retry': 'Retry',
    'error.contextLost': 'Your device ran out of video memory and we had to let go of the 3D canvas. Trying again…',
    'error.contextLostAction': 'Reload the page',
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
