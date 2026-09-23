const materialForm = document.querySelector('#materialForm');
const materialInput = document.querySelector('#materialInput');
const fileInput = document.querySelector('#fileInput');
const characterCount = document.querySelector('#characterCount');
const selectedFile = document.querySelector('#selectedFile');
const formError = document.querySelector('#formError');
const analyzeButton = document.querySelector('#analyzeButton');
const toast = document.querySelector('#toast');
let currentStudySet = null;
let activeFlashcard = 0;
let answeredQuestions = 0;

loadRecentStudySets();

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
document.querySelector('#newSetButton').addEventListener('click', () => {
	showView('overview');
	document.querySelector('#createSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
	materialInput.focus();
});
document.querySelector('#viewAllButton').addEventListener('click', () => showToast('Your study history will appear here after your first set.'));

materialInput.addEventListener('input', () => {
	characterCount.textContent = `${materialInput.value.length.toLocaleString()} characters`;
});

fileInput.addEventListener('change', () => {
	const file = fileInput.files[0];
	selectedFile.hidden = !file;
	if (file) selectedFile.innerHTML = `<span>↗</span> ${escapeHtml(file.name)} <button type="button" aria-label="Remove file">×</button>`;
	selectedFile.querySelector('button')?.addEventListener('click', () => { fileInput.value = ''; selectedFile.hidden = true; });
});

materialForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	formError.textContent = '';
	if (!materialInput.value.trim() && !fileInput.files[0]) {
		formError.textContent = 'Add some notes or attach a study file first.';
		return;
	}

	const formData = new FormData(materialForm);
	setLoading(true, 'Finding the important ideas...');
	try {
		const response = await fetch('/api/analyze', { method: 'POST', body: formData });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error || 'Something went wrong.');
		currentStudySet = data;
		activeFlashcard = 0;
		answeredQuestions = 0;
		renderStudySet(data);
		showToast('Your study set is ready.');
		showView('flashcards');
	} catch (error) {
		formError.textContent = error.message;
	} finally {
		setLoading(false);
	}
});

