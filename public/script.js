const state = {
	view: 'dashboard',
	viewHistory: [],
	subjects: [],
	notes: [],
	flashcardSets: [],
	activeFlashcardSet: null,
	flashcards: { cards: [], index: 0, flipped: false },
	questions: { items: [], answers: {}, submitted: false, results: [] },
	exams: [],
	groqApiKey: localStorage.getItem('oryn.groqApiKey') || '',
	activeExam: null,
	examResult: null,
	examTimer: null,
	toastTimer: null,
	akuebMode: false
};



const viewNames = {
	dashboard: 'OVERVIEW',
	syllabus: 'SYLLABUS',
	notes: 'NOTES',
	flashcards: 'FLASHCARDS',
	practice: 'PRACTICE',
	'api-settings': 'API KEY',
	mistakes: 'MISTAKE BANK',
	exams: 'EXAM SIMULATOR',
	revision: 'REVISION PLANNER'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	})[character]);
}

async function api(path, options = {}) {
	const usesAI = path === '/test-ai'
		|| /^\/(notes\/generate|flashcards\/generate|questions\/(generate|submit|[^/]+\/answer)|exams\/(generate|[^/]+\/submit))$/.test(path);
	const response = await fetch(`/api${path}`, {
		...options,
		headers: {
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...(usesAI && state.groqApiKey ? { 'X-Groq-API-Key': state.groqApiKey } : {}),
			...options.headers
		}
	});
	if (response.status === 204) return null;
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
	return result;
}

function showToast(message) {
	const toast = $('#toast');
	toast.textContent = message;
	toast.classList.add('visible');
	clearTimeout(state.toastTimer);
	state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function setLoading(form, buttonText) {
	const button = form.querySelector('button[type="submit"]');
	if (!button) return () => {};
	const original = button.innerHTML;
	button.disabled = true;
	button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(buttonText)}`;
	return () => {
		button.disabled = false;
		button.innerHTML = original;
	};
}

function updateNavigationControls() {
	$('#back-navigation').disabled = !state.akuebMode && state.viewHistory.length === 0;
}

function showView(name, { recordHistory = true } = {}) {
	if (!viewNames[name]) return;
	if (recordHistory && name !== state.view) {
		state.viewHistory.push(state.view);
		if (state.viewHistory.length > 50) state.viewHistory.shift();
	}
	state.view = name;
	$$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}-view`));
	$$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === name));
	$('#current-section').textContent = viewNames[name];
	updateNavigationControls();
	if (name === 'dashboard') loadDashboard();
	if (name === 'syllabus') loadSubjects();
	if (name === 'notes') loadNotes();
	if (name === 'flashcards') loadFlashcardLibrary();
	if (name === 'mistakes') loadMistakes();
	if (name === 'exams') loadExamLibrary();
	if (name === 'revision') {
		loadRevisionTasks();
		loadRevisionSources();
	}
}

function navigateBack() {
	if (state.akuebMode) {
		setAkuebMode(false);
		return;
	}
	const previousView = state.viewHistory.pop();
	if (previousView && viewNames[previousView]) showView(previousView, { recordHistory: false });
}

function setAkuebMode(enabled) {
	state.akuebMode = enabled;
	$('.app-shell').classList.toggle('akueb-mode', enabled);
	$('#akueb-preview').hidden = !enabled;
	$('#akueb-nav').hidden = !enabled;
	$('#akueb-mode-toggle').setAttribute('aria-pressed', String(enabled));
	$('#akueb-mode-label').textContent = enabled ? 'General Mode' : 'AKUEB Mode';
	$('#current-section').textContent = enabled ? 'AKUEB PREVIEW' : viewNames[state.view];
	$('#breadcrumb-brand').textContent = enabled ? 'ORYN AI · AKUEB EDITION' : 'ORYN AI';
	updateNavigationControls();
	if (enabled) {
		$$('#akueb-nav .nav-item').forEach((item, index) => item.classList.toggle('active', index === 0));
	}
}

function openAssistantPreview() {
	const dialog = $('#assistant-dialog');
	if (!dialog.open) dialog.showModal();
}

