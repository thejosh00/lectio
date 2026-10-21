/**
 * Opening the database, and the schema it holds.
 *
 * One SQLite file per instance, `$LECTIO_DIR/lectio.db`. The server is the only
 * long-lived writer, but `lectio token` opens the same file from another process while
 * it runs, so the file is in WAL mode with a busy timeout.
 *
 * Migrations are a numbered list applied in order and recorded in `user_version`.
 * Append to the list; never edit an entry that has shipped.
 */
import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const DB_FILE = 'lectio.db';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE tokens   (token TEXT PRIMARY KEY, actor TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, created TEXT NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE subjects (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    goal            TEXT NOT NULL DEFAULT '',
    level           TEXT NOT NULL,
    minutes_per_day INTEGER NOT NULL DEFAULT 15,
    days            TEXT NOT NULL DEFAULT 'daily',
    note            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL,
    added           TEXT NOT NULL,
    changed         TEXT NOT NULL
  );

  CREATE TABLE concepts (
    id          TEXT PRIMARY KEY,
    subject_id  TEXT NOT NULL REFERENCES subjects(id),
    key         TEXT NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    prereqs     TEXT NOT NULL DEFAULT '[]',
    position    INTEGER NOT NULL,
    status      TEXT NOT NULL,
    introduced  TEXT,
    added       TEXT NOT NULL,
    changed     TEXT NOT NULL,
    UNIQUE (subject_id, key)
  );

  CREATE TABLE concept_memory (
    concept_id   TEXT PRIMARY KEY REFERENCES concepts(id),
    stability    REAL NOT NULL,
    difficulty   REAL NOT NULL,
    reps         INTEGER NOT NULL,
    lapses       INTEGER NOT NULL,
    last_review  TEXT NOT NULL,
    due          TEXT NOT NULL
  );

  CREATE TABLE agent_runs (
    id        TEXT PRIMARY KEY,
    actor     TEXT NOT NULL,
    started   TEXT NOT NULL,
    finished  TEXT,
    outcome   TEXT,
    made      TEXT NOT NULL DEFAULT '{}',
    retro     INTEGER NOT NULL DEFAULT 0,
    summary   TEXT NOT NULL DEFAULT '',
    -- Beyond the plan's schema: the contract version the run started under, so the
    -- context can say when a shipped change has given the tutor something new to read.
    contract_version TEXT
  );

  CREATE TABLE lessons (
    id                TEXT PRIMARY KEY,
    subject_id        TEXT NOT NULL REFERENCES subjects(id),
    day               TEXT NOT NULL,
    title             TEXT NOT NULL,
    objectives        TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    rationale         TEXT NOT NULL,
    hypothesis        TEXT,
    verdict           TEXT,
    sources           TEXT NOT NULL DEFAULT '[]',
    run_id            TEXT REFERENCES agent_runs(id),
    added_by          TEXT NOT NULL,
    state             TEXT NOT NULL,
    added             TEXT NOT NULL,
    opened            TEXT,
    finished          TEXT,
    active_seconds    INTEGER NOT NULL DEFAULT 0,
    version           INTEGER NOT NULL DEFAULT 1,
    UNIQUE (subject_id, day)
  );

  CREATE TABLE lesson_concepts (
    lesson_id   TEXT NOT NULL REFERENCES lessons(id),
    concept_id  TEXT NOT NULL REFERENCES concepts(id),
    role        TEXT NOT NULL,
    PRIMARY KEY (lesson_id, concept_id)
  );

  CREATE TABLE blocks (
    id           TEXT PRIMARY KEY,
    lesson_id    TEXT NOT NULL REFERENCES lessons(id),
    position     INTEGER NOT NULL,
    type         TEXT NOT NULL,
    approach     TEXT NOT NULL,
    concepts     TEXT NOT NULL DEFAULT '[]',
    body         TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    seen_seconds INTEGER NOT NULL DEFAULT 0,
    interactions INTEGER NOT NULL DEFAULT 0,
    completed    INTEGER NOT NULL DEFAULT 0,
    errors       INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
  );
  CREATE INDEX blocks_by_lesson ON blocks(lesson_id, position);

  CREATE TABLE assets (
    id        TEXT PRIMARY KEY,
    mime      TEXT NOT NULL,
    bytes     INTEGER NOT NULL,
    added_by  TEXT NOT NULL,
    added     TEXT NOT NULL
  );

  CREATE TABLE questions (
    id           TEXT PRIMARY KEY,
    subject_id   TEXT NOT NULL REFERENCES subjects(id),
    lesson_id    TEXT REFERENCES lessons(id),
    type         TEXT NOT NULL,
    aim          TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    body         TEXT NOT NULL,
    explanation  TEXT NOT NULL,
    hints        TEXT NOT NULL DEFAULT '[]',
    difficulty   INTEGER NOT NULL,
    variant_of   TEXT REFERENCES questions(id),
    run_id       TEXT REFERENCES agent_runs(id),
    added_by     TEXT NOT NULL,
    status       TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    added        TEXT NOT NULL,
    changed      TEXT NOT NULL
  );
  CREATE INDEX questions_by_subject ON questions(subject_id, status);

  CREATE TABLE question_concepts (
    question_id TEXT NOT NULL REFERENCES questions(id),
    concept_id  TEXT NOT NULL REFERENCES concepts(id),
    PRIMARY KEY (question_id, concept_id)
  );
  CREATE INDEX question_concepts_by_concept ON question_concepts(concept_id);

  CREATE TABLE quizzes (
    id          TEXT PRIMARY KEY,
    subject_id  TEXT NOT NULL REFERENCES subjects(id),
    day         TEXT NOT NULL,
    kind        TEXT NOT NULL,
    lesson_id   TEXT REFERENCES lessons(id),
    rationale   TEXT NOT NULL DEFAULT '',
    run_id      TEXT REFERENCES agent_runs(id),
    added_by    TEXT NOT NULL,
    state       TEXT NOT NULL,
    added       TEXT NOT NULL,
    opened      TEXT,
    finished    TEXT
  );
  CREATE UNIQUE INDEX quizzes_one_daily ON quizzes(subject_id, day) WHERE kind IN ('daily', 'placement');

  CREATE TABLE quiz_items (
    quiz_id     TEXT NOT NULL REFERENCES quizzes(id),
    position    INTEGER NOT NULL,
    question_id TEXT NOT NULL REFERENCES questions(id),
    role        TEXT NOT NULL,
    PRIMARY KEY (quiz_id, position)
  );

  CREATE TABLE attempts (
    id                TEXT PRIMARY KEY,
    question_id       TEXT NOT NULL REFERENCES questions(id),
    question_version  INTEGER NOT NULL,
    context           TEXT NOT NULL,
    lesson_id         TEXT REFERENCES lessons(id),
    quiz_id           TEXT REFERENCES quizzes(id),
    role              TEXT,
    attempt_no        INTEGER NOT NULL,
    answer            TEXT NOT NULL,
    shown_order       TEXT,
    score             REAL,
    graded_by         TEXT,
    confidence        TEXT NOT NULL,
    hints_used        INTEGER NOT NULL DEFAULT 0,
    seconds           INTEGER NOT NULL,
    misconception     TEXT,
    gap_hours         REAL,
    counts_for_memory INTEGER NOT NULL,
    agent_score       REAL,
    agent_note        TEXT,
    void              INTEGER NOT NULL DEFAULT 0,
    at                TEXT NOT NULL
  );
  CREATE INDEX attempts_by_question ON attempts(question_id, at);
  CREATE INDEX attempts_by_quiz ON attempts(quiz_id);
  CREATE INDEX attempts_by_time ON attempts(at);

  CREATE TABLE feedback (
    id          TEXT PRIMARY KEY,
    target      TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    actor       TEXT NOT NULL,
    at          TEXT NOT NULL,
    reply       TEXT,
    resolved    TEXT,
    replied_at  TEXT
  );
  CREATE INDEX feedback_by_target ON feedback(target, target_id);
  CREATE INDEX feedback_by_time ON feedback(at);

  CREATE TABLE note_versions (
    scope    TEXT NOT NULL,
    version  INTEGER NOT NULL,
    body     TEXT NOT NULL,
    actor    TEXT NOT NULL,
    note     TEXT NOT NULL DEFAULT '',
    at       TEXT NOT NULL,
    PRIMARY KEY (scope, version)
  );

  CREATE TABLE proposals (
    id            TEXT PRIMARY KEY,
    number        INTEGER NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    area          TEXT NOT NULL,
    problem       TEXT NOT NULL,
    change        TEXT NOT NULL,
    success       TEXT NOT NULL,
    evidence      TEXT NOT NULL DEFAULT '[]',
    support       INTEGER NOT NULL DEFAULT 1,
    protected     INTEGER NOT NULL DEFAULT 0,
    priority      TEXT NOT NULL DEFAULT 'normal',
    status        TEXT NOT NULL,
    proposed_by   TEXT NOT NULL,
    run_id        TEXT REFERENCES agent_runs(id),
    branch        TEXT,
    commit_sha    TEXT,
    shipped_at    TEXT,
    outcome       TEXT,
    outcome_note  TEXT,
    added         TEXT NOT NULL,
    changed       TEXT NOT NULL,
    -- Beyond the plan's schema: whether the learner acknowledged, on approval, that it may
    -- touch protected paths. A protected-area proposal can't be approved without it.
    acknowledged  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE proposal_comments (
    id           TEXT PRIMARY KEY,
    proposal_id  TEXT NOT NULL REFERENCES proposals(id),
    actor        TEXT NOT NULL,
    kind         TEXT NOT NULL,
    body         TEXT NOT NULL,
    at           TEXT NOT NULL
  );
  CREATE INDEX proposal_comments_by_proposal ON proposal_comments(proposal_id, at);

  CREATE TABLE events (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    change    TEXT NOT NULL
  );

  -- Beyond the plan's schema: small facts the app keeps about itself, such as when the
  -- learner last looked at the tutor's replies and which commit the server runs.
  CREATE TABLE marks (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export interface OpenOptions {
  busyTimeoutMs?: number;
}

/** Open (creating if need be) and bring the schema up to date. `:memory:` works for tests. */
export function openDatabase(path: string, options: OpenOptions = {}): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
  const db = new Database(path, {create: true, strict: true});
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Database): void {
  const current = (db.query('PRAGMA user_version').get() as {user_version: number}).user_version;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    }).immediate();
  }
}

export function getMark(db: Database, key: string): string | undefined {
  return (db.query('SELECT value FROM marks WHERE key = ?').get(key) as {value: string} | null)?.value;
}

export function setMark(db: Database, key: string, value: string): void {
  db.query('INSERT INTO marks (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
