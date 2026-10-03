const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');

const databasePath = path.join(os.tmpdir(), `study-coach-test-${process.pid}.sqlite`);
process.env.DATABASE_PATH = databasePath;
process.env.GROQ_API_KEY = 'test-key-not-real';

const app = require('../server');
const database = require('../db');
let server;
let baseUrl;
let fetchMode = 'success';
let expectedApiKey = 'test-key-not-real';

function mockGroqFetch(url, options) {
	assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
	assert.equal(options.headers.Authorization, `Bearer ${expectedApiKey}`);
	const request = JSON.parse(options.body);
	assert.equal(request.model, 'openai/gpt-oss-120b');
	const prompt = request.messages[0].content;
	let content;

	if (fetchMode === 'failure') {
		return Promise.resolve(new Response(JSON.stringify({ error: { message: 'provider failure' } }), { status: 503 }));
	} else if (fetchMode === 'malformed') {
		return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'not valid JSON' } }] }), { status: 200 }));
	}
	if (prompt === 'Respond with exactly: Study Coach AI connection successful') {
		content = 'Study Coach AI connection successful';
	} else if (prompt.startsWith('Create accurate, student-friendly revision notes')) {
		content = prompt.includes('Title: Overview only')
			? JSON.stringify({ title: 'Overview only', summary: 'A concise but useful overview.' })
			: JSON.stringify({
			title: 'Motion',
			overview: 'Motion describes a change in position over time.',
			key_concepts: ['Displacement describes position change.'],
			definitions: [{ term: 'Velocity', definition: 'Rate of change of displacement.' }],
			detailed_explanation: '',
			examples: ['A moving car changes position.'],
			important_facts: [],
			common_confusions: [],
			quick_revision_points: ['Velocity includes direction.']
		});
	} else if (prompt.startsWith('Create exactly') && prompt.includes('useful study flashcards')) {
		const count = Number(prompt.match(/exactly (\d+) useful study flashcards/)[1]);
		content = JSON.stringify({ cards: Array.from({ length: count }, (_, index) => ({ front: `Question ${index + 1}`, back: `Answer ${index + 1}` })) });
	} else if (prompt.startsWith('Create exactly') && prompt.includes('practice questions')) {
		content = JSON.stringify({ questions: [
			{ question: 'What is 2 + 2?', question_type: 'multiple_choice', options: ['3', '4'], correct_answer: '4', explanation: 'Two plus two is four.' },
			{ question: 'What is velocity?', question_type: 'short_answer', options: null, correct_answer: 'Rate of change of displacement.', explanation: 'Velocity describes displacement per unit of time.' }
		] });
	} else if (prompt.startsWith('Evaluate the student')) {
		content = JSON.stringify({ is_correct: prompt.includes('Student answer: Rate of change of displacement.'), feedback: 'Velocity is displacement per unit of time.', correct_answer: 'Rate of change of displacement.' });
	} else if (prompt.startsWith('Evaluate all short answers fairly')) {
		const items = JSON.parse(prompt.slice(prompt.indexOf('Answers: ') + 9));
		content = JSON.stringify({ results: items.map(item => ({
			id: item.id,
			is_correct: item.student_answer === 'Rate of change of displacement.',
			feedback: item.student_answer === 'Rate of change of displacement.' ? 'Correct.' : 'Review the expected answer.'
		})) });
	} else if (prompt.startsWith('Create exactly') && prompt.includes('exam questions')) {
		content = JSON.stringify({ questions: [
			{ question: 'What is 2 + 2?', question_type: 'multiple_choice', options: ['3', '4'], correct_answer: '4', explanation: 'Two plus two is four.' },
			{ question: 'What is velocity?', question_type: 'short_answer', options: null, correct_answer: 'Rate of change of displacement.', explanation: 'Velocity describes displacement per unit of time.' }
		] });
	} else if (prompt.startsWith('Evaluate each student')) {
		const items = JSON.parse(prompt.slice(prompt.indexOf('Items: ') + 7));
		content = JSON.stringify({ results: items.map(item => ({
			id: item.id,
			is_correct: item.student_answer === 'Rate of change of displacement.',
			feedback: item.student_answer === 'Rate of change of displacement.' ? 'Correct.' : 'Review the definition of velocity.'
		})) });
	} else {
		throw new Error('Unexpected AI prompt in test.');
	}

	return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	}));
}