function renderSelect(select, items, placeholder, valueFor, labelFor) {
	const selected = select.value;
	select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items.map(item =>
		`<option value="${escapeHtml(valueFor(item))}">${escapeHtml(labelFor(item))}</option>`
	).join('')}`;
	if (items.some(item => String(valueFor(item)) === selected)) select.value = selected;
}

function refreshSubjectSelects() {
	renderSelect($('#topic-subject'), state.subjects, 'Choose subject', subject => subject.id, subject => subject.name);
	renderSelect($('#mistake-subject'), state.subjects, 'All subjects', subject => subject.id, subject => subject.name);
	renderSelect($('#exam-subject'), state.subjects, 'Choose subject', subject => subject.id, subject => subject.name);
	const topics = state.subjects.flatMap(subject => subject.topics.map(topic => ({ ...topic, subjectName: subject.name })));
	renderSelect($('#notes-topic'), topics, 'No topic selected', topic => topic.id, topic => `${topic.subjectName} / ${topic.name}`);
}

async function loadSubjects() {
	try {
		state.subjects = await api('/subjects');
		refreshSubjectSelects();
		renderSyllabus();
	} catch (error) {
		$('#syllabus-list').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

function renderSyllabus() {
	const container = $('#syllabus-list');
	if (!state.subjects.length) {
		container.innerHTML = '<div class="section-block inline-empty">No subjects yet. Create your first subject to organize your studies.</div>';
		return;
	}
	container.innerHTML = state.subjects.map(subject => `
		<section class="subject-card">
			<div class="subject-header">
				<div class="subject-title"><span class="subject-color" aria-hidden="true"></span><h2>${escapeHtml(subject.name)}</h2></div>
				<div class="subject-actions">
					<button class="button button-secondary button-small" type="button" data-action="rename-subject" data-id="${subject.id}">Rename</button>
					<button class="icon-button" type="button" aria-label="Delete ${escapeHtml(subject.name)}" title="Delete subject" data-action="delete-subject" data-id="${subject.id}">×</button>
				</div>
			</div>
			<div class="topic-list">${subject.topics.length ? subject.topics.map(topic => `
				<div class="topic-row">
					<span class="topic-name" title="${escapeHtml(topic.name)}">${escapeHtml(topic.name)}</span>
					<span class="topic-performance">${topic.performance.mastery === null ? 'No performance data' : `${topic.performance.mastery}% evidence accuracy`}</span>
					<select class="topic-status" aria-label="Status for ${escapeHtml(topic.name)}" data-topic-status="${topic.id}">
						<option value="not_started" ${topic.status === 'not_started' ? 'selected' : ''}>Not started</option>
						<option value="in_progress" ${topic.status === 'in_progress' ? 'selected' : ''}>In progress</option>
						<option value="completed" ${topic.status === 'completed' ? 'selected' : ''}>Completed</option>
					</select>
					  <div class="topic-actions"><button class="icon-button" type="button" aria-label="Edit ${escapeHtml(topic.name)}" title="Rename topic" data-action="rename-topic" data-id="${topic.id}">✎</button>
					  <button class="icon-button" type="button" aria-label="Delete ${escapeHtml(topic.name)}" title="Delete topic" data-action="delete-topic" data-id="${topic.id}">×</button></div>
				</div>`).join('') : '<div class="inline-empty">No topics in this subject yet.</div>'}</div>
		</section>`).join('');
}

async function loadDashboard() {
	try {
		const data = await api('/dashboard');
		const metrics = [
			['Subjects', data.subjects, `${data.topics.length} topics in your syllabus`],
			['Topics completed', data.topics_completed, `${data.topics_in_progress} in progress`],
			['Questions attempted', data.questions_attempted, `${data.questions_correct} correct answers`],
			['Practice accuracy', data.accuracy === null ? '—' : `${data.accuracy}%`, data.accuracy === null ? 'Appears after your first answer' : 'From practice and exam answers'],
			['Unresolved mistakes', data.unresolved_mistakes, `${data.resolved_mistakes} resolved`],
			['Completed exams', data.completed_exams, `Average score: ${data.average_exam_score === null ? '—' : `${Math.round(data.average_exam_score)}%`}`],
			['Study sessions', data.study_sessions, `${data.study_minutes} minutes recorded`],
			['Revision tasks', data.pending_revision_tasks, `${data.completed_revision_tasks} completed`]
		];
		$('#dashboard-metrics').innerHTML = metrics.map(([label, value, note]) => `
			<article class="metric-card"><p class="metric-label">${escapeHtml(label)}</p><p class="metric-value">${escapeHtml(value)}</p><span class="metric-note">${escapeHtml(note)}</span></article>
		`).join('');
		const topics = Array.isArray(data.topics) ? data.topics : [];
		const topicCount = topics.length;
		const completedCount = Number(data.topics_completed) || 0;
		const inProgressCount = Number(data.topics_in_progress) || 0;
		const notStartedCount = Math.max(0, topicCount - completedCount - inProgressCount);
		const completion = topicCount ? Math.round((completedCount / topicCount) * 100) : 0;
		$('#dashboard-progress').innerHTML = `
			<div class="progress-summary">
				<div class="progress-gauge" role="img" aria-label="${completion}% of syllabus topics completed">
					<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="progress-gauge-track" cx="60" cy="60" r="45"></circle><circle class="progress-gauge-value" cx="60" cy="60" r="45" style="--gauge-offset:${283 - (283 * completion / 100)}"></circle></svg>
					<div class="progress-gauge-copy"><strong>${completion}%</strong><span>Overall completion</span></div>
				</div>
				<div class="progress-summary-copy"><p class="eyebrow">TOPIC COMPLETION</p><h2>Your study progress</h2><p>${topicCount ? `${completedCount} of ${topicCount} syllabus topics completed.` : 'Add subjects and topics to start tracking your progress.'}</p></div>
				<div class="progress-status-list"><div><span class="status-key status-complete"></span><span>Completed</span><strong>${completedCount}</strong></div><div><span class="status-key status-active"></span><span>In progress</span><strong>${inProgressCount}</strong></div><div><span class="status-key status-pending"></span><span>Not started</span><strong>${notStartedCount}</strong></div></div>
			</div>`;
		if (!topics.length) {
			$('#dashboard-topics').innerHTML = '<div class="inline-empty">Add subjects and topics to see your syllabus here.</div>';
		} else {
			$('#dashboard-topics').innerHTML = topics.slice(0, 8).map(topic => `
				<div class="topic-progress-row">
					<div class="topic-progress-name">${escapeHtml(topic.name)}<span class="topic-progress-subject">${escapeHtml(topic.subject_name)}</span></div>
					<div class="progress-track" aria-label="${topic.mastery === null ? 'No performance data' : `${topic.mastery}% accuracy`}"><div class="progress-fill" style="width:${topic.mastery ?? 0}%"></div></div>
					<span class="progress-value">${topic.mastery === null ? 'No data' : `${topic.mastery}%`}</span>
				</div>`).join('');
		}
	} catch (error) {
		$('#dashboard-metrics').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

function formatDate(value) {
	if (!value) return '';
	const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
	return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

async function loadNotes() {
	try {
		state.notes = await api('/notes');
		renderNotes();
		refreshSourceSelects();
	} catch (error) {
		$('#notes-list').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

function renderNotes() {
	const container = $('#notes-list');
	if (!state.notes.length) {
		container.innerHTML = '<div class="inline-empty">No saved notes yet.</div>';
		return;
	}
	container.innerHTML = state.notes.map(note => `
		<article class="saved-note-card">
			<button class="saved-note-open" type="button" data-open-note="${note.id}">
				<span class="saved-note-mark" aria-hidden="true">N</span>
				<span class="saved-note-copy"><span class="saved-note-title">${escapeHtml(note.title)}</span><span class="saved-note-meta">${escapeHtml(note.source_title)} <span aria-hidden="true">·</span> ${escapeHtml(formatDate(note.created_at))}</span></span>
				<span class="saved-note-action">Open notes <span aria-hidden="true">↗</span></span>
			</button>
			<button class="icon-button delete-saved-button" type="button" data-action="delete-note" data-id="${note.id}" aria-label="Delete ${escapeHtml(note.title)}" title="Delete saved notes">×</button>
		</article>
	`).join('');
}

function renderNoteDetail(note) {
	const detail = $('#note-detail');
	const sections = note.sections || {};
	const sectionHtml = (title, items) => Array.isArray(items) && items.length ? `<section class="note-section"><h3>${title}</h3><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
	const definitions = sections.definitions?.length ? `<section class="note-section"><h3>Important definitions</h3><ul>${sections.definitions.map(item => `<li><strong>${escapeHtml(item.term)}:</strong> ${escapeHtml(item.definition)}</li>`).join('')}</ul></section>` : '';
	detail.innerHTML = `
		<p class="eyebrow">STUDY NOTES</p><h2>${escapeHtml(note.title)}</h2><p class="note-overview">${escapeHtml(note.overview)}</p>
		${sectionHtml('Key concepts', sections.keyConcepts)}${definitions}
		${sections.detailedExplanation ? `<section class="note-section"><h3>Detailed explanation</h3><p>${escapeHtml(sections.detailedExplanation)}</p></section>` : ''}
		${sectionHtml('Examples', sections.examples)}${sectionHtml('Important facts', sections.importantFacts)}
		${sectionHtml('Common confusions', sections.commonConfusions)}${sectionHtml('Quick revision', sections.quickRevisionPoints)}
		<p class="saved-item-meta">Source: ${escapeHtml(note.source_title)}${note.topic_id ? ' · Linked to a syllabus topic' : ' · Standalone material'}</p>
		<div class="note-detail-actions"><button class="button button-primary" type="button" data-action="generate-flashcards-from-note" data-note-id="${note.id}">Generate flashcards <span aria-hidden="true">→</span></button><button class="button button-secondary" type="button" data-action="generate-questions-from-note" data-note-id="${note.id}">Generate practice questions <span aria-hidden="true">→</span></button></div>`;
	detail.classList.remove('hidden');
	detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function refreshSourceSelects() {
	const items = state.notes.map(note => ({ id: note.id, name: note.title }));
	renderSelect($('#flashcard-source'), items, 'Choose saved notes', item => `note:${item.id}`, item => item.name);
	renderSelect($('#practice-source'), items, 'Choose saved notes', item => `note:${item.id}`, item => item.name);
	renderSelect($('#exam-source'), state.notes, 'No notes selected', note => `material:${note.material_id}`, note => note.title);
}

