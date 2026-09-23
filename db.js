const Database = require('better-sqlite3');
const path = require('path');

const database = new Database(path.join(__dirname, 'study-coach.sqlite'));
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');

database.exec(`
  CREATE TABLE IF NOT EXISTS study_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    source_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    importance TEXT NOT NULL DEFAULT 'medium'
  );
  CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT 'medium',
    options_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS weak_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    topic TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    student_answer TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    feedback TEXT NOT NULL DEFAULT '',
    correction TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  database.prepare('ALTER TABLE questions ADD COLUMN options_json TEXT NOT NULL DEFAULT \'[]\'').run();
} catch (error) {
  if (!error.message.includes('duplicate column name')) throw error;
}

const saveStudySetTransaction = database.transaction((studySet, sourceName) => {
  const setResult = database.prepare('INSERT INTO study_sets (title, summary, source_name) VALUES (?, ?, ?)').run(
    studySet.title || 'Untitled study set',
    studySet.summary || '',
    sourceName || null,
  );
  const studySetId = Number(setResult.lastInsertRowid);
  const conceptInsert = database.prepare('INSERT INTO concepts (study_set_id, name, description, importance) VALUES (?, ?, ?, ?)');
  const flashcardInsert = database.prepare('INSERT INTO flashcards (study_set_id, front, back) VALUES (?, ?, ?)');
  const questionInsert = database.prepare('INSERT INTO questions (study_set_id, question, answer, explanation, difficulty, options_json) VALUES (?, ?, ?, ?, ?, ?)');
  const weakAreaInsert = database.prepare('INSERT INTO weak_areas (study_set_id, topic) VALUES (?, ?)');

  for (const concept of studySet.concepts || []) conceptInsert.run(studySetId, concept.name || 'Key concept', concept.description || '', concept.importance || 'medium');
  for (const card of studySet.flashcards || []) flashcardInsert.run(studySetId, card.front || 'Review this concept', card.back || card.description || '');
  for (const question of studySet.questions || []) {
    const options = Array.isArray(question.options) ? question.options.slice(0, 4) : [];
    const correctAnswer = question.answer || options[Number(question.correctOptionIndex)] || '';
    questionInsert.run(studySetId, question.question || 'Review this question', correctAnswer, question.explanation || '', question.difficulty || 'medium', JSON.stringify(options));
  }
  for (const area of studySet.weakAreas || []) weakAreaInsert.run(studySetId, typeof area === 'string' ? area : area.topic || area.name || area.description || 'Review this topic');
  return studySetId;
});

function saveStudySet(studySet, sourceName) {
  return saveStudySetTransaction(studySet, sourceName);
}

function getStudySet(id) {
  const studySet = database.prepare('SELECT id, title, summary, source_name AS sourceName, created_at AS createdAt FROM study_sets WHERE id = ?').get(id);
  if (!studySet) return null;
  studySet.concepts = database.prepare('SELECT name, description, importance FROM concepts WHERE study_set_id = ? ORDER BY id').all(id);
  studySet.flashcards = database.prepare('SELECT id, front, back FROM flashcards WHERE study_set_id = ? ORDER BY id').all(id);
  studySet.questions = database.prepare('SELECT id, question, answer, explanation, difficulty, options_json AS optionsJson FROM questions WHERE study_set_id = ? ORDER BY id').all(id).map((question) => ({
    ...question,
    options: JSON.parse(question.optionsJson || '[]'),
    optionsJson: undefined,
  }));
  studySet.weakAreas = database.prepare('SELECT topic FROM weak_areas WHERE study_set_id = ? ORDER BY id').all(id).map((area) => area.topic);
  return studySet;
}

function getRecentStudySets() {
  return database.prepare(`SELECT id, title, summary, source_name AS sourceName, created_at AS createdAt,
    (SELECT COUNT(*) FROM flashcards WHERE study_set_id = study_sets.id) AS flashcardCount,
    (SELECT COUNT(*) FROM questions WHERE study_set_id = study_sets.id) AS questionCount
    FROM study_sets ORDER BY created_at DESC, id DESC LIMIT 12`).all();
}

function deleteStudySet(id) {
  return database.prepare('DELETE FROM study_sets WHERE id = ?').run(id).changes > 0;
}

function saveEvaluation(studySetId, questionId, evaluation, studentAnswer) {
  database.prepare(`INSERT INTO evaluations
    (study_set_id, question_id, student_answer, correct, score, feedback, correction, next_step)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(studySetId, questionId, studentAnswer, evaluation.correct ? 1 : 0, evaluation.score || 0, evaluation.feedback || '', evaluation.correction || '', evaluation.nextStep || '');
}

module.exports = { deleteStudySet, getRecentStudySets, getStudySet, saveEvaluation, saveStudySet };
