// The Italian catalogue: every text a person reads, including accessible
// names. A second language is a second file with the same keys.
//
// A value is a string, or plural forms chosen by the `count` variable
// (`zero` when given and count is 0, `one` for 1, `other` for the rest).
// `{name}` marks a variable. The wording never assumes the reader's gender.

export interface PluralForms {
  zero?: string
  one: string
  other: string
}

export type Message = string | PluralForms

export const it = {
  'app.title': 'Oggi non posso',
  'app.home': 'Oggi non posso, crea un evento',
  'app.pageTitle': '{title} · Oggi non posso',

  // Slots: on a wide chip, inside a sentence.
  'slot.long.morning': 'Mattina',
  'slot.long.lunch': 'Pranzo',
  'slot.long.afternoon': 'Pomeriggio',
  'slot.long.dinner': 'Cena',
  'slot.long.after_dinner': 'Dopocena',
  // For a narrow chip, five to a phone's row.
  'slot.medium.morning': 'Mattina',
  'slot.medium.lunch': 'Pranzo',
  'slot.medium.afternoon': 'Pom.',
  'slot.medium.dinner': 'Cena',
  'slot.medium.after_dinner': 'Dopo',
  'slot.inline.morning': 'mattina',
  'slot.inline.lunch': 'pranzo',
  'slot.inline.afternoon': 'pomeriggio',
  'slot.inline.dinner': 'cena',
  'slot.inline.after_dinner': 'dopocena',
  'slot.allDay': 'tutto il giorno',

  // Weekdays, 0 = Monday.
  'weekday.long.0': 'lunedì',
  'weekday.long.1': 'martedì',
  'weekday.long.2': 'mercoledì',
  'weekday.long.3': 'giovedì',
  'weekday.long.4': 'venerdì',
  'weekday.long.5': 'sabato',
  'weekday.long.6': 'domenica',
  'weekday.short.0': 'lun',
  'weekday.short.1': 'mar',
  'weekday.short.2': 'mer',
  'weekday.short.3': 'gio',
  'weekday.short.4': 'ven',
  'weekday.short.5': 'sab',
  'weekday.short.6': 'dom',

  'month.long.1': 'gennaio',
  'month.long.2': 'febbraio',
  'month.long.3': 'marzo',
  'month.long.4': 'aprile',
  'month.long.5': 'maggio',
  'month.long.6': 'giugno',
  'month.long.7': 'luglio',
  'month.long.8': 'agosto',
  'month.long.9': 'settembre',
  'month.long.10': 'ottobre',
  'month.long.11': 'novembre',
  'month.long.12': 'dicembre',
  'month.short.1': 'gen',
  'month.short.2': 'feb',
  'month.short.3': 'mar',
  'month.short.4': 'apr',
  'month.short.5': 'mag',
  'month.short.6': 'giu',
  'month.short.7': 'lug',
  'month.short.8': 'ago',
  'month.short.9': 'set',
  'month.short.10': 'ott',
  'month.short.11': 'nov',
  'month.short.12': 'dic',

  // Dates.
  'date.dayLong': '{weekday} {day}',
  'date.dayLongMonth': '{weekday} {day} {month}',
  'date.dayShort': '{weekday} {day}',
  'date.dayShortMonth': '{weekday} {day} {month}',
  'date.full': '{weekday} {day} {month} {year}',
  'date.month': '{month}',
  'date.monthYear': '{month} {year}',

  // Lists and small numbers written as words.
  'list.separator': ', ',
  'list.last': '{head} e {last}',
  'number.2': 'due',
  'number.3': 'tre',
  'number.4': 'quattro',
  'number.5': 'cinque',
  'number.6': 'sei',
  'number.7': 'sette',
  'number.8': 'otto',
  'number.9': 'nove',
  'number.10': 'dieci',

  'common.cancel': 'Annulla',
  'common.loading': 'Un attimo…',
  'common.retry': 'Riprova',

  // One text for every error code of the API.
  'error.invalid_request': 'La richiesta non è arrivata bene. Ricarica la pagina e riprova.',
  'error.unauthorized': 'Da questo browser non si può più fare. Ricarica la pagina.',
  'error.not_found': 'Questo evento non c’è più.',
  'error.event_closed': 'La votazione è chiusa.',
  'error.name_taken': 'C’è già qualcuno con questo nome. Scrivine uno diverso, magari con l’iniziale del cognome.',
  'error.too_many_participants': 'In questo evento non c’è più posto: troppe persone hanno già risposto.',
  'error.cannot_remove_organiser': 'Chi organizza non si può togliere.',
  'error.payload_too_large': 'Troppa roba in una volta sola. Togli qualche giorno e riprova.',
  'error.validation_failed': 'C’è qualcosa che non va in quello che hai scritto. Controlla e riprova.',
  'error.rate_limited': 'Troppe richieste: riprova più tardi.',
  'error.rateLimitedWait': {
    one: 'Troppe richieste: riprova tra un minuto.',
    other: 'Troppe richieste: riprova tra {count} minuti.',
  },
  'error.internal': 'Qualcosa è andato storto dalla nostra parte. Riprova tra poco.',
  'error.network': 'Non c’è collegamento. Controlla la connessione e riprova.',

  // The event page while the voting is open.
  'event.by': '{title} · organizza {name}',
  'event.byYou': '{title} · organizzi tu',
  'event.visitor.by': '{name} cerca una data',
  'event.visitor.text': {
    one: 'Ha già risposto una persona. Scrivi il tuo nome e segna quando {not} puoi.',
    other: 'Hanno già risposto in {count}. Scrivi il tuo nome e segna quando {not} puoi.',
  },
  // The question of the page, with "not" set apart: it is the word to notice.
  'mark.question': 'Quando {not} puoi, {name}?',
  'mark.not': 'non',
  'mark.text': 'Tocca i momenti in cui non ci sei. Quelli che lasci così vogliono dire che puoi.',
  'event.loadFailed': 'L’evento non si carica',
  'event.saveFailed': 'Non salvato. {reason}',
  'event.organiserLinkInvalid': 'Questo link per organizzare non vale per questo evento.',
  'event.removed': 'Chi organizza ha tolto il tuo nome: per segnare di nuovo, scrivilo ancora.',

  // Everyone who joined has answered, whether they marked anything or not.
  'people.title': { one: 'Ha risposto una persona', other: 'Hanno risposto in {count}' },
  'people.you': 'tu',
  'people.organiser': 'organizza',
  'people.youOrganiser': 'tu, organizzi',
  'people.slots': { zero: 'nessuna fascia', one: '1 fascia', other: '{count} fasce' },
  'people.slotsSaved': { zero: 'nessuna fascia', one: '1 fascia, salvata', other: '{count} fasce, salvate' },
  'people.slotsSaving': 'salvo…',
  'people.slotsFailed': 'non salvato',
  'people.marking': 'sta segnando',
  'people.markingNames': { one: '{names} sta segnando', other: '{names} stanno segnando' },
  'people.remove': 'Togli',
  'people.removeLabel': 'Togli {name}',
  'people.removeConfirm': 'Togliere {name}? Spariscono anche le sue fasce.',
  'people.removeYes': 'Sì, togli',

  'table.label': 'Giorni e fasce',
  // Under a slot: how many people can not make it.
  'cell.count': '{count} no',
  'cell.aria.off': '{day}, {slot}: non in programma',
  'cell.aria.mine': '{day}, {slot}: non puoi',
  'cell.aria.mineOthers': {
    one: '{day}, {slot}: non puoi. Non può nemmeno {names}',
    other: '{day}, {slot}: non puoi. Non possono nemmeno {names}',
  },
  'cell.aria.free': '{day}, {slot}: puoi',
  'cell.aria.freeOthers': {
    one: '{day}, {slot}: puoi. Non può {names}',
    other: '{day}, {slot}: puoi. Non possono {names}',
  },
  'cell.aria.readFree': '{day}, {slot}: ci siete tutti',
  'cell.aria.readMissing': {
    one: '{day}, {slot}: non può {names}',
    other: '{day}, {slot}: non possono {names}',
  },
  'day.aria.markAll': '{day}: segna tutto il giorno',
  'day.aria.clearAll': '{day}: togli tutto il giorno',
  'peek.free': 'Ci siete tutti',
  'peek.onlyYou': 'Non puoi solo tu',
  'peek.missing': { one: 'Non può {names}', other: 'Non possono {names}' },

  'note.mark': 'Sotto ogni momento vedi quanti altri non possono: tienilo premuto per sapere chi.',
  'note.visitor': 'Per ora vedi solo quanti non possono: tocca un momento per sapere chi.',

  'bar.marked': { zero: 'Non hai segnato niente', one: 'Non puoi in {n} momento', other: 'Non puoi in {n} momenti' },
  'bar.status': '{marked} · {state}',
  'bar.saved': 'salvato',
  'bar.saving': 'salvo…',
  'bar.failed': 'non salvato',
  'bar.calendar': 'Vedi tutto il calendario',
  'bar.closedBy': 'chiusa da {name}',

  'join.title': 'Come ti chiami?',
  'join.placeholder': 'Il tuo nome',
  'join.submit': 'Entra e segna quando non puoi',
  'join.empty': 'Scrivi il tuo nome.',
  'join.tooLong': 'Il nome è troppo lungo: al massimo {max} caratteri.',

  'share.prompt': 'Manca qualcuno? Mandagli il link',
  'share.copy': 'Copia il link',
  'copy.done': 'Copiato',
  'copy.failedShort': 'Non copiato',
  'copy.failed': 'Copia non riuscita: seleziona il link e copialo a mano.',

  // The organiser's controls.
  'organiser.label': 'Per chi organizza',
  'organiser.close': 'Chiudi la votazione',
  'organiser.closeHelp':
    'Dopo la chiusura nessuno può più segnare e tutti vedono le alternative. La votazione si può sempre riaprire.',
  'organiser.closeConfirm': 'Chiudere la votazione adesso?',
  'organiser.closeYes': 'Sì, chiudi',
  'organiser.reopen': 'Riapri la votazione',
  'organiser.reopenHelp': 'Tutti possono segnare di nuovo. Le fasce già segnate restano.',
  'organiser.shareLink': 'Link per gli altri',
  'organiser.ownLink': 'Link solo tuo, per organizzare',
  'organiser.copy': 'Copia',
  'organiser.copyShare': 'Copia il link per gli altri',
  'organiser.copyOwn': 'Copia il link per organizzare',

  // The closed event.
  'result.status': {
    one: 'Votazione chiusa · ha risposto una persona',
    other: 'Votazione chiusa · hanno risposto in {count}',
  },
  'result.closedBy': '{name} ha chiuso.',
  'result.people': { one: 'Ha risposto {names}.', other: 'Hanno risposto {names}.' },
  'result.headline': {
    zero: 'Non c’è un momento per tutti',
    one: 'Ci siete tutti in un momento',
    other: 'Ci siete tutti in {word} momenti',
  },
  'result.free.title': 'Ci siete tutti',
  'result.tier.title': { one: 'Se manca una persona sola', other: 'Se mancano {word} persone' },
  'result.missing': { one: 'manca {names}', other: 'mancano {names}' },
  'result.missingYou': { one: 'manchi {names}', other: 'mancate {names}' },
  'result.calendar.title': 'Tutto il calendario',
  'result.calendar.note': 'Sotto ogni momento vedi quanti mancano: toccalo per sapere chi.',

  'notFound.event.title': 'Questo evento non c’è',
  'notFound.event.text':
    'Il link è sbagliato, oppure l’evento è scaduto: dopo un po’ dall’ultimo giorno gli eventi si cancellano da soli.',
  'notFound.page.title': 'Qui non c’è niente',
  'notFound.page.text': 'Questa pagina non esiste.',
  'notFound.cta': 'Crea un evento nuovo',

  // Creating an event.
  'create.title': 'Quando ci vediamo?',
  'create.tagline':
    'Scegli i giorni possibili e manda il link. Ognuno segna quando non può: quello che resta è la data buona.',
  'create.what': 'Cosa organizzi',
  'create.who': 'Come ti chiami',
  'create.days.title': 'Giorni possibili',
  'create.days.prev': 'Mese precedente',
  'create.days.next': 'Mese successivo',
  'create.days.past': '{day}: già passato',
  'create.days.tooFar': '{day}: oltre un anno da oggi',
  'create.days.count': { zero: 'Nessun giorno scelto', one: '1 giorno scelto', other: '{count} giorni scelti' },
  'create.days.full': 'Al massimo {max} giorni: togline uno per aggiungerne un altro.',
  'create.slots.title': 'Fasce della giornata',
  'create.slots.hint': 'tocca per togliere quelle che non servono',
  'create.perDay.title': 'Giorno per giorno',
  'create.perDay.hint': {
    zero: 'scegli prima i giorni',
    one: '1 giorno scelto, togli una fascia solo dove non ha senso',
    other: '{count} giorni scelti, togli una fascia solo dove non ha senso',
  },
  'create.perDay.more': 'Fasce diverse in un giorno?',
  'create.perDay.changed': {
    zero: 'nessun giorno cambiato',
    one: '1 giorno cambiato',
    other: '{count} giorni cambiati',
  },
  'create.perDay.empty': 'Scegli prima i giorni dal calendario.',
  'create.perDay.slot': '{day}, {slot}',
  'create.perDay.last': '{day}, {slot}: è l’unica fascia rimasta',
  'create.note': 'Niente account. Ti diamo un link da mandare agli altri e uno solo tuo per chiudere la votazione.',
  'create.submit': 'Crea e prendi il link',
  'create.submitting': 'Creo l’evento…',
  'create.error.title': 'Scrivi cosa organizzi.',
  'create.error.titleLong': 'Troppo lungo: al massimo {max} caratteri.',
  'create.error.name': 'Scrivi come ti chiami.',
  'create.error.nameLong': 'Troppo lungo: al massimo {max} caratteri.',
  'create.error.days': 'Scegli almeno un giorno dal calendario.',

  // Right after creating.
  'created.title': 'Fatto. Ora manda il link',
  'created.others.title': 'Per gli altri',
  'created.others.text': 'Mandalo nel gruppo. Chi lo apre scrive il nome e segna quando non può.',
  'created.others.copy': 'Copia il link',
  'created.others.share': 'Condividi',
  'created.shareText': '{title}: segna quando non puoi',
  'created.own.title': 'Solo per te',
  'created.own.text':
    'Con questo chiudi la votazione, anche da un altro telefono. Tienilo da parte e non mandarlo in giro.',
  'created.own.copy': 'Copia il link per organizzare',
  'created.own.masked': '{start}…{end}',
  'created.next.text':
    'Questo browser ti riconosce già come {name} e come chi organizza: puoi segnare subito le tue fasce.',
  'created.next.open': 'Apri l’evento e segna le tue',
} as const satisfies Record<string, Message>
