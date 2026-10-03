require('dotenv').config();

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const databasePath = process.env.DATABASE_PATH
	? path.resolve(__dirname, process.env.DATABASE_PATH)
	: path.join(__dirname, 'data', 'study-coach.sqlite');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma('foreign_keys = ON');

db.exec(`
	CREATE TABLE IF NOT EXISTS subjects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS topics (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subject_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'not_started',
		mastery INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS mistakes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		topic_id INTEGER,
		question TEXT NOT NULL,
		student_answer TEXT,
		correct_answer TEXT NOT NULL,
		explanation TEXT,
		resolved INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS exams (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subject_id INTEGER,
		title TEXT NOT NULL,
		total_questions INTEGER NOT NULL,
		correct_answers INTEGER NOT NULL DEFAULT 0,
		score INTEGER NOT NULL DEFAULT 0,
		duration_minutes INTEGER,
		completed_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS exam_questions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		exam_id INTEGER NOT NULL,
		topic_id INTEGER,
		question TEXT NOT NULL,
		question_type TEXT NOT NULL,
		options TEXT,
		correct_answer TEXT,
		student_answer TEXT,
		is_correct INTEGER,
		explanation TEXT,
		FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS revision_tasks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		topic_id INTEGER,
		title TEXT NOT NULL,
		scheduled_date TEXT NOT NULL,
		duration_minutes INTEGER NOT NULL DEFAULT 30,
		task_type TEXT NOT NULL,
		completed INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS study_sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		topic_id INTEGER,
		session_type TEXT NOT NULL,
		duration_minutes INTEGER NOT NULL DEFAULT 0,
		score INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS study_materials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		topic_id INTEGER,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		material_id INTEGER NOT NULL UNIQUE,
		title TEXT NOT NULL,
		overview TEXT NOT NULL,
		sections_json TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (material_id) REFERENCES study_materials(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS flashcard_sets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		material_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (material_id) REFERENCES study_materials(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS flashcards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		set_id INTEGER NOT NULL,
		front TEXT NOT NULL,
		back TEXT NOT NULL,
		FOREIGN KEY (set_id) REFERENCES flashcard_sets(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS practice_questions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		material_id INTEGER NOT NULL,
		topic_id INTEGER,
		question TEXT NOT NULL,
		question_type TEXT NOT NULL,
		options TEXT,
		correct_answer TEXT NOT NULL,
		explanation TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (material_id) REFERENCES study_materials(id) ON DELETE CASCADE,
		FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS question_attempts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		question_id INTEGER NOT NULL,
		student_answer TEXT NOT NULL,
		is_correct INTEGER NOT NULL,
		feedback TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (question_id) REFERENCES practice_questions(id) ON DELETE CASCADE
	);
`);

