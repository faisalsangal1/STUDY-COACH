require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { deleteStudySet, getRecentStudySets, getStudySet, saveEvaluation, saveStudySet } = require('./db');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    database: true,
  });
});

app.get('/api/study-sets', async (_request, response) => {
  response.json(await getRecentStudySets());
});

app.get('/api/study-sets/:id', async (request, response) => {
  const studySet = await getStudySet(request.params.id);
  if (!studySet) return response.status(404).json({ error: 'Study set not found.' });
  return response.json(studySet);
});

app.delete('/api/study-sets/:id', async (request, response) => {
  if (!await deleteStudySet(request.params.id)) return response.status(404).json({ error: 'Study set not found.' });
  return response.status(204).end();
});

app.post('/api/evaluate-all', async (request, response) => {
  const { studySetId, answers } = request.body;
  const studySet = studySetId ? await getStudySet(studySetId) : null;
  if (!studySet) return response.status(404).json({ error: 'Study set not found.' });
  if (!Array.isArray(answers) || answers.length !== studySet.questions.length || answers.some((item) => !String(item.studentAnswer || '').trim())) {
    return response.status(400).json({ error: 'Answer every question before submitting.' });
  }

  const answerRows = studySet.questions.map((question) => {
    const submitted = answers.find((item) => Number(item.questionId) === Number(question.id)) || answers[studySet.questions.indexOf(question)];
    return { questionId: question.id, question: question.question, options: question.options || [], expectedAnswer: question.answer, explanation: question.explanation, selectedOptionIndex: Number(submitted?.optionIndex), studentAnswer: String(submitted?.studentAnswer || '').trim() };
  });

  try {
    const result = await generateWithRetry({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: `Evaluate every student answer below against its reference answer. Grade understanding, not exact wording. Return ONLY valid JSON in exactly this shape:
{
  "evaluations": [{ "questionId": 0, "correct": true, "score": 0, "feedback": "brief specific feedback", "correction": "key idea to remember", "nextStep": "focused action" }],
  "overview": { "score": 0, "strengths": ["topic understood"], "weakTopics": ["topic to revisit"], "recommendations": ["specific study recommendation"] }
}

Use the numeric questionId provided. Score each answer from 0 to 100 using this fair rubric:
- 85-100: correct concept and enough important detail, even if phrased differently from the reference.
- 65-84: mostly correct understanding with a minor omission or imprecise detail.
- 40-64: partial understanding or one correct part, but a meaningful gap remains.
- 1-39: a small relevant idea but mostly incorrect or too incomplete.
- 0: blank, irrelevant, or contradictory answer.
Grade the selected multiple-choice option. Compare the selected option with the correct answer and options, not with exact wording from a flashcard. Explain why the selected option is correct or incorrect. Use the supplied question explanation when useful.

${JSON.stringify(answerRows)}` }] }],
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    const payload = JSON.parse(result.text.trim());
    return await saveBatchEvaluation(response, studySet, answerRows, payload);
  } catch (error) {
    console.error('Batch answer evaluation failed:', error.message);
    const evaluations = answerRows.map((row) => ({ questionId: row.questionId, ...createFallbackEvaluation(row.expectedAnswer, row.studentAnswer, row.question) }));
    const overview = createFallbackOverview(studySet, evaluations);
    return await saveBatchEvaluation(response, studySet, answerRows, { evaluations, overview, usedFallback: true });
  }
});

