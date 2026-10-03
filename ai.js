const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

async function generateAI(prompt) {
	const apiKey = process.env.GROQ_API_KEY;

	if (!apiKey) {
		throw new Error('GROQ_API_KEY is not set. Add it to the server environment before calling generateAI.');
	}

	let response;

	try {
		response = await fetch(GROQ_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: MODEL,
				messages: [{ role: 'user', content: prompt }],
				temperature: 0.2,
				seed: 1
			})
		});
	} catch {
		throw new Error('Unable to connect to the Groq API. Check the server network connection and try again.');
	}

	if (!response.ok) {
		throw new Error(`Groq API request failed with status ${response.status}.`);
	}

	let data;

	try {
		data = await response.json();
	} catch {
		throw new Error('Groq API returned an invalid JSON response.');
	}

	const generatedText = data.choices?.[0]?.message?.content;

	if (typeof generatedText !== 'string') {
		throw new Error('Groq API response did not include generated text.');
	}

	return generatedText;
}

module.exports = { generateAI };