const statements = {
	createSubject: db.prepare('INSERT INTO subjects (name) VALUES (?)'),
	getSubjects: db.prepare('SELECT * FROM subjects ORDER BY id'),
	updateSubject: db.prepare('UPDATE subjects SET name = ? WHERE id = ?'),
	deleteSubject: db.prepare('DELETE FROM subjects WHERE id = ?'),
	createTopic: db.prepare('INSERT INTO topics (subject_id, name) VALUES (?, ?)'),
	getTopicsBySubject: db.prepare('SELECT * FROM topics WHERE subject_id = ? ORDER BY id'),
	getTopicById: db.prepare('SELECT * FROM topics WHERE id = ?'),
	updateTopic: db.prepare('UPDATE topics SET name = ? WHERE id = ?'),
	deleteTopic: db.prepare('DELETE FROM topics WHERE id = ?'),
	updateTopicStatus: db.prepare('UPDATE topics SET status = ? WHERE id = ?'),
	updateTopicMastery: db.prepare('UPDATE topics SET mastery = ? WHERE id = ?'),
	updateExamQuestion: db.prepare('UPDATE exam_questions SET student_answer = @studentAnswer, is_correct = @isCorrect WHERE id = @questionId'),
	completeExam: db.prepare('UPDATE exams SET correct_answers = @correctAnswers, score = @score, completed_at = CURRENT_TIMESTAMP WHERE id = @examId'),
	createStudyMaterial: db.prepare('INSERT INTO study_materials (topic_id, title, content) VALUES (@topicId, @title, @content)'),
	getStudyMaterials: db.prepare(`
		SELECT materials.*, topics.name AS topic_name
		FROM study_materials AS materials
		LEFT JOIN topics ON topics.id = materials.topic_id
		ORDER BY materials.id DESC
	`),
	getStudyMaterialById: db.prepare('SELECT * FROM study_materials WHERE id = ?'),
	deleteStudyMaterial: db.prepare('DELETE FROM study_materials WHERE id = ?'),
	createNote: db.prepare('INSERT INTO notes (material_id, title, overview, sections_json) VALUES (@materialId, @title, @overview, @sectionsJson)'),
	getNotes: db.prepare(`
		SELECT notes.*, study_materials.topic_id, study_materials.title AS source_title,
			study_materials.content AS source_content, study_materials.created_at AS material_created_at
		FROM notes
		JOIN study_materials ON study_materials.id = notes.material_id
		ORDER BY notes.id DESC
	`),
	getNoteById: db.prepare(`
		SELECT notes.*, study_materials.topic_id, study_materials.title AS source_title,
			study_materials.content AS source_content, study_materials.created_at AS material_created_at
		FROM notes
		JOIN study_materials ON study_materials.id = notes.material_id
		WHERE notes.id = ?
	`),
	createFlashcardSet: db.prepare('INSERT INTO flashcard_sets (material_id, title) VALUES (?, ?)'),
	getFlashcardSets: db.prepare('SELECT * FROM flashcard_sets ORDER BY id DESC'),
	getFlashcardSetById: db.prepare('SELECT * FROM flashcard_sets WHERE id = ?'),
	deleteFlashcardSet: db.prepare('DELETE FROM flashcard_sets WHERE id = ?'),
	createFlashcard: db.prepare('INSERT INTO flashcards (set_id, front, back) VALUES (?, ?, ?)'),
	getFlashcards: db.prepare('SELECT * FROM flashcards WHERE set_id = ? ORDER BY id'),
	createPracticeQuestion: db.prepare(`
		INSERT INTO practice_questions (material_id, topic_id, question, question_type, options, correct_answer, explanation)
		VALUES (@materialId, @topicId, @question, @questionType, @options, @correctAnswer, @explanation)
	`),
	getPracticeQuestions: db.prepare('SELECT * FROM practice_questions WHERE material_id = ? ORDER BY id'),
	getPracticeQuestionById: db.prepare('SELECT * FROM practice_questions WHERE id = ?'),
	createQuestionAttempt: db.prepare('INSERT INTO question_attempts (question_id, student_answer, is_correct, feedback) VALUES (@questionId, @studentAnswer, @isCorrect, @feedback)'),
	getQuestionAttempts: db.prepare('SELECT * FROM question_attempts WHERE question_id = ? ORDER BY id DESC'),
	createMistake: db.prepare(`
		INSERT INTO mistakes (topic_id, question, student_answer, correct_answer, explanation)
		VALUES (@topicId, @question, @studentAnswer, @correctAnswer, @explanation)
	`),
	getMistakes: db.prepare('SELECT * FROM mistakes ORDER BY id DESC'),
	deleteMistake: db.prepare('DELETE FROM mistakes WHERE id = ?'),
	markMistakeResolved: db.prepare('UPDATE mistakes SET resolved = 1 WHERE id = ?'),
	createExam: db.prepare(`
		INSERT INTO exams (subject_id, title, total_questions, correct_answers, score, duration_minutes, completed_at)
		VALUES (@subjectId, @title, @totalQuestions, @correctAnswers, @score, @durationMinutes, @completedAt)
	`),
	getExams: db.prepare('SELECT * FROM exams ORDER BY id DESC'),
	getExamById: db.prepare('SELECT * FROM exams WHERE id = ?'),
	deleteExam: db.prepare('DELETE FROM exams WHERE id = ?'),
	createExamQuestion: db.prepare(`
		INSERT INTO exam_questions (exam_id, topic_id, question, question_type, options, correct_answer, student_answer, is_correct, explanation)
		VALUES (@examId, @topicId, @question, @questionType, @options, @correctAnswer, @studentAnswer, @isCorrect, @explanation)
	`),
	getExamQuestions: db.prepare('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY id'),
	createRevisionTask: db.prepare(`
		INSERT INTO revision_tasks (topic_id, title, scheduled_date, duration_minutes, task_type)
		VALUES (@topicId, @title, @scheduledDate, @durationMinutes, @taskType)
	`),
	getRevisionTasks: db.prepare('SELECT * FROM revision_tasks ORDER BY scheduled_date, id'),
	deleteRevisionTask: db.prepare('DELETE FROM revision_tasks WHERE id = ?'),
	completeRevisionTask: db.prepare('UPDATE revision_tasks SET completed = 1 WHERE id = ?'),
	createStudySession: db.prepare(`
		INSERT INTO study_sessions (topic_id, session_type, duration_minutes, score)
		VALUES (@topicId, @sessionType, @durationMinutes, @score)
	`),
	getStudySessions: db.prepare('SELECT * FROM study_sessions ORDER BY id DESC')
};