function selectedSource(select) {
	const [type, id] = select.value.split(':');
	return { [type === 'material' ? 'materialId' : 'noteId']: Number(id) };
}

function renderFlashcard() {
	const stage = $('#flashcard-stage');
	const { cards, index, flipped } = state.flashcards;
	if (!cards.length) {
		stage.innerHTML = '<div class="empty-state"><span class="empty-mark">✳</span><h2>Pick a set to begin</h2><p>Your saved flashcard sets will appear here.</p></div>';
		return;
	}
	const card = cards[index];
	stage.innerHTML = `
		<button class="flashcard ${flipped ? 'is-flipped' : ''}" type="button" data-action="flip-card" aria-label="${flipped ? 'Show question' : 'Show answer'}" aria-pressed="${flipped}">
			<span class="flashcard-inner">
				<span class="flashcard-face flashcard-front"><span class="flashcard-label">QUESTION</span><span class="flashcard-text">${escapeHtml(card.front)}</span><span class="flashcard-hint">Click to reveal answer <span aria-hidden="true">↻</span></span></span>
				<span class="flashcard-face flashcard-back"><span class="flashcard-label">ANSWER</span><span class="flashcard-text">${escapeHtml(card.back)}</span><span class="flashcard-hint">Click to return to question <span aria-hidden="true">↻</span></span></span>
			</span>
		</button>
		<div class="flashcard-controls"><button class="button button-secondary button-small" type="button" data-action="previous-card" ${index === 0 ? 'disabled' : ''}>← Previous</button><span class="flashcard-count">${index + 1} / ${cards.length}</span><button class="button button-secondary button-small" type="button" data-action="next-card" ${index === cards.length - 1 ? 'disabled' : ''}>Next →</button></div>
		<div class="flashcard-followup"><button class="button button-secondary" type="button" data-action="practice-from-flashcard-set">Generate practice questions <span aria-hidden="true">→</span></button></div>`;
}