app.post('/api/analyze', upload.single('file'), async (request, response) => {
  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  const material = request.body.material?.trim();
  const file = request.file;

  if (!material && !file) {
    return response.status(400).json({ error: 'Add study material or upload a PDF/image.' });
  }

  if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    return response.status(400).json({ error: 'Only PDF, JPG, PNG, and WEBP files are supported.' });
  }

  try {
    const prompt = `You are Study Coach, an adaptive study assistant. Analyze the supplied study material and return ONLY valid JSON.

Create a useful first study set for a student. Keep explanations clear and grounded in the material. Return exactly this shape:
{
  "title": "short study set title",
  "summary": "2-3 sentence overview",
  "concepts": [{ "name": "concept", "description": "what it means", "importance": "high|medium|low" }],
  "flashcards": [{ "front": "question or term", "back": "concise answer" }],
  "questions": [{ "question": "multiple-choice question", "options": ["option A", "option B", "option C", "option D"], "correctOptionIndex": 0, "answer": "correct option text", "explanation": "why the correct option is correct", "difficulty": "easy|medium|hard" }],
  "weakAreas": ["topic the student should revisit"]
}

First identify every distinct teachable idea in the material: definitions, parts, steps, mechanisms, relationships, comparisons, examples, formulas, exceptions, and common misconceptions. Then generate enough flashcards and MCQs to teach and test all of those ideas. Create at least one flashcard for each important atomic idea and at least one MCQ for each major idea; add more when an idea has multiple steps, parts, applications, or likely misunderstandings. There is no fixed target, minimum maximum, or default count to follow: a simple topic may need only a few items, while a complex topic must receive as many different cards and MCQs as needed for complete coverage. Never stop at five just because five items have been generated. Avoid repetition and do not invent facts that are not supported by the material. Every question must have exactly four plausible options, one unambiguous correctOptionIndex from 0 to 3, and an explanation. Generate enough concepts to represent the material and up to 5 likely weak areas.

${material ? `Pasted material:\n${material}` : 'The attached file is the study material.'}`;

    const parts = [{ text: prompt }];
    if (file) {
      parts.push({
        inline_data: {
          mime_type: file.mimetype,
          data: file.buffer.toString('base64'),
        },
      });
    }

    const result = await generateWithRetry({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    });

    const text = result.text?.trim();
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }

    const studySet = JSON.parse(text);
    const id = await saveStudySet(studySet, file?.originalname || 'Pasted material');
    return response.json({ ...studySet, id });
  } catch (error) {
    console.error('Study material analysis failed:', error.message);
    return response.status(502).json({ error: getGeminiErrorMessage(error) });
  }
});

app.post('/api/evaluate', async (request, response) => {
  const { studySetId, questionId, question: submittedQuestion, expectedAnswer: submittedAnswer, studentAnswer } = request.body;
  const savedStudySet = studySetId ? await getStudySet(studySetId) : null;
  const savedQuestion = savedStudySet?.questions.find((item) => Number(item.id) === Number(questionId));
  const question = savedQuestion?.question || submittedQuestion;
  const expectedAnswer = savedQuestion?.answer || submittedAnswer;

  if (!question || !expectedAnswer || !studentAnswer?.trim()) {
    return response.status(400).json({ error: 'A question and answer are required.' });
  }

  try {
    const result = await generateWithRetry({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: `Evaluate a student's answer using only the question and reference answer below. Return ONLY valid JSON in this shape: { "correct": true, "score": 0, "feedback": "brief helpful feedback", "correction": "the key idea to remember", "nextStep": "one focused study action" }.

Question: ${question}
Reference answer: ${expectedAnswer}
Student answer: ${studentAnswer}

Judge meaning, not word-for-word similarity. Accept concise answers, synonyms, and paraphrases. If the essential concept is correct, use at least 70/100 and set correct to true. Reserve scores below 40 for irrelevant or contradictory answers.` }] }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const evaluation = normalizeEvaluation(JSON.parse(result.text.trim()));
    if (studySetId && questionId) await saveEvaluation(studySetId, questionId, evaluation, studentAnswer.trim());
    return response.json(evaluation);
  } catch (error) {
    console.error('Answer evaluation failed:', error.message);
    const fallback = createFallbackEvaluation(expectedAnswer, studentAnswer, question);
    if (studySetId && questionId) await saveEvaluation(studySetId, questionId, fallback, studentAnswer.trim());
    return response.json({ ...fallback, usedFallback: true });
  }
});

function getGeminiErrorMessage(error) {
  const message = error?.message || '';
  if (message.includes('API key')) return 'Gemini rejected the API key. Check the GEMINI_API_KEY in .env.';
  if (message.includes('404') || message.includes('not available')) return 'The configured Gemini model is unavailable for this API key.';
  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) return 'Gemini is temporarily out of free requests. Please wait a moment and try again.';
  if (message.includes('fetch failed') || message.includes('ECONNRESET')) return 'Gemini could not be reached. Check your internet connection and try again.';
  if (message.includes('400') || message.includes('INVALID_ARGUMENT')) return 'Gemini could not read this material. Try a smaller or clearer file.';
  return 'Gemini could not analyze this material. Please try again.';
}

function normalizeEvaluation(evaluation) {
  const score = Number(evaluation.score);
  return {
    ...evaluation,
    score: Number.isFinite(score) && score <= 1 ? Math.round(score * 100) : Math.max(0, Math.min(100, Math.round(score || 0))),
  };
}