function createSubject(name) {
	return statements.createSubject.run(name).lastInsertRowid;
}

function getSubjects() {
	return statements.getSubjects.all();
}

function updateSubject(subjectId, name) {
	return statements.updateSubject.run(name, subjectId).changes;
}

function deleteSubject(subjectId) {
	return statements.deleteSubject.run(subjectId).changes;
}

function createTopic(subjectId, name) {
	return statements.createTopic.run(subjectId, name).lastInsertRowid;
}

function getTopicsBySubject(subjectId) {
	return statements.getTopicsBySubject.all(subjectId);
}

function getTopicById(topicId) {
	return statements.getTopicById.get(topicId);
}

function updateTopic(topicId, name) {
	return statements.updateTopic.run(name, topicId).changes;
}

function deleteTopic(topicId) {
	return statements.deleteTopic.run(topicId).changes;
}

function updateTopicStatus(topicId, status) {
	return statements.updateTopicStatus.run(status, topicId).changes;
}

function updateTopicMastery(topicId, mastery) {
	return statements.updateTopicMastery.run(mastery, topicId).changes;
}

function createStudyMaterial({ topicId = null, title, content }) {
	return statements.createStudyMaterial.run({ topicId, title, content }).lastInsertRowid;
}

function getStudyMaterials() {
	return statements.getStudyMaterials.all();
}

function getStudyMaterialById(materialId) {
	return statements.getStudyMaterialById.get(materialId);
}

function createNote({ materialId, title, overview, sections }) {
	return statements.createNote.run({ materialId, title, overview, sectionsJson: JSON.stringify(sections) }).lastInsertRowid;
}

function getNotes() {
	return statements.getNotes.all().map(note => ({ ...note, sections: JSON.parse(note.sections_json) }));
}

function getNoteById(noteId) {
	const note = statements.getNoteById.get(noteId);
	return note ? { ...note, sections: JSON.parse(note.sections_json) } : undefined;
}

function createFlashcardSet({ materialId, title, cards }) {
	const saveSet = db.transaction(() => {
		const setId = statements.createFlashcardSet.run(materialId, title).lastInsertRowid;
		for (const card of cards) {
			statements.createFlashcard.run(setId, card.front, card.back);
		}
		return setId;
	});

	return saveSet();
}

function getFlashcardSets() {
	return statements.getFlashcardSets.all();
}

function getFlashcardSetById(setId) {
	const set = statements.getFlashcardSetById.get(setId);
	return set ? { ...set, cards: statements.getFlashcards.all(setId) } : undefined;
}

function createPracticeQuestion({ materialId, topicId = null, question, questionType, options = null, correctAnswer, explanation }) {
	const optionsText = options === null || typeof options === 'string' ? options : JSON.stringify(options);
	return statements.createPracticeQuestion.run({ materialId, topicId, question, questionType, options: optionsText, correctAnswer, explanation }).lastInsertRowid;
}

function getPracticeQuestions(materialId) {
	return statements.getPracticeQuestions.all(materialId).map(question => ({
		...question,
		options: question.options ? JSON.parse(question.options) : null
	}));
}

function getPracticeQuestionById(questionId) {
	const question = statements.getPracticeQuestionById.get(questionId);
	return question ? { ...question, options: question.options ? JSON.parse(question.options) : null } : undefined;
}

function createQuestionAttempt({ questionId, studentAnswer, isCorrect, feedback = null }) {
	return statements.createQuestionAttempt.run({ questionId, studentAnswer, isCorrect: isCorrect ? 1 : 0, feedback }).lastInsertRowid;
}

function getQuestionAttempts(questionId) {
	return statements.getQuestionAttempts.all(questionId);
}

function createMistake({ topicId = null, question, studentAnswer = null, correctAnswer, explanation = null }) {
	return statements.createMistake.run({ topicId, question, studentAnswer, correctAnswer, explanation }).lastInsertRowid;
}

