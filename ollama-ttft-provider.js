/**
 * promptfoo custom provider for ollama
 * Captures TTFT (time-to-first-token) and prompt_eval_duration
 * from ollama streaming API alongside normal promptfoo response.
 *
 * Optional config fields:
 *   baseUrl: http://localhost:11434   (or set OLLAMA_BASE_URL env var)
 *   temperature: 0.0
 *   num_predict: 512                  (max completion tokens)
 */

const http = require('http');
const https = require('https');

/**
 * Parse a newline-delimited JSON stream from ollama /api/chat
 * Resolves with { output, ttftMs, promptEvalDurationMs, evalDurationMs, promptEvalCount, evalCount }
 */
function streamOllamaChat({ baseUrl, model, messages, options = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/chat', baseUrl);
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      options,
    });

    const lib = url.protocol === 'https:' ? https : http;
    const reqStartMs = Date.now();
    let ttftMs = null;
    let output = '';
    let finalChunk = null;
    let buffer = '';

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama returned HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          // Keep the last (potentially incomplete) line in the buffer
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch {
              continue;
            }

            if (!parsed.done) {
              // First content chunk — record TTFT
              if (ttftMs === null) {
                ttftMs = Date.now() - reqStartMs;
              }
              output += parsed.message?.content ?? '';
            } else {
              // done: true — ollama timing metadata is here
              finalChunk = parsed;
            }
          }
        });

        res.on('end', () => {
          if (!finalChunk) {
            reject(new Error('Stream ended without done:true chunk'));
            return;
          }

          // ollama reports durations in nanoseconds
          const ns = 1_000_000; // ns → ms
          resolve({
            output,
            ttftMs,
            promptEvalDurationMs: finalChunk.prompt_eval_duration
              ? Math.round(finalChunk.prompt_eval_duration / ns)
              : null,
            evalDurationMs: finalChunk.eval_duration
              ? Math.round(finalChunk.eval_duration / ns)
              : null,
            promptEvalCount: finalChunk.prompt_eval_count ?? null,
            evalCount: finalChunk.eval_count ?? null,
            totalDurationMs: finalChunk.total_duration
              ? Math.round(finalChunk.total_duration / ns)
              : null,
          });
        });

        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Unload a model from VRAM by sending a keep_alive: 0 request.
 * This ensures the next callApi measures a true cold-start TTFT.
 */
function unloadModel({ baseUrl, model }) {
  return new Promise((resolve) => {
    const url = new URL('/api/chat', baseUrl);
    const body = JSON.stringify({ model, messages: [], keep_alive: 0 });
    const lib = url.protocol === 'https:' ? require('https') : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', resolve); // ignore errors — best effort
    req.write(body);
    req.end();
  });
}

/**
 * Convert a promptfoo prompt (string or OpenAI message array) into
 * the messages array ollama expects.
 */
function toMessages(prompt, config) {
  // promptfoo passes the rendered prompt as a string or JSON string
  let messages;
  if (typeof prompt === 'string') {
    try {
      const parsed = JSON.parse(prompt);
      if (Array.isArray(parsed)) {
        messages = parsed; // already an OpenAI-format message array
      } else {
        messages = [{ role: 'user', content: prompt }];
      }
    } catch {
      messages = [{ role: 'user', content: prompt }];
    }
  } else if (Array.isArray(prompt)) {
    messages = prompt;
  } else {
    messages = [{ role: 'user', content: String(prompt) }];
  }

  // Prepend system prompt from config if present and not already in messages
  if (config.system && !messages.find((m) => m.role === 'system')) {
    messages = [{ role: 'system', content: config.system }, ...messages];
  }

  return messages;
}

class OllamaTTFTProvider {
  constructor(options) {
    this.providerId = options.id ?? 'ollama-ttft-provider';
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const {
      model,
      baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      system,
      temperature,
      num_predict,
      coldStart = false,
      ...extraOptions
    } = this.config;

    if (!model) {
      throw new Error('ollama-ttft-provider: config.model is required');
    }

    if (coldStart) {
      await unloadModel({ baseUrl, model });
    }

    const messages = toMessages(prompt, this.config);

    // Build ollama options block (model parameters)
    const ollamaOptions = {};
    if (temperature !== undefined) ollamaOptions.temperature = temperature;
    if (num_predict !== undefined) ollamaOptions.num_predict = num_predict;
    Object.assign(ollamaOptions, extraOptions);

    let result;
    try {
      result = await streamOllamaChat({
        baseUrl,
        model,
        messages,
        options: ollamaOptions,
      });
    } catch (err) {
      return { error: `Ollama request failed: ${err.message}` };
    }

    const {
      output,
      ttftMs,
      promptEvalDurationMs,
      evalDurationMs,
      promptEvalCount,
      evalCount,
      totalDurationMs,
    } = result;

    // Derive tokens/sec where possible
    const decodeTps =
      evalCount && evalDurationMs
        ? Math.round((evalCount / evalDurationMs) * 1000)
        : null;

    const prefillTps =
      promptEvalCount && promptEvalDurationMs
        ? Math.round((promptEvalCount / promptEvalDurationMs) * 1000)
        : null;

    return {
      // Required by promptfoo
      output,

      // Token usage — promptfoo records these in results
      tokenUsage: {
        prompt: promptEvalCount ?? 0,
        completion: evalCount ?? 0,
        total: (promptEvalCount ?? 0) + (evalCount ?? 0),
      },

      // Metadata — appears in results[].metadata and is queryable
      metadata: {
        ttftMs,                          // wall-clock to first token (client-side)
        promptEvalDurationMs,            // ollama prefill duration (server-side TTFT)
        evalDurationMs,                  // ollama decode duration
        totalDurationMs,                 // ollama total (includes load time)
        promptEvalCount,                 // prompt tokens
        evalCount,                       // completion tokens
        decodeTps,                       // completion tokens/sec
        prefillTps,                      // prompt tokens/sec
      },
    };
  }
}

module.exports = OllamaTTFTProvider;