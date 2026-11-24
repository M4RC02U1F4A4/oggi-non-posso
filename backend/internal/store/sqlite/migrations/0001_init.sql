-- First schema. Plain SQL that PostgreSQL accepts as well: text keys,
-- integer unix timestamps (seconds), dates as YYYY-MM-DD text.

CREATE TABLE events (
    id                 TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    organiser_key_hash TEXT NOT NULL,
    version            BIGINT NOT NULL,
    last_day           TEXT NOT NULL,
    created_at         BIGINT NOT NULL,
    closed_at          BIGINT
);

CREATE INDEX events_last_day_idx ON events (last_day);

CREATE TABLE candidates (
    event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    slot     TEXT NOT NULL,
    PRIMARY KEY (event_id, day, slot)
);

-- join_order is the position in the joining order inside the event: the
-- order participants are listed in. created_at has a resolution of one
-- second and can not give it.
CREATE TABLE participants (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    name_key   TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    organiser  BOOLEAN NOT NULL,
    join_order INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE (event_id, name_key),
    UNIQUE (event_id, join_order)
);

-- An absence is always on a candidate pair of the participant's event.
CREATE TABLE absences (
    participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    event_id       TEXT NOT NULL,
    day            TEXT NOT NULL,
    slot           TEXT NOT NULL,
    PRIMARY KEY (participant_id, day, slot),
    FOREIGN KEY (event_id, day, slot) REFERENCES candidates (event_id, day, slot) ON DELETE CASCADE
);

CREATE INDEX absences_candidate_idx ON absences (event_id, day, slot);