function createFallbackEvaluation(expectedAnswer, studentAnswer, question = '') {
  const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'they', 'their', 'are', 'can', 'will', 'when', 'what', 'which', 'where', 'how', 'does', 'used', 'use', 'also', 'during', 'main', 'primary']);
  const synonyms = { absorb: 'capture', absorbs: 'capture', absorbing: 'capture', captured: 'capture', trapping: 'capture', trap: 'capture', traps: 'capture', energy: 'energy', energies: 'energy', cells: 'cell', reactions: 'reaction', pores: 'pore' };
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).map((word) => synonyms[word] || word.replace(/(ing|ed|s)$/i, '')).filter((word) => word.length > 2 && !stopWords.has(word));
  const expectedWords = new Set(normalize(expectedAnswer));
  const questionWords = new Set(normalize(question || '').filter((word) => word.length > 4));
  const studentWords = normalize(studentAnswer);
  const expectedMatches = studentWords.filter((word) => expectedWords.has(word)).length;
  const contextMatches = studentWords.filter((word) => questionWords.has(word)).length;
  const answerCoverage = expectedMatches / Math.max(1, expectedWords.size);
  const contextCoverage = contextMatches / Math.max(1, questionWords.size);
  const conceptCredit = expectedWords.size <= 2 && contextCoverage >= 0.4 ? 50 : 0;
  const score = Math.min(95, Math.max(15, Math.round(20 + (answerCoverage * 55) + (contextCoverage * 35) + conceptCredit)));
  const correct = score >= 60;
  return {
    correct,
    score,
    feedback: correct ? 'Your answer includes the key idea from the reference answer.' : 'Your answer needs more of the key ideas from the reference answer.',
    correction: `Reference answer: ${expectedAnswer}`,
    nextStep: correct ? 'Try the next question.' : 'Review the reference answer, then try this question again.',
  };
}

function createFallbackOverview(studySet, evaluations) {
  const score = Math.round(evaluations.reduce((total, evaluation) => total + evaluation.score, 0) / Math.max(1, evaluations.length));
  const weakTopics = evaluations.filter((evaluation) => !evaluation.correct).map((evaluation) => studySet.questions.find((question) => question.id === evaluation.questionId)?.question || 'Missed question');
  return {
    score,
    strengths: evaluations.filter((evaluation) => evaluation.correct).map((evaluation) => studySet.questions.find((question) => question.id === evaluation.questionId)?.question || 'Correct answers').slice(0, 3),
    weakTopics: weakTopics.slice(0, 5),
    recommendations: weakTopics.length ? ['Review the reference answers for the missed questions, then retry them.'] : ['Keep practicing with harder questions to deepen your understanding.'],
  };
}

async function saveBatchEvaluation(response, studySet, answerRows, payload) {
  const evaluationMap = new Map((payload.evaluations || []).map((evaluation) => [Number(evaluation.questionId), normalizeEvaluation(evaluation)]));
  const evaluations = answerRows.map((row) => ({ questionId: row.questionId, ...(evaluationMap.get(Number(row.questionId)) || createFallbackEvaluation(row.expectedAnswer, row.studentAnswer, row.question)) }));
  await Promise.all(evaluations.map((evaluation, index) => saveEvaluation(studySet.id, evaluation.questionId, evaluation, answerRows[index].studentAnswer)));
  const correctCount = evaluations.filter((evaluation) => evaluation.correct).length;
  const overview = { ...(payload.overview || createFallbackOverview(studySet, evaluations)), correctCount, totalQuestions: evaluations.length };
  return response.json({ evaluations, overview, usedFallback: Boolean(payload.usedFallback) });
}

async function generateWithRetry(request) {
  let lastError;
  const models = [...new Set([request.model, 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'])];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await Promise.race([
          generateWithRestApi({ ...request, model }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini request timed out.')), 45000)),
        ]);
      } catch (error) {
        lastError = error;
        const message = error?.message || '';
        const isTransient = message.includes('fetch failed') || message.includes('ECONNRESET') || message.includes('503') || message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('timed out');
        if (!isTransient) throw error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

async function generateWithRestApi(request) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: request.contents,
      generationConfig: request.config,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return { text };
}

app.use((error, _request, response, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'That file is larger than the 10MB limit.' });
  if (error?.name === 'SyntaxError') return response.status(400).json({ error: 'The request body was not valid JSON.' });
  return next(error);
});

app.listen(port, () => {
  console.log(`Study Coach is running at http://localhost:${port}`);
});