function showView(viewName) {
	document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}View`));
	document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadRecentStudySets() {
	try {
		const response = await fetch('/api/study-sets');
		if (!response.ok) throw new Error('Could not load saved study sets.');
		renderRecentStudySets(await response.json());
	} catch (error) {
		console.warn(error.message);
	}
}

function renderRecentStudySets(studySets) {
	const recentSets = document.querySelector('#recentSets');
	if (!studySets.length) {
		recentSets.className = 'empty-recent';
		recentSets.innerHTML = '<div class="empty-icon">✦</div><p>Your first study set will live here.</p><small>It only takes a few notes to get started.</small>';
		return;
	}
	recentSets.className = 'recent-grid';
	recentSets.innerHTML = studySets.map((studySet) => `<article class="recent-card" data-set-id="${studySet.id}"><button class="recent-open" type="button"><span class="recent-card-icon">✦</span><span class="recent-card-title">${escapeHtml(studySet.title)}</span><span class="recent-card-meta">${studySet.flashcardCount} cards · ${studySet.questionCount} questions</span></button><button class="recent-delete" type="button" title="Delete study set" aria-label="Delete ${escapeHtml(studySet.title)}">×</button></article>`).join('');
	recentSets.querySelectorAll('.recent-open').forEach((button) => button.addEventListener('click', () => openSavedStudySet(button.closest('[data-set-id]').dataset.setId)));
	recentSets.querySelectorAll('.recent-delete').forEach((button) => button.addEventListener('click', () => deleteSavedStudySet(button.closest('[data-set-id]').dataset.setId, button)));
}

async function deleteSavedStudySet(id, button) {
	const card = button.closest('[data-set-id]');
	const title = card.querySelector('.recent-card-title').textContent;
	if (!window.confirm(`Delete "${title}"? This will remove its flashcards and practice history.`)) return;
	button.disabled = true;
	try {
		const response = await fetch(`/api/study-sets/${id}`, { method: 'DELETE' });
		if (!response.ok) throw new Error('Could not delete this study set.');
		card.remove();
		if (!document.querySelector('.recent-card')) renderRecentStudySets([]);
		showToast('Study set deleted.');
	} catch (error) {
		button.disabled = false;
		showToast(error.message);
	}
}

async function openSavedStudySet(id) {
	try {
		const response = await fetch(`/api/study-sets/${id}`);
		if (!response.ok) throw new Error('Could not open this study set.');
		currentStudySet = await response.json();
		activeFlashcard = 0;
		answeredQuestions = 0;
		renderStudySet(currentStudySet);
		showView('flashcards');
	} catch (error) {
		showToast(error.message);
	}
}

function setLoading(isLoading, label = 'Build my study set') {
	analyzeButton.disabled = isLoading;
	analyzeButton.querySelector('span:first-child').textContent = label;
	analyzeButton.querySelector('.button-arrow').textContent = isLoading ? '…' : '→';
}

function renderStudySet(studySet) {
	document.querySelector('#flashcardTitle').textContent = studySet.title || 'Your study set';
	document.querySelector('#flashcardContent').innerHTML = `<div class="deck-meta"><span>${studySet.flashcards.length} cards</span><span>·</span><span>${studySet.concepts.length} key concepts</span></div><div class="flashcard-progress"><span style="width:${100 / studySet.flashcards.length}%"></span></div><article class="flashcard" id="flashcard"><div class="card-face front"><span class="card-label">TERM / QUESTION</span><h3></h3><small>Click to reveal answer</small></div><div class="card-face back"><span class="card-label">ANSWER</span><p></p><small>Click to return</small></div></article><div class="card-controls"><button class="subtle-button" id="previousCard">← Previous</button><strong id="cardCounter">1 / ${studySet.flashcards.length}</strong><button class="primary-button compact" id="nextCard">Next card <span>→</span></button></div><div class="concept-strip"><span class="sun-label">KEY CONCEPTS</span><div>${studySet.concepts.map((concept) => `<span class="concept-pill">${escapeHtml(concept.name)}</span>`).join('')}</div></div>`;
	updateFlashcard();
	document.querySelector('#flashcard').addEventListener('click', (event) => { if (!event.target.closest('button')) event.currentTarget.classList.toggle('flipped'); });
	document.querySelector('#previousCard').addEventListener('click', () => moveCard(-1));
	document.querySelector('#nextCard').addEventListener('click', () => moveCard(1));
	renderPractice(studySet);
}

function updateFlashcard() {
	const card = currentStudySet.flashcards[activeFlashcard];
	const flashcard = document.querySelector('#flashcard');
	if (!card || !flashcard) return;
	flashcard.classList.remove('flipped');
	flashcard.querySelector('.front h3').textContent = card.front;
	flashcard.querySelector('.back p').textContent = card.back || card.description || 'Review this concept in your notes.';
	document.querySelector('#cardCounter').textContent = `${activeFlashcard + 1} / ${currentStudySet.flashcards.length}`;
	document.querySelector('.flashcard-progress span').style.width = `${((activeFlashcard + 1) / currentStudySet.flashcards.length) * 100}%`;
}

function moveCard(direction) {
	activeFlashcard = (activeFlashcard + direction + currentStudySet.flashcards.length) % currentStudySet.flashcards.length;
	updateFlashcard();
}

function renderPractice(studySet) {
	const weakAreas = (studySet.weakAreas || []).map((area) => typeof area === 'string' ? area : area.topic || area.name || area.description).filter(Boolean);
	document.querySelector('#practiceContent').innerHTML = `<div class="practice-intro"><p>${escapeHtml(studySet.summary || 'Choose an answer for every question, then submit once to get explanations and a personalized review plan.')}</p><span class="score-chip" id="scoreChip">0 / ${studySet.questions.length} answered</span></div><div class="question-list">${studySet.questions.map((question, index) => `<article class="question-card" data-question-index="${index}"><div class="question-top"><span>0${index + 1}</span><span class="difficulty ${question.difficulty}">${question.difficulty}</span></div><h3>${escapeHtml(question.question)}</h3><div class="mcq-options">${getQuestionOptions(question).map((option, optionIndex) => `<label class="mcq-option"><input type="radio" name="question-${question.id || index}" value="${escapeHtml(option)}" data-option-index="${optionIndex}"><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span></label>`).join('')}</div><div class="feedback" hidden></div></article>`).join('')}</div><button class="primary-button submit-practice" id="submitPracticeButton">Submit all answers <span>→</span></button><div class="practice-overview" id="practiceOverview" hidden></div><div class="weak-areas"><span class="sun-label">AREAS TO REVISIT</span><div>${weakAreas.map((area) => `<span class="weak-pill">↗ ${escapeHtml(area)}</span>`).join('')}</div></div>`;
	document.querySelectorAll('.mcq-option input').forEach((input) => input.addEventListener('change', updateAnswerCount));
	document.querySelector('#submitPracticeButton').addEventListener('click', submitPractice);
}

function updateAnswerCount() {
	const answered = [...document.querySelectorAll('.question-card')].filter((card) => card.querySelector('input:checked')).length;
	document.querySelector('#scoreChip').textContent = `${answered} / ${currentStudySet.questions.length} answered`;
}

async function submitPractice() {
	const button = document.querySelector('#submitPracticeButton');
	const cards = [...document.querySelectorAll('.question-card')];
	const answers = cards.map((card, index) => {
		const selected = card.querySelector('input[type="radio"]:checked');
		return { questionId: currentStudySet.questions[index].id, optionIndex: selected ? Number(selected.dataset.optionIndex) : -1, studentAnswer: selected?.value || '' };
	});
	if (answers.some((answer) => !answer.studentAnswer)) {
		showToast('Choose an option for every question before submitting.');
		cards.find((card) => !card.querySelector('input:checked'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		return;
	}
	button.disabled = true;
	button.querySelector('span').textContent = '…';
	try {
		const response = await fetch('/api/evaluate-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studySetId: currentStudySet.id, answers }) });
		const result = await response.json();
		if (!response.ok) throw new Error(result.error);
		renderEvaluationResults(result);
		showToast('Your practice review is ready.');
	} catch (error) { showToast(error.message); }
	button.disabled = false;
	button.querySelector('span').textContent = '→';
}

function getQuestionOptions(question) {
	if (Array.isArray(question.options) && question.options.length === 4) return question.options;
	return [question.answer, 'A different concept from the study material', 'This is not related to the question', 'None of the listed ideas'];
}

function renderEvaluationResults(result) {
	const overview = result.overview || {};
	const overviewElement = document.querySelector('#practiceOverview');
	overviewElement.hidden = false;
	const correctCount = Number.isFinite(Number(overview.correctCount)) ? overview.correctCount : (result.evaluations || []).filter((evaluation) => evaluation.correct).length;
	const totalQuestions = overview.totalQuestions || currentStudySet.questions.length;
	overviewElement.innerHTML = `<div class="overview-score"><span class="sun-label">PRACTICE REVIEW</span><strong>${correctCount}<small>/${totalQuestions}</small></strong><p>${correctCount === totalQuestions ? 'Perfect score' : correctCount >= Math.ceil(totalQuestions * .6) ? 'Good foundation, with a few gaps' : 'A focused review will help you improve'}</p></div><div class="overview-column"><span class="overview-label">WHAT YOU KNOW</span><ul>${(overview.strengths || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Keep practicing to build your strengths.</li>'}</ul></div><div class="overview-column revisit"><span class="overview-label">REVISIT THESE TOPICS</span><ul>${(overview.weakTopics || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>No major gaps found in this attempt.</li>'}</ul></div><div class="overview-recommendation"><span class="overview-label">YOUR NEXT STEP</span><p>${escapeHtml((overview.recommendations || ['Review the topics you missed and try again.'])[0])}</p></div>`;
	(result.evaluations || []).forEach((evaluation, index) => {
		const feedback = document.querySelectorAll('.question-card .feedback')[index];
		feedback.hidden = false;
		feedback.className = `feedback ${evaluation.correct ? 'correct' : 'needs-work'}`;
		feedback.innerHTML = `<strong>${evaluation.correct ? 'Correct.' : 'Not quite.'}</strong><p>${escapeHtml(evaluation.feedback)}</p>${evaluation.correction ? `<small><b>Remember:</b> ${escapeHtml(evaluation.correction)}</small>` : ''}<small><b>Next:</b> ${escapeHtml(evaluation.nextStep)}</small>`;
	});
	overviewElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showToast(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