function getMistakes(filters = {}) {
	const conditions = [];
	const values = [];

	if (filters.topicId !== undefined) {
		conditions.push('mistakes.topic_id = ?');
		values.push(filters.topicId);
	}
	if (filters.subjectId !== undefined) {
		conditions.push('topics.subject_id = ?');
		values.push(filters.subjectId);
	}
	if (filters.resolved !== undefined) {
		conditions.push('mistakes.resolved = ?');
		values.push(filters.resolved ? 1 : 0);
	}

	const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
	return db.prepare(`
		SELECT mistakes.*
		FROM mistakes
		LEFT JOIN topics ON topics.id = mistakes.topic_id
		${whereClause}
		ORDER BY mistakes.id DESC
	`).all(...values);
}

function markMistakeResolved(mistakeId) {
	return statements.markMistakeResolved.run(mistakeId).changes;
}

function createExam({ subjectId = null, title, totalQuestions, correctAnswers = 0, score = 0, durationMinutes = null, completedAt = null }) {
	return statements.createExam.run({ subjectId, title, totalQuestions, correctAnswers, score, durationMinutes, completedAt }).lastInsertRowid;
}

function getExams() {
	return statements.getExams.all();
}

function getExamById(examId) {
	return statements.getExamById.get(examId);
}

function createExamQuestion({ examId, topicId = null, question, questionType, options = null, correctAnswer = null, studentAnswer = null, isCorrect = null, explanation = null }) {
	const optionsText = options === null || typeof options === 'string' ? options : JSON.stringify(options);
	return statements.createExamQuestion.run({ examId, topicId, question, questionType, options: optionsText, correctAnswer, studentAnswer, isCorrect, explanation }).lastInsertRowid;
}

function getExamQuestions(examId) {
	return statements.getExamQuestions.all(examId);
}

function saveExamQuestionAnswer({ questionId, studentAnswer, isCorrect }) {
	return statements.updateExamQuestion.run({ questionId, studentAnswer, isCorrect: isCorrect ? 1 : 0 }).changes;
}

function completeExam({ examId, correctAnswers, score }) {
	return statements.completeExam.run({ examId, correctAnswers, score }).changes;
}

function createRevisionTask({ topicId = null, title, scheduledDate, durationMinutes = 30, taskType }) {
	return statements.createRevisionTask.run({ topicId, title, scheduledDate, durationMinutes, taskType }).lastInsertRowid;
}

function getRevisionTasks() {
	return statements.getRevisionTasks.all();
}

function completeRevisionTask(taskId) {
	return statements.completeRevisionTask.run(taskId).changes;
}

function resetWorkspace() {
	const tables = [
		'question_attempts', 'practice_questions', 'flashcards', 'flashcard_sets', 'notes',
		'study_materials', 'exam_questions', 'exams', 'mistakes', 'revision_tasks',
		'study_sessions', 'topics', 'subjects'
	];
	const clearWorkspace = db.transaction(() => {
		for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
		db.exec('DELETE FROM sqlite_sequence');
	});
	clearWorkspace();
}

function createStudySession({ topicId = null, sessionType, durationMinutes = 0, score = null }) {
	return statements.createStudySession.run({ topicId, sessionType, durationMinutes, score }).lastInsertRowid;
}

function getStudySessions() {
	return statements.getStudySessions.all();
}

module.exports = {
	db,
	createSubject,
	getSubjects,
	updateSubject,
	deleteSubject,
	createTopic,
	getTopicsBySubject,
	getTopicById,
	updateTopic,
	deleteTopic,
	updateTopicStatus,
	updateTopicMastery,
	createStudyMaterial,
	getStudyMaterials,
	getStudyMaterialById,
	deleteStudyMaterial: id => statements.deleteStudyMaterial.run(id).changes,
	createNote,
	getNotes,
	getNoteById,
	createFlashcardSet,
	getFlashcardSets,
	getFlashcardSetById,
	deleteFlashcardSet: id => statements.deleteFlashcardSet.run(id).changes,
	createPracticeQuestion,
	getPracticeQuestions,
	getPracticeQuestionById,
	createQuestionAttempt,
	getQuestionAttempts,
	createMistake,
	getMistakes,
	deleteMistake: id => statements.deleteMistake.run(id).changes,
	markMistakeResolved,
	createExam,
	getExams,
	getExamById,
	deleteExam: id => statements.deleteExam.run(id).changes,
	createExamQuestion,
	getExamQuestions,
	saveExamQuestionAnswer,
	completeExam,
	createRevisionTask,
	getRevisionTasks,
	deleteRevisionTask: id => statements.deleteRevisionTask.run(id).changes,
	completeRevisionTask,
	resetWorkspace,
	createStudySession,
	getStudySessions
};