function request(route, { method = 'GET', body, headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const requestBody = body === undefined ? null : JSON.stringify(body);
		const request = http.request(`${baseUrl}${route}`, {
			method,
			headers: { ...(requestBody ? { 'Content-Type': 'application/json' } : {}), ...headers }
		}, response => {
			let responseBody = '';
			response.setEncoding('utf8');
			response.on('data', chunk => { responseBody += chunk; });
			response.on('end', () => {
				resolve({
					status: response.statusCode,
					body: responseBody ? JSON.parse(responseBody) : null
				});
			});
		});
		request.on('error', reject);
		if (requestBody) request.write(requestBody);
		request.end();
	});
}

before(async () => {
	global.fetch = mockGroqFetch;
	server = app.listen(0);
	await new Promise(resolve => server.once('listening', resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	if (server) await new Promise(resolve => server.close(resolve));
	database.db.close();
	for (const suffix of ['', '-shm', '-wal']) {
		try { fs.unlinkSync(databasePath + suffix); } catch {}
	}
});

test('Study Coach core API workflows', async () => {
	const health = await request('/api/health');
	assert.equal(health.status, 200);
	assert.deepEqual(health.body, { ok: true });

	expectedApiKey = 'browser-test-key';
	const aiTest = await request('/api/test-ai', { headers: { 'X-Groq-API-Key': expectedApiKey } });
	assert.equal(aiTest.status, 200);
	assert.deepEqual(aiTest.body, { ok: true, response: 'Study Coach AI connection successful' });
	expectedApiKey = 'test-key-not-real';

	const invalidSubject = await request('/api/subjects', { method: 'POST', body: {} });
	assert.equal(invalidSubject.status, 400);
	const createdSubject = await request('/api/subjects', { method: 'POST', body: { name: 'Physics' } });
	assert.equal(createdSubject.status, 201);
	const subjectId = createdSubject.body.id;
	const createdTopic = await request('/api/topics', { method: 'POST', body: { subjectId, name: 'Motion' } });
	assert.equal(createdTopic.status, 201);
	const topicId = createdTopic.body.id;
	const updatedTopic = await request(`/api/topics/${topicId}`, { method: 'PATCH', body: { status: 'in_progress' } });
	assert.equal(updatedTopic.body.status, 'in_progress');

	const emptyNotes = await request('/api/notes/generate', { method: 'POST', body: { material: '' } });
	assert.equal(emptyNotes.status, 400);
	const generatedNote = await request('/api/notes/generate', { method: 'POST', body: {
		title: 'Motion',
		material: 'Velocity is the rate of change of displacement.',
		topicId
	} });
	assert.equal(generatedNote.status, 201);
	assert.equal(generatedNote.body.sections.definitions[0].term, 'Velocity');
	assert.equal(generatedNote.body.topic_id, topicId);
	const noteId = generatedNote.body.id;
	const overviewOnly = await request('/api/notes/generate', { method: 'POST', body: { title: 'Overview only', material: 'A concise study source.' } });
	assert.equal(overviewOnly.status, 201);
	assert.equal(overviewOnly.body.overview, 'A concise but useful overview.');

	const generatedCards = await request('/api/flashcards/generate', { method: 'POST', body: { noteId, count: 2 } });
	assert.equal(generatedCards.status, 201);
	assert.equal(generatedCards.body.cards.length, 2);
	const savedCards = await request(`/api/flashcards/${generatedCards.body.id}`);
	assert.equal(savedCards.body.cards[0].front, 'Question 1');

	const generatedQuestions = await request('/api/questions/generate', { method: 'POST', body: { noteId, count: 2 } });
	assert.equal(generatedQuestions.status, 201);
	assert.equal(generatedQuestions.body.length, 2);
	assert.equal(Object.hasOwn(generatedQuestions.body[0], 'correct_answer'), false);
	const mcqId = generatedQuestions.body[0].id;
	const shortAnswerId = generatedQuestions.body[1].id;
	const wrongAnswer = await request(`/api/questions/${mcqId}/answer`, { method: 'POST', body: { answer: '3' } });
	assert.equal(wrongAnswer.body.isCorrect, false);
	const duplicateWrongAnswer = await request(`/api/questions/${mcqId}/answer`, { method: 'POST', body: { answer: '3' } });
	assert.equal(duplicateWrongAnswer.body.mistakeId, wrongAnswer.body.mistakeId);
	const correctAnswer = await request(`/api/questions/${shortAnswerId}/answer`, { method: 'POST', body: { answer: 'Rate of change of displacement.' } });
	assert.equal(correctAnswer.body.isCorrect, true);
	const unresolvedMistakes = await request('/api/mistakes?resolved=false');
	assert.equal(unresolvedMistakes.body.length, 1);
	const resolved = await request(`/api/mistakes/${wrongAnswer.body.mistakeId}`, { method: 'PATCH', body: { resolved: true } });
	assert.equal(resolved.body.resolved, true);

	const generatedExam = await request('/api/exams/generate', { method: 'POST', body: {
		topicIds: [topicId],
		count: 2,
		durationMinutes: 5,
		difficulty: 'medium'
	} });
	assert.equal(generatedExam.status, 201);
	assert.equal(generatedExam.body.questions.length, 2);
	assert.equal(Object.hasOwn(generatedExam.body.questions[0], 'correct_answer'), false);
	const examResult = await request(`/api/exams/${generatedExam.body.id}/submit`, { method: 'POST', body: { answers: [
		{ questionId: generatedExam.body.questions[0].id, answer: '4' },
		{ questionId: generatedExam.body.questions[1].id, answer: 'Rate of change of displacement.' }
	] } });
	assert.equal(examResult.body.score, 100);
	assert.equal(examResult.body.exam.completed_at !== null, true);
	assert.equal(examResult.body.topicResults[0].topicName, 'Motion');
	const typedTopicsExam = await request('/api/exams/generate', { method: 'POST', body: {
		subjectId,
		topicNames: ['Motion', 'Forces'],
		count: 2,
		durationMinutes: 5
	} });
	assert.equal(typedTopicsExam.status, 201);
	assert.equal(typedTopicsExam.body.subject_id, subjectId);
	assert.match(typedTopicsExam.body.title, /Motion, Forces/);
	const emptyTopicsExam = await request('/api/exams/generate', { method: 'POST', body: { topicNames: [] } });
	assert.equal(emptyTopicsExam.status, 400);

	const dashboard = await request('/api/dashboard');
	assert.equal(dashboard.body.subjects, 1);
	assert.equal(dashboard.body.questions_attempted, 5);
	assert.equal(dashboard.body.questions_correct, 3);
	assert.equal(dashboard.body.accuracy, 60);
	assert.equal(dashboard.body.unresolved_mistakes, 0);
	assert.equal(dashboard.body.topics[0].mastery, 60);
	const plan = await request('/api/revision/generate', { method: 'POST', body: {} });
	assert.equal(plan.status, 201);
	assert.equal(plan.body.length, 1);
	const completedTask = await request(`/api/revision/${plan.body[0].id}/complete`, { method: 'PATCH', body: {} });
	assert.equal(completedTask.body.completed, true);
	const sourcePlan = await request('/api/revision/generate', { method: 'POST', body: {
		noteIds: [generatedNote.body.id],
		examIds: [generatedExam.body.id],
		topicNames: ['Data structures']
	} });
	assert.equal(sourcePlan.status, 201);
	assert.ok(sourcePlan.body.some(task => task.title.startsWith('Review notes:')));
	assert.ok(sourcePlan.body.some(task => task.task_type === 'review_exam'));
	assert.ok(sourcePlan.body.some(task => task.title === 'Study Data structures'));
	const multiTopicPlan = await request('/api/revision/generate', { method: 'POST', body: {
		topicNames: Array.from({ length: 8 }, (_, index) => `Syllabus topic ${index + 1}`)
	} });
	assert.equal(multiTopicPlan.status, 201);
	assert.equal(multiTopicPlan.body.length, 8);
	assert.ok(new Set(multiTopicPlan.body.map(task => task.scheduled_date)).size <= 7);
	const missedExam = await request(`/api/exams/${typedTopicsExam.body.id}/submit`, { method: 'POST', body: { answers: [
		{ questionId: typedTopicsExam.body.questions[0].id, answer: '3' },
		{ questionId: typedTopicsExam.body.questions[1].id, answer: 'An incorrect response.' }
	] } });
	assert.equal(missedExam.body.score, 0);
	assert.ok(database.getMistakes({ resolved: false }).some(mistake => mistake.question === 'What is 2 + 2?'));
	const deletedFlashcards = await request(`/api/flashcards/${generatedCards.body.id}`, { method: 'DELETE' });
	assert.equal(deletedFlashcards.status, 204);
	assert.equal((await request(`/api/flashcards/${generatedCards.body.id}`)).status, 404);
	const deletedExam = await request(`/api/exams/${generatedExam.body.id}`, { method: 'DELETE' });
	assert.equal(deletedExam.status, 204);
	assert.equal((await request(`/api/exams/${generatedExam.body.id}`)).status, 404);
	const deletedRevisionTask = await request(`/api/revision/${sourcePlan.body[0].id}`, { method: 'DELETE' });
	assert.equal(deletedRevisionTask.status, 204);
	const deletedMistake = await request(`/api/mistakes/${wrongAnswer.body.mistakeId}`, { method: 'DELETE' });
	assert.equal(deletedMistake.status, 204);

	const standaloneNote = await request('/api/notes/generate', { method: 'POST', body: { title: 'Standalone', material: 'A standalone source.' } });
	assert.equal(standaloneNote.status, 201);
	assert.equal(standaloneNote.body.topic_id, null);

	const deleteSubject = await request(`/api/subjects/${subjectId}`, { method: 'DELETE' });
	assert.equal(deleteSubject.status, 204);
	assert.equal(database.db.prepare('SELECT topic_id FROM study_materials WHERE id = ?').get(generatedNote.body.material_id).topic_id, null);
	const deletedNote = await request(`/api/notes/${generatedNote.body.id}`, { method: 'DELETE' });
	assert.equal(deletedNote.status, 204);
	assert.equal(database.getStudyMaterialById(generatedNote.body.material_id), undefined);
	assert.equal(database.getPracticeQuestionById(mcqId), undefined);
	assert.equal((await request(`/api/notes/${generatedNote.body.id}`)).status, 404);
	assert.equal((await request(`/api/notes/${standaloneNote.body.id}`, { method: 'DELETE' })).status, 204);
	assert.equal((await request('/api/workspace', { method: 'DELETE' })).status, 204);
	assert.equal(database.getSubjects().length, 0);
	assert.equal(database.getNotes().length, 0);
	assert.equal(database.getFlashcardSets().length, 0);
	assert.equal(database.getExams().length, 0);
	assert.equal(database.getRevisionTasks().length, 0);
	assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM question_attempts').get().count, 0);
});

test('AI failures are safe and malformed notes are not stored', async () => {
	const countBefore = database.db.prepare('SELECT COUNT(*) AS count FROM study_materials').get().count;
	fetchMode = 'failure';
	const failedRequest = await request('/api/notes/generate', { method: 'POST', body: { material: 'Test source.' } });
	assert.equal(failedRequest.status, 503);
	assert.equal(failedRequest.body.error.includes('test-key-not-real'), false);

	fetchMode = 'malformed';
	const malformedRequest = await request('/api/notes/generate', { method: 'POST', body: { material: 'Test source.' } });
	assert.equal(malformedRequest.status, 502);
	assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM study_materials').get().count, countBefore);
	fetchMode = 'success';
});

test('batch practice grading records all answers and mistakes atomically', async () => {
	const materialId = database.createStudyMaterial({ title: 'Batch test', content: 'Test material.' });
	const mcqId = database.createPracticeQuestion({
		materialId,
		question: 'Choose the correct option.',
		questionType: 'multiple_choice',
		options: ['A', 'B'],
		correctAnswer: 'B',
		explanation: 'B is correct.'
	});
	const shortAnswerId = database.createPracticeQuestion({
		materialId,
		question: 'Define velocity.',
		questionType: 'short_answer',
		correctAnswer: 'Rate of change of displacement.',
		explanation: 'Velocity is displacement per unit time.'
	});

	const response = await request('/api/questions/submit', { method: 'POST', body: { answers: [
		{ questionId: mcqId, answer: 'A' },
		{ questionId: shortAnswerId, answer: 'It is when plants make food.' }
	] } });
	assert.equal(response.status, 200);
	assert.equal(response.body.results.length, 2);
	assert.equal(response.body.results.find(result => result.questionId === mcqId).isCorrect, false);
	assert.equal(response.body.results.find(result => result.questionId === shortAnswerId).isCorrect, false);
	assert.ok(response.body.results.every(result => result.explanation));
	assert.equal(database.getMistakes({ resolved: false }).filter(mistake => mistake.question === 'Choose the correct option.' || mistake.question === 'Define velocity.').length, 2);

	const attemptsBeforeFailure = database.db.prepare('SELECT COUNT(*) AS count FROM question_attempts WHERE question_id IN (?, ?)').get(mcqId, shortAnswerId).count;
	fetchMode = 'failure';
	const failedResponse = await request('/api/questions/submit', { method: 'POST', body: { answers: [
		{ questionId: shortAnswerId, answer: 'Another answer.' }
	] } });
	assert.equal(failedResponse.status, 503);
	assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM question_attempts WHERE question_id IN (?, ?)').get(mcqId, shortAnswerId).count, attemptsBeforeFailure);
	fetchMode = 'success';
});