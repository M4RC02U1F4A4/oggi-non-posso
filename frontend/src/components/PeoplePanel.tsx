import type { EventData, Participant } from '../api/types'
import type { SaveState } from '../hooks/useEvent'
import { t } from '../i18n'
import { countMarked } from '../lib/grid'
import '../styles/PeoplePanel.css'

interface PeoplePanelProps {
  event: EventData
  /** Participant ids that changed their marks a moment ago. */
  marking: Set<string>
  /** Whether the caller's own marks reached the server. */
  saveState: SaveState
}

function role(participant: Participant, me: string | null): string | null {
  const mine = participant.id === me
  if (mine && participant.organiser) return t('people.youOrganiser')
  if (mine) return t('people.you')
  return participant.organiser ? t('people.organiser') : null
}

/** Who is in, how many slots each one marked, and who is marking right now. */
export function PeoplePanel({ event, marking, saveState }: PeoplePanelProps) {
  return (
    <section className="people">
      <h2 className="people__title">{t('people.title', { count: event.participants.length })}</h2>
      <ul className="people__list">
        {event.participants.map((participant) => {
          const mine = participant.id === event.me
          const count = countMarked(event, participant.id)
          const tag = role(participant, event.me)
          return (
            <li className="people__row" key={participant.id}>
              <span className="people__who">
                {participant.name}
                {tag && <small>{tag}</small>}
              </span>
              {!mine && marking.has(participant.id) ? (
                <span className="tag-now">{t('people.marking')}</span>
              ) : (
                <span className="people__state">
                  {!mine
                    ? t('people.slots', { count })
                    : saveState === 'saving'
                      ? t('people.slotsSaving')
                      : saveState === 'failed'
                        ? t('people.slotsFailed')
                        : t('people.slotsSaved', { count })}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