async function loadFlashcardLibrary() {
	try {
		state.flashcardSets = await api('/flashcards');
		const container = $('#flashcard-library');
		container.innerHTML = state.flashcardSets.length ? state.flashcardSets.map(set => `
			<div class="saved-item"><div class="saved-item-main"><p class="saved-item-title">${escapeHtml(set.title)}</p><p class="saved-item-meta">${escapeHtml(formatDate(set.created_at))}</p></div><button class="link-button" type="button" data-open-flashcard-set="${set.id}">Study set <span aria-hidden="true">→</span></button><button class="icon-button delete-saved-button" type="button" data-action="delete-flashcard-set" data-id="${set.id}" aria-label="Delete ${escapeHtml(set.title)}" title="Delete flashcard set">×</button></div>
		`).join('') : '<div class="inline-empty">No flashcard sets yet.</div>';
	} catch (error) {
		$('#flashcard-library').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

async function openFlashcardSet(id) {
	try {
		const set = await api(`/flashcards/${id}`);
		state.activeFlashcardSet = set;
		state.flashcards = { cards: set.cards, index: 0, flipped: false };
		renderFlashcard();
		$('#flashcard-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
	} catch (error) {
		showToast(error.message);
	}
}

async function loadExamLibrary() {
	try {
		state.exams = await api('/exams');
		const container = $('#exam-library');
		container.innerHTML = state.exams.length ? state.exams.map(exam => `
			<div class="saved-item"><div class="saved-item-main"><p class="saved-item-title">${escapeHtml(exam.title)}</p><p class="saved-item-meta">${exam.completed_at ? `${exam.correct_answers}/${exam.total_questions} correct · ${exam.score}%` : 'In progress'} · ${escapeHtml(formatDate(exam.created_at))}</p></div><button class="link-button" type="button" data-open-exam="${exam.id}">${exam.completed_at ? 'View results' : 'Resume exam'} <span aria-hidden="true">→</span></button><button class="icon-button delete-saved-button" type="button" data-action="delete-exam" data-id="${exam.id}" aria-label="Delete ${escapeHtml(exam.title)}" title="Delete exam">×</button></div>
		`).join('') : '<div class="inline-empty">No exams yet.</div>';
	} catch (error) {
		$('#exam-library').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

function stopExamTimer() {
	clearInterval(state.examTimer);
	state.examTimer = null;
}

function examSecondsRemaining(exam) {
	const startedAt = new Date(`${exam.created_at.replace(' ', 'T')}Z`).getTime();
	const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
	return Math.max(0, exam.duration_minutes * 60 - elapsedSeconds);
}

function updateExamTimer() {
	if (!state.activeExam || state.activeExam.completed_at) return stopExamTimer();
	const remaining = examSecondsRemaining(state.activeExam);
	const timer = $('#exam-timer');
	if (timer) timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
	if (remaining <= 0) {
		stopExamTimer();
		submitExam(true);
	}
}

function startExamTimer() {
	stopExamTimer();
	updateExamTimer();
	if (state.activeExam && !state.activeExam.completed_at) state.examTimer = setInterval(updateExamTimer, 1000);
}

async function openExam(id) {
	try {
		state.activeExam = await api(`/exams/${id}`);
		state.examResult = null;
		renderExamStage();
		$('#exam-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
		if (!state.activeExam.completed_at) startExamTimer();
	} catch (error) {
		showToast(error.message);
	}
}

function renderExamStage() {
	const stage = $('#exam-stage');
	const exam = state.activeExam;
	if (!exam) {
		stage.classList.add('hidden');
		stage.innerHTML = '';
		return;
	}
	stage.classList.remove('hidden');
	if (exam.completed_at) {
		const questionReviews = exam.questions.map((question, index) => `
			<article class="exam-question ${question.is_correct ? 'question-correct' : 'question-incorrect'}"><div class="question-topline"><span>QUESTION ${index + 1}</span><span class="resolved-tag ${question.is_correct ? '' : 'unresolved'}">${question.is_correct ? 'CORRECT' : 'REVIEW'}</span></div><p class="question-prompt">${escapeHtml(question.question)}</p>${question.topic_name ? `<p class="exam-question-topic">${escapeHtml(question.topic_name)}</p>` : ''}<p class="mistake-answer"><strong>Your answer:</strong> ${escapeHtml(question.student_answer || 'No answer')}</p><p class="mistake-answer"><strong>Correct answer:</strong> ${escapeHtml(question.correct_answer || '')}</p><div class="exam-question-result"><strong>Explanation</strong><p>${escapeHtml(question.explanation || 'No explanation was provided.')}</p></div></article>`).join('');
		stage.innerHTML = `<div class="exam-score"><p class="eyebrow">EXAM COMPLETE</p><strong>${exam.score}%</strong><p>${exam.correct_answers} of ${exam.total_questions} correct answers</p></div>${questionReviews}`;
		return;
	}
	stage.innerHTML = `<div class="exam-toolbar"><strong>${escapeHtml(exam.title)}</strong><span id="exam-timer" class="exam-timer" aria-live="polite"></span></div>${exam.questions.map((question, index) => `
		<article class="exam-question" data-exam-question="${question.id}"><div class="question-topline"><span>QUESTION ${index + 1} OF ${exam.questions.length}</span><span class="question-type">${question.question_type === 'multiple_choice' ? 'MULTIPLE CHOICE' : 'SHORT ANSWER'}</span></div><p class="question-prompt">${escapeHtml(question.question)}</p>
		${question.question_type === 'multiple_choice' ? `<div class="answer-options">${question.options.map(option => `<label class="answer-option"><input type="radio" name="exam-${question.id}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>` : `<textarea id="exam-answer-${question.id}" rows="3" maxlength="8000" placeholder="Write your answer..."></textarea>`}</article>`).join('')}
		<button class="button button-primary full-width" type="button" data-action="submit-exam">Submit exam</button>`;
}

function showExamSubmittedDialog(result) {
	const dialog = $('#exam-submitted-dialog');
	const exam = result.exam;
	$('#exam-submitted-score').textContent = `${result.correctAnswers} of ${exam.total_questions} correct · ${result.score}%`;
	const topicList = $('#exam-revisit-topics');
	const topics = (result.topicResults || []).filter(topic => topic.topicName && topic.correct < topic.total);
	topicList.replaceChildren();
	if (topics.length) {
		for (const topic of topics) {
			const item = document.createElement('li');
			item.textContent = `${topic.topicName} · ${topic.correct} of ${topic.total} correct`;
			topicList.append(item);
		}
	} else if (result.score < 100) {
		const item = document.createElement('li');
		const missedTopics = [...new Set(exam.questions.filter(question => !question.is_correct).map(question => question.topic_name).filter(Boolean))];
		item.textContent = `Revisit: ${(missedTopics.length ? missedTopics : [exam.title.replace(/\s+practice exam$/i, '')]).join(', ')}`;
		topicList.append(item);
	} else {
		const item = document.createElement('li');
		item.textContent = 'No topics were flagged for review in this exam.';
		topicList.append(item);
	}
	if (!dialog.open) dialog.showModal();
}

async function handleExamSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	const selectedNote = $('#exam-source').value;
	const topicNames = [...new Set($('#exam-topics').value.split(',').map(name => name.trim()).filter(Boolean))];
	if (!selectedNote && !topicNames.length) return reportFormError(form, 'Enter one or more topics, or choose saved notes.');
	const payload = {
		count: Number($('#exam-count').value),
		durationMinutes: Number($('#exam-duration').value),
		difficulty: $('#exam-difficulty').value
	};
	if (selectedNote) payload.materialId = Number(selectedNote.split(':')[1]);
	else {
		payload.topicNames = topicNames;
		if ($('#exam-subject').value) payload.subjectId = Number($('#exam-subject').value);
	}
	const restore = setLoading(form, 'Building your exam...');
	try {
		state.activeExam = await api('/exams/generate', { method: 'POST', body: JSON.stringify(payload) });
		state.examResult = null;
		renderExamStage();
		$('#exam-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
		startExamTimer();
		await loadExamLibrary();
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function submitExam(timeExpired = false) {
	if (!state.activeExam || state.activeExam.completed_at) return;
	const answers = state.activeExam.questions.map(question => ({
		questionId: question.id,
		answer: question.question_type === 'multiple_choice'
			? $(`input[name="exam-${question.id}"]:checked`)?.value || ''
			: $(`#exam-answer-${question.id}`)?.value || ''
	}));
	const button = $('[data-action="submit-exam"]');
	if (button) {
		button.disabled = true;
		button.textContent = timeExpired ? 'Time is up. Submitting...' : 'Submitting...';
	}
	stopExamTimer();
	try {
		state.examResult = await api(`/exams/${state.activeExam.id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) });
		state.activeExam = state.examResult.exam;
		renderExamStage();
		await Promise.all([loadExamLibrary(), loadDashboard(), loadMistakes()]);
		showExamSubmittedDialog(state.examResult);
		showToast(timeExpired ? 'Time is up. Your exam was submitted.' : 'Exam submitted.');
	} catch (error) {
		showToast(error.message);
		startExamTimer();
	}
}

async function loadRevisionTasks() {
	const list = $('#revision-list');
	try {
		const tasks = await api('/revision');
		if (!tasks.length) {
			list.innerHTML = '<div class="section-block inline-empty">No revision tasks yet. Select saved notes or exams, upload a text syllabus, or list topics above to build a plan.</div>';
			return;
		}
		const subjectNames = new Map(state.subjects.map(subject => [subject.id, subject.name]));
		list.innerHTML = tasks.map(task => {
			const topic = task.topic;
			const subjectName = topic ? subjectNames.get(topic.subject_id) : null;
			const context = subjectName ? `${subjectName} / ${topic.name}` : ({ review_notes: 'Saved notes', review_exam: 'Saved exam', topic_review: 'Syllabus topic' })[task.task_type] || 'Topic removed';
			return `<article class="revision-task ${task.completed ? 'completed' : ''}"><span class="revision-date">${escapeHtml(formatDate(task.scheduled_date))}</span><div><p class="revision-task-title">${escapeHtml(task.title)}</p><p class="revision-task-meta">${escapeHtml(context)} · ${task.duration_minutes} minutes · ${escapeHtml(task.task_type.replaceAll('_', ' '))}</p></div><div class="revision-actions">${task.completed ? '<span class="resolved-tag">DONE</span>' : `<button class="button button-secondary button-small" type="button" data-complete-revision="${task.id}">Complete</button>`}<button class="icon-button delete-saved-button" type="button" data-action="delete-revision" data-id="${task.id}" aria-label="Delete ${escapeHtml(task.title)}" title="Delete revision task">×</button></div></article>`;
		}).join('');
	} catch (error) {
		list.innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

async function loadRevisionSources() {
	try {
		const [notes, exams] = await Promise.all([api('/notes'), api('/exams')]);
		$('#revision-notes-list').innerHTML = notes.length ? notes.map(note => `
			<label class="revision-source-option"><input type="checkbox" name="revision-note" value="${note.id}"><span><strong>${escapeHtml(note.title)}</strong><small>${escapeHtml(note.source_title)} · ${escapeHtml(formatDate(note.created_at))}</small></span></label>
		`).join('') : '<p class="inline-empty">No saved notes yet.</p>';
		$('#revision-exams-list').innerHTML = exams.length ? exams.map(exam => `
			<label class="revision-source-option"><input type="checkbox" name="revision-exam" value="${exam.id}"><span><strong>${escapeHtml(exam.title)}</strong><small>${exam.completed_at ? `${exam.correct_answers}/${exam.total_questions} correct · ${exam.score}%` : 'In progress'} · ${escapeHtml(formatDate(exam.created_at))}</small></span></label>
		`).join('') : '<p class="inline-empty">No saved exams yet.</p>';
	} catch (error) {
		$('#revision-notes-list').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
		$('#revision-exams-list').innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

async function handleRevisionSyllabusUpload(event) {
	const file = event.currentTarget.files?.[0];
	if (!file) return;
	if (!/\.(txt|md)$/i.test(file.name)) {
		showToast('Choose a .txt or .md syllabus file.');
		event.currentTarget.value = '';
		return;
	}
	try {
		const lines = (await file.text()).split(/\r?\n/)
			.map(line => line.trim().replace(/^#{1,6}\s*/, '').replace(/^(?:[-*]|\d+[.)])\s*/, ''))
			.filter(line => line.length > 0 && line.length <= 160);
		const uniqueLines = [...new Set(lines)].slice(0, 30);
		$('#revision-topic-list').value = uniqueLines.join('\n');
		showToast(`${uniqueLines.length} topics imported from the syllabus.`);
	} catch {
		showToast('The syllabus file could not be read.');
	}
}

async function generateRevisionPlan() {
	const button = $('#generate-revision');
	button.disabled = true;
	button.textContent = 'Building plan...';
	const noteIds = $$('input[name="revision-note"]:checked').map(input => Number(input.value));
	const examIds = $$('input[name="revision-exam"]:checked').map(input => Number(input.value));
	const topicNames = $('#revision-topic-list').value.split(/\r?\n/).map(topic => topic.trim()).filter(Boolean);
	try {
		await api('/revision/generate', { method: 'POST', body: JSON.stringify({ noteIds, examIds, topicNames }) });
		await loadRevisionTasks();
		showToast(noteIds.length || examIds.length || topicNames.length ? 'Revision plan created from your selected materials.' : 'Revision plan created from your recorded results.');
	} catch (error) {
		showToast(error.message);
	} finally {
		button.disabled = false;
		button.innerHTML = 'Build a 7-day plan <span aria-hidden="true">→</span>';
	}
}

function renderQuestion() {
	const stage = $('#question-stage');
	const { items, answers, submitted, results } = state.questions;
	if (!items.length) {
		stage.innerHTML = '<div class="empty-state"><span class="empty-mark">?</span><h2>Ready when you are</h2><p>Choose study material to create a focused practice set.</p></div>';
		return;
	}
	const resultsById = new Map(results.map(result => [result.questionId, result]));
	const correctCount = results.filter(result => result.isCorrect).length;
	const questionCards = items.map((question, index) => {
		const answer = answers[question.id] || '';
		const result = resultsById.get(question.id);
		const options = question.question_type === 'multiple_choice'
			? `<div class="answer-options">${question.options.map(option => {
				const isCorrectOption = submitted && option === result?.correctAnswer;
				const isWrongSelection = submitted && !result?.isCorrect && option === result?.studentAnswer;
				const optionClass = isCorrectOption ? ' is-correct' : isWrongSelection ? ' is-incorrect' : '';
				const badge = isCorrectOption ? '<span class="answer-option-result">Correct answer</span>' : isWrongSelection ? '<span class="answer-option-result">Your answer</span>' : '';
				return `<label class="answer-option${optionClass}"><input type="radio" name="practice-answer-${question.id}" value="${escapeHtml(option)}" ${answer === option ? 'checked' : ''} ${submitted ? 'disabled' : ''}><span class="answer-option-copy">${escapeHtml(option)}</span>${badge}</label>`;
			}).join('')}</div>`
			: submitted
				? `<div class="short-answer-review"><div class="answer-review-value ${result?.isCorrect ? 'is-correct' : 'is-incorrect'}"><span>Your answer</span><strong>${escapeHtml(result?.studentAnswer || 'No answer provided')}</strong></div>${!result?.isCorrect ? `<div class="answer-review-value is-correct"><span>Correct answer</span><strong>${escapeHtml(result?.correctAnswer)}</strong></div>` : ''}</div>`
				: `<textarea id="practice-answer-${question.id}" rows="3" maxlength="8000" placeholder="Write your answer...">${escapeHtml(answer)}</textarea>`;
		const explanation = submitted ? `<div class="answer-feedback ${result?.isCorrect ? '' : 'incorrect'}"><strong>${result?.isCorrect ? 'Correct' : 'Review this answer'}</strong>${result?.feedback && result.feedback !== result.explanation ? `<p>${escapeHtml(result.feedback)}</p>` : ''}${result?.explanation ? `<p><strong>Explanation:</strong> ${escapeHtml(result.explanation)}</p>` : result?.feedback ? `<p>${escapeHtml(result.feedback)}</p>` : ''}</div>` : '';
		return `<article class="question-card ${submitted ? result?.isCorrect ? 'question-correct' : 'question-incorrect' : ''}" data-question-id="${question.id}"><div class="question-topline"><span>QUESTION ${index + 1} OF ${items.length}</span><span class="question-type">${question.question_type === 'multiple_choice' ? 'MULTIPLE CHOICE' : 'SHORT ANSWER'}</span></div><p class="question-prompt">${escapeHtml(question.question)}</p>${options}${explanation}</article>`;
	}).join('');

	stage.innerHTML = `${submitted
		? `<div class="question-set-summary"><span class="eyebrow">SET COMPLETE</span><strong>${correctCount} / ${items.length} correct</strong><span>Your answers and explanations are shown below.</span></div>`
		: `<div class="question-set-toolbar"><span class="eyebrow">${items.length} QUESTIONS</span><span>Select an answer for each question, then submit the set.</span></div>`}
		<div class="question-set-list">${questionCards}</div>
		${submitted
			? '<div class="question-actions question-set-actions"><button class="button button-primary" type="button" data-action="generate-more-questions">Generate more questions</button><button class="button button-secondary" type="button" data-go="mistakes">Review your mistakes</button></div>'
			: '<div class="question-actions question-set-actions"><button class="button button-primary" type="button" data-action="submit-question-set">Submit all answers</button></div>'}`;
}

async function loadMistakes() {
	const list = $('#mistake-list');
	const params = new URLSearchParams();
	const subjectId = $('#mistake-subject').value;
	const resolved = $('#mistake-status').value;
	if (subjectId) params.set('subjectId', subjectId);
	if (resolved) params.set('resolved', resolved);
	try {
		const mistakes = await api(`/mistakes${params.size ? `?${params}` : ''}`);
		if (!mistakes.length) {
			list.innerHTML = '<div class="section-block inline-empty">No mistakes match this view.</div>';
			return;
		}
		const topicNames = new Map(state.subjects.flatMap(subject => subject.topics.map(topic => [topic.id, `${subject.name} / ${topic.name}`])));
		list.innerHTML = mistakes.map(mistake => `
			<article class="mistake-item"><div class="mistake-header"><div><p class="mistake-question">${escapeHtml(mistake.question)}</p><p class="mistake-answer"><strong>Your answer:</strong> ${escapeHtml(mistake.student_answer || 'Not recorded')}</p><p class="mistake-answer"><strong>Correct answer:</strong> ${escapeHtml(mistake.correct_answer)}</p>${mistake.explanation ? `<p class="mistake-answer"><strong>Explanation:</strong> ${escapeHtml(mistake.explanation)}</p>` : ''}<p class="saved-item-meta">${escapeHtml(topicNames.get(mistake.topic_id) || 'Standalone')} · ${escapeHtml(formatDate(mistake.created_at))}</p></div><div class="mistake-actions">${mistake.resolved ? '<span class="resolved-tag">RESOLVED</span>' : `<button class="button button-secondary button-small" type="button" data-resolve-mistake="${mistake.id}">Mark resolved</button>`}<button class="icon-button delete-saved-button" type="button" data-action="delete-mistake" data-id="${mistake.id}" aria-label="Delete mistake" title="Delete mistake">×</button></div></div></article>
		`).join('');
	} catch (error) {
		list.innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
	}
}

function reportFormError(form, message) {
	let error = form.querySelector('.inline-error');
	if (!error) {
		error = document.createElement('p');
		error.className = 'inline-error';
		error.setAttribute('role', 'alert');
		form.append(error);
	}
	error.textContent = message;
}

function clearFormError(form) {
	form.querySelector('.inline-error')?.remove();
}

async function handleSubjectSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	const restore = setLoading(form, 'Adding subject...');
	try {
		await api('/subjects', { method: 'POST', body: JSON.stringify({ name: $('#subject-name').value }) });
		form.reset();
		await Promise.all([loadSubjects(), loadDashboard()]);
		showToast('Subject added.');
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function handleTopicSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	const restore = setLoading(form, 'Adding topic...');
	try {
		await api('/topics', { method: 'POST', body: JSON.stringify({ subjectId: $('#topic-subject').value, name: $('#topic-name').value }) });
		$('#topic-name').value = '';
		await Promise.all([loadSubjects(), loadDashboard()]);
		showToast('Topic added.');
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function handleNotesSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	const restore = setLoading(form, 'Generating notes...');
	try {
		const note = await api('/notes/generate', { method: 'POST', body: JSON.stringify({
			topicId: $('#notes-topic').value || null,
			title: $('#notes-heading').value,
			material: $('#notes-material').value
		}) });
		form.reset();
		await Promise.all([loadNotes(), loadDashboard()]);
		renderNoteDetail(note);
		showToast('Notes saved.');
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function handleFlashcardSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	const source = $('#flashcard-source').value;
	if (!source) return reportFormError(form, 'Choose saved notes first.');
	const restore = setLoading(form, 'Creating flashcards...');
	try {
		const set = await api('/flashcards/generate', { method: 'POST', body: JSON.stringify({ ...selectedSource($('#flashcard-source')), count: Number($('#flashcard-count').value) }) });
		await Promise.all([loadFlashcardLibrary(), loadDashboard()]);
		state.flashcards = { cards: set.cards, index: 0, flipped: false };
		state.activeFlashcardSet = set;
		renderFlashcard();
		$('#flashcard-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
		showToast('Flashcards saved.');
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function handlePracticeSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	clearFormError(form);
	if (!$('#practice-source').value) return reportFormError(form, 'Choose saved notes first.');
	const restore = setLoading(form, 'Creating questions...');
	try {
		const questions = await api('/questions/generate', { method: 'POST', body: JSON.stringify({ ...selectedSource($('#practice-source')), count: Number($('#practice-count').value) }) });
		state.questions = { items: questions, answers: {}, submitted: false, results: [] };
		renderQuestion();
		$('#question-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
		await loadDashboard();
		showToast('Practice set saved.');
	} catch (error) {
		reportFormError(form, error.message);
	} finally {
		restore();
	}
}

async function submitQuestionSet() {
	if (!state.questions.items.length || state.questions.submitted) return;
	const answers = state.questions.items.map(question => ({
		questionId: question.id,
		answer: question.question_type === 'multiple_choice'
			? $(`input[name="practice-answer-${question.id}"]:checked`)?.value || ''
			: $(`#practice-answer-${question.id}`)?.value.trim() || ''
	}));
	if (answers.some(item => !item.answer)) return showToast('Answer every question before submitting.');
	const button = $('[data-action="submit-question-set"]');
	button.disabled = true;
	button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Checking your answers...';
	try {
		const response = await api('/questions/submit', { method: 'POST', body: JSON.stringify({ answers }) });
		state.questions.answers = Object.fromEntries(answers.map(item => [item.questionId, item.answer]));
		state.questions.results = response.results;
		state.questions.submitted = true;
		renderQuestion();
		$('#question-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
		await Promise.all([loadDashboard(), loadMistakes()]);
		const correctCount = response.results.filter(result => result.isCorrect).length;
		showToast(`Results saved: ${correctCount} of ${response.results.length} correct.`);
	} catch (error) {
		button.disabled = false;
		showToast(error.message);
	}
}

async function handleSyllabusAction(button) {
	const id = button.dataset.id;
	switch (button.dataset.action) {
		case 'rename-subject': {
			const current = state.subjects.find(subject => String(subject.id) === id)?.name;
			const name = window.prompt('Rename subject', current || '');
			if (name?.trim()) await api(`/subjects/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
			break;
		}
		case 'delete-subject':
			if (!window.confirm('Delete this subject and its syllabus topics?')) return;
			await api(`/subjects/${id}`, { method: 'DELETE' });
			break;
		case 'rename-topic': {
			const current = state.subjects.flatMap(subject => subject.topics).find(topic => String(topic.id) === id)?.name;
			const name = window.prompt('Rename topic', current || '');
			if (name?.trim()) await api(`/topics/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
			break;
		}
		case 'delete-topic':
			if (!window.confirm('Delete this topic? Linked study activity will be retained where possible.')) return;
			await api(`/topics/${id}`, { method: 'DELETE' });
			break;
		default:
			return;
	}
	await Promise.all([loadSubjects(), loadDashboard(), loadNotes()]);
}

function startPracticeFromNote(noteId) {
	const sourceSelect = $('#practice-source');
	sourceSelect.value = `note:${noteId}`;
	if (!sourceSelect.value) {
		showToast('This note is no longer available.');
		return;
	}
	showView('practice');
	$('#practice-form').requestSubmit();
}

function startPracticeFromFlashcardSet() {
	const materialId = state.activeFlashcardSet?.material_id;
	const note = state.notes.find(item => String(item.material_id) === String(materialId));
	if (!note) {
		showToast('The saved notes for this flashcard set are unavailable.');
		return;
	}
	startPracticeFromNote(note.id);
}

document.addEventListener('click', async event => {
	const previewLink = event.target.closest('[data-akueb-scroll]');
	if (previewLink && state.akuebMode) {
		document.getElementById(previewLink.dataset.akuebScroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		$$('#akueb-nav .nav-item').forEach(item => item.classList.toggle('active', item.dataset.akuebScroll === previewLink.dataset.akuebScroll));
		return;
	}
	const viewButton = event.target.closest('[data-view], [data-go]');
	if (viewButton) return showView(viewButton.dataset.view || viewButton.dataset.go);
	const button = event.target.closest('[data-action]');
	if (button) {
		try {
			switch (button.dataset.action) {
				case 'delete-note':
					if (!window.confirm('Delete these notes and their generated flashcards and practice questions?')) break;
					await api(`/notes/${button.dataset.id}`, { method: 'DELETE' });
					$('#note-detail').classList.add('hidden');
					await Promise.all([loadNotes(), loadDashboard()]);
					showToast('Saved notes deleted.');
					break;
				case 'delete-flashcard-set':
					if (!window.confirm('Delete this flashcard set?')) break;
					await api(`/flashcards/${button.dataset.id}`, { method: 'DELETE' });
					if (String(state.activeFlashcardSet?.id) === button.dataset.id) {
						state.activeFlashcardSet = null;
						state.flashcards = { cards: [], index: 0, flipped: false };
						renderFlashcard();
					}
					await loadFlashcardLibrary();
					showToast('Flashcard set deleted.');
					break;
				case 'delete-exam':
					if (!window.confirm('Delete this exam and its saved answers?')) break;
					await api(`/exams/${button.dataset.id}`, { method: 'DELETE' });
					if (String(state.activeExam?.id) === button.dataset.id) {
						stopExamTimer();
						state.activeExam = null;
						$('#exam-stage').classList.add('hidden');
					}
					await Promise.all([loadExamLibrary(), loadDashboard()]);
					showToast('Exam deleted.');
					break;
				case 'delete-revision':
					if (!window.confirm('Delete this revision task?')) break;
					await api(`/revision/${button.dataset.id}`, { method: 'DELETE' });
					await Promise.all([loadRevisionTasks(), loadDashboard()]);
					showToast('Revision task deleted.');
					break;
				case 'delete-mistake':
					if (!window.confirm('Delete this saved mistake?')) break;
					await api(`/mistakes/${button.dataset.id}`, { method: 'DELETE' });
					await Promise.all([loadMistakes(), loadDashboard()]);
					showToast('Mistake deleted.');
					break;
				case 'rename-subject':
				case 'delete-subject':
				case 'rename-topic':
				case 'delete-topic':
					await handleSyllabusAction(button);
					break;
				case 'flip-card':
					state.flashcards.flipped = !state.flashcards.flipped;
					renderFlashcard();
					break;
				case 'previous-card':
					state.flashcards.index = Math.max(0, state.flashcards.index - 1);
					state.flashcards.flipped = false;
					renderFlashcard();
					break;
				case 'next-card':
					state.flashcards.index = Math.min(state.flashcards.cards.length - 1, state.flashcards.index + 1);
					state.flashcards.flipped = false;
					renderFlashcard();
					break;
				case 'submit-question-set':
					await submitQuestionSet();
					break;
				case 'generate-more-questions':
					showView('practice');
					$('#practice-form').requestSubmit();
					break;
				case 'practice-from-flashcard-set':
					startPracticeFromFlashcardSet();
					break;
				case 'submit-exam':
					await submitExam();
					break;
				case 'generate-flashcards-from-note': {
					showView('flashcards');
					const sourceSelect = $('#flashcard-source');
					sourceSelect.value = `note:${button.dataset.noteId}`;
					if (!sourceSelect.value) {
						showToast('This note is no longer available.');
						break;
					}
					$('#flashcard-form').requestSubmit();
					break;
				}
				case 'generate-questions-from-note':
					startPracticeFromNote(button.dataset.noteId);
					break;
			}
		} catch (error) {
			showToast(error.message);
		}
	}
	const noteButton = event.target.closest('[data-open-note]');
	if (noteButton) {
		const note = state.notes.find(item => String(item.id) === noteButton.dataset.openNote);
		if (note) renderNoteDetail(note);
	}
	const setButton = event.target.closest('[data-open-flashcard-set]');
	if (setButton) openFlashcardSet(setButton.dataset.openFlashcardSet);
	const examButton = event.target.closest('[data-open-exam]');
	if (examButton) openExam(examButton.dataset.openExam);
	const resolveButton = event.target.closest('[data-resolve-mistake]');
	if (resolveButton) {
		try {
			await api(`/mistakes/${resolveButton.dataset.resolveMistake}`, { method: 'PATCH', body: JSON.stringify({ resolved: true }) });
			await Promise.all([loadMistakes(), loadDashboard()]);
			showToast('Mistake marked resolved.');
		} catch (error) {
			showToast(error.message);
		}
	}
	const revisionButton = event.target.closest('[data-complete-revision]');
	if (revisionButton) {
		try {
			await api(`/revision/${revisionButton.dataset.completeRevision}/complete`, { method: 'PATCH', body: '{}' });
			await loadRevisionTasks();
			showToast('Revision task completed.');
		} catch (error) {
			showToast(error.message);
		}
	}
});

document.addEventListener('change', async event => {
	if (event.target.matches('[data-topic-status]')) {
		try {
			await api(`/topics/${event.target.dataset.topicStatus}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) });
			await Promise.all([loadSubjects(), loadDashboard()]);
		} catch (error) {
			showToast(error.message);
		}
	}
	if (event.target.matches('#mistake-subject, #mistake-status')) loadMistakes();
});

$('#subject-form').addEventListener('submit', handleSubjectSubmit);
$('#topic-form').addEventListener('submit', handleTopicSubmit);
$('#notes-form').addEventListener('submit', handleNotesSubmit);
$('#flashcard-form').addEventListener('submit', handleFlashcardSubmit);
$('#practice-form').addEventListener('submit', handlePracticeSubmit);
$('#exam-form').addEventListener('submit', handleExamSubmit);
$('#api-key-form').addEventListener('submit', event => {
	event.preventDefault();
	const key = $('#groq-api-key').value.trim();
	if (!key) {
		showToast('Enter your Groq API key first.');
		return;
	}
	localStorage.setItem('oryn.groqApiKey', key);
	state.groqApiKey = key;
	$('#groq-api-key').value = '';
	updateApiKeyStatus('Your Groq API key is saved in this browser.', 'success');
	showToast('Groq API key saved in this browser.');
});
$('#test-api-key').addEventListener('click', async event => {
	const button = event.currentTarget;
	button.disabled = true;
	try {
		if (!state.groqApiKey) throw new Error('Save your Groq API key in this browser first.');
		const result = await api('/test-ai');
		updateApiKeyStatus(result.response || 'Groq connection successful.', 'success');
	} catch (error) {
		updateApiKeyStatus(error.message, 'error');
	} finally {
		button.disabled = false;
	}
});
$('#remove-api-key').addEventListener('click', () => {
	localStorage.removeItem('oryn.groqApiKey');
	state.groqApiKey = '';
	$('#groq-api-key').value = '';
	updateApiKeyStatus('No browser key saved. The server may still use its own configured key.', '');
	showToast('Browser API key removed.');
});
$('#generate-revision').addEventListener('click', generateRevisionPlan);
$('#back-navigation').addEventListener('click', navigateBack);
$('#home-navigation').addEventListener('click', () => {
	if (state.akuebMode) setAkuebMode(false);
	showView('dashboard');
});
$('#akueb-mode-toggle').addEventListener('click', () => setAkuebMode(!state.akuebMode));
$('#assistant-launcher').addEventListener('click', openAssistantPreview);
$('#assistant-close').addEventListener('click', () => $('#assistant-dialog').close());
$('#assistant-dialog').addEventListener('click', event => {
	if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#reset-workspace').addEventListener('click', async event => {
	if (!window.confirm('Reset Oryn AI and permanently delete all saved subjects, notes, flashcards, questions, exams, mistakes, study history, and revision tasks? This cannot be undone.')) return;
	const button = event.currentTarget;
	button.disabled = true;
	try {
		await api('/workspace', { method: 'DELETE' });
		stopExamTimer();
		window.location.reload();
	} catch (error) {
		button.disabled = false;
		showToast(error.message);
	}
});
$('#revision-syllabus-file').addEventListener('change', handleRevisionSyllabusUpload);
function updateApiKeyStatus(message, status) {
	const element = $('#api-key-status');
	element.textContent = message;
	element.dataset.status = status;
}

updateApiKeyStatus(
	state.groqApiKey
		? 'A Groq API key is saved in this browser.'
		: 'No browser key saved. The server may still use its own configured key.',
	state.groqApiKey ? 'success' : ''
);
$('#revision-select-all-notes').addEventListener('change', event => {
	$$('input[name="revision-note"]').forEach(input => { input.checked = event.currentTarget.checked; });
});
$('#revision-select-all-exams').addEventListener('change', event => {
	$$('input[name="revision-exam"]').forEach(input => { input.checked = event.currentTarget.checked; });
});
$('#review-submitted-exam').addEventListener('click', () => {
	$('#exam-submitted-dialog').close();
	$('#exam-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
Promise.all([loadSubjects(), loadNotes(), loadDashboard()]);