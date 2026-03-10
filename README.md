# Racing Assistant test

## Installation

Install Promptfoo globally using npm:
```
npm install -g promptfoo
```

Ensure the Ollama HOST is set correctly in your environment variables:

```
export OLLAMA_HOST=http://localhost:11434
```

Install the models locally:

```
ollama pull granite3.1-moe:1b
ollama pull granite4:350m
ollama pull granite4:1b
ollama pull granite4:1b-h
ollama pull granite4:32b-a9b-h
```

## Running the tests
To run the tests locally with Ollama, use the following command:

```
promptfoo eval
```

Note the granite4:32b-a9b-h model is a very large model that requires 24GB of GPU memory to run.
This model is used as a reference for the best possible performance, but it may not be feasible to run on all hardware configurations.

## Testing methodology
Promptfoo was used to execute a series of tests to assess the performance of a two prompts across a number of models all running with Ollama using a Nvidia 4090 GPU with 24GB of RAM.

The tests are designed to simulate the types of questions that the child would ask of the racing assistant, and is scored on what would
be a good answer in a language that the child would understand. To asses the base performance of the model and to test the impact of
additional context.

The tests are executed with two prompts:
* A base prompt with no additional context
* An enhanced prompt with additional context about the game and the general mechanics of racing

Every model is testsed with both prompts and their output is measured. The intention is to both measure the models, but also determine
if the additional context has a positive or negative impact on the performance of the model. The tests are designed to be as objective as possible, with the scoring based on the presence of key words and phrases that would indicate a good answer.

**Note:** It is not believed that running the tests on a CPU would change any other variable other than speed of execution. This hypothesis has not been tested.

### Prompts
The prompts can be found in the files `prompt-with-context.yaml` and `prompt-without-context.yaml`. The without context prompt is from your original prompt,
the with context prompt is a quick experiment to add some additional context about the game and the mechanics of racing to see if this improves the performance of the model. To run a qualitative test of the impact of additional context, you would need to modify the `prompt-with-context.yaml` to include the specifics for
your game and project.

### Questions
The file `promptfooconfig.yaml` contains the questions that are asked of the model. For example, "My car keeps crashing into the walls, what I am doing wrong?"
the response from the model is then scored based on the inclusion of the following key words and phrases:
* "Steering Gain"
* "Centering Gain"
* ...
* reduce
* lower

The full yaml for this question is as follows:

```yaml
  - description: Child asks why their car keeps crashing
    vars:
      question: My car keeps crashing into the walls! What am I doing wrong?
    assert:
      - type: icontains-any
        value:
          - Steering Gain
          - Centering Gain
          - Target Speed
          - Traction Control
        metric: mentions-named-slider
      - type: icontains-any
        value:
          - reduce
          - lower
          - decrease
          - slow
        metric: advises-reducing-something
```

To build a assertion you need to break the anticipated response down into its key components, in the example of the question above, the key components that 
would make a good answer are:
* The answer should mention one of the named sliders that are relevant to crashing into walls
* The answer should advise the child to reduce one of the sliders or slow down
Once the metrics have been analysed you can then determine words or frases that would indicate the presence of these components in the response, for example, the presence of "Steering Gain" or "Centering Gain" would indicate that the model is mentioning a relevant slider, while the presence of "reduce" or "slow" would indicate that the model is advising the child to reduce something or slow down.

**NOTE:** The current questions in the `promptfooconfig.yaml` are just examples, you would need to modify these to fit the exact parameters of the game.

## Quick analysis,
As expected the large `granite4:32b-a9b-h` model performs the best, and context appears to make little difference, if anything, performance with context is slightly worse indicating that the context contains lower quality of information than which was used in its training. This is a useful insight as it can be used to benchmark context. If the quality of output for `granite4:32b-a9b-h` with context equals or betters the response without context then this proves that context is not having a negative impact and should also improve the quality of the output from smaller models where context has a bigger impact.

However, once we take latency into account the `granite4:32b-a9b-h` model is not a viable option for running in real time on less capable hardware, and therefore the performance of the smaller models becomes more important.

None of the other models pass 100% of the tests, however context does improve the peformance of the smaller models. Given changes to context I suspect that even the smallest model `granite3.1-moe:1b` could pass all currently defined tests.

From initial testing, it appears that with a few refinements to prompt and context, you should be able to derive a satisfactory response from the small `granite3.1-moe:1b` model which is optimised for CPU. This would enable you to bundle the model with your game and remove any dependency on external inference.

## Latency Testing

Measuring the latency of a model shows us the number of tokens it can process per second. While this is an important metric to understand it is increasingly important then running on resource constrained hardware. 

For example, running `granite4:350m` on an `Nvidia 4090GPU with 24GB of RAM`, we see a prefil speed of `34647` tokens per second, given a prompt length of `639 tokens`, this means that the time take for us to receive the first token from the model after sending the message is `19ms`, assuming a warm model. If we look at the same model running on a `Macbook Pro M1 Pro with 32GB of RAM` we see a prefill speed of `4016` tokens per second and a time to first token of `163ms`. This is a significant increase in latency and highligts the efficiency of good hardware, however, this is still perfectly acceptable latecncy for a good user experience in the game. The user would not notice the difference between 19ms and 163ms.

However, when we look at the larger `granite4:32b-a9b-h` model we see a prefill speed of `3063` tokens per second on the `Nvidia 4090GPU with 24GB of RAM` and a time to first token of `208ms`, while on the `Macbook Pro M1 Pro with 32GB of RAM` we see a prefill speed of `128` tokens per second and a time to first token of `4977ms`. This is a significant increase in latency and would likely lead to a poor user experience in the game. The user would most certainly notice the difference between 208ms and 4977ms and therefore it would not be acceptable to use this model on less capable hardware.

In both of these instances we are disregarding the cold start time as this can be mitigated in the game by pre-loading the model into memory before the user starts interacting with it.

### Methodology
In order to measure the latency of the models and the prompts we use a custom provider that enables us to collect specific metrics from Ollama:
* Time to first token (TTFT), this is the time it takes for the client to receive the first token from the model after sending the request.
* Prompt Evaluation Time, this is the time it takes for the model to process the prompt before it starts generating the response.
* Evaluation Time, this is the time it takes for the model to generate the response after processing the prompt.
* Total Duration, this is the total time it takes for the model to load the model, process the prompt and generate the response.

It is important to note that model load time is effectively a one time cost as it covers the cost of loading the model into memory, once the model is loaded subequent requests will not incur this cost. For this reson the custom provider sends a `keep_alive: 0` request before every message, this ensures that the model is unloaded after every request. 

To effectively measure the latency of the prompts and models it is important to set the `max-concurrency` to 1 to get a clearer picture of single-request latency. Promptfoo by default will attempt to run multiple requests in parallel and then takes an average of the results. The intention is to speed up the testing process based on the assumption that each request will hit a different inference engine. When testing locally with Ollama this is not the case, all requests will hit the same inference engine so running parallel requests competes for the same resources and reduces the prcision of latency measrements for each test. Setting `max-concurrency` to 1 ensures that each request is processed sequentially and provides a more accurate measurement of latency for each prompt and model combination.

### Running the tests

First run the tests with the following command to generate the results file:

```bash
promptfoo eval --output results.json --no-cache --max-concurrency 1
```

The results file contains detailed statistics about the performance of each model and prompt combination.
To extract the latency information into a table use the following command:

```bash
node gen-table.js results.json
```

### Latency Test Results Nvidia 4090 GPU 24GB RAM

**Note:** `Avg Prefill` scales with prompt size, the implication from the data is that a larger prompt leads to a higher prefill speed. While this is technically true it is due to the smaller prompt not fully utilising the GPU. This scale is not linear, if both prompts were large enought to fully utilise the GPU then the Avg Prefill would be the same for both prompts. The dramatic differencs is only due to the smaller prompt underutilising the GPU. To get the most realistic idea of the prefill speed the larger prompt should be used as this is more likely to fully utilise the GPU and provide a more accurate measurement of the prefill speed.

When you send a prompt, the GPU processes all tokens in parallel as a single matrix multiply. The efficiency of a GPU's tensor cores improves significantly with larger batches because:

1. GPU utilization — small batches underutilize the GPU's parallelism. With only 171 tokens (without-context), much of the GPU sits idle. With 639–750 tokens, you're filling more of the compute capacity.
2. Memory bandwidth amortization — loading model weights from VRAM has a fixed overhead per layer. A larger token batch amortizes that cost across more work per weight load.
3. Kernel efficiency — GPU compute kernels (cuBLAS/cuDNN) have optimal tile sizes. Larger sequences hit those sweet spots more effectively.

| Model | Prompt | Avg Prompt Tokens | Avg Response Tokens | Warm TTFT p50 (ms) | Warm TTFT p95 (ms) | Cold TTFT p50 (ms) | Cold TTFT p95 (ms) | Avg Decode (tok/s) | Avg Prefill (tok/s) |
|---|---|---|---|---|---|---|---|---|---|
| granite3.1-moe:1b | with-context | 750 | 168 | 25 | 25 | 978 | 1324 | 855 | 30801 |
| granite3.1-moe:1b | without-context | 206 | 181 | 12 | 12 | 1158 | 1357 | 828 | 17569 |
| granite4:1b | with-context | 639 | 98 | 33 | 34 | 1489 | 1561 | 233 | 19356 |
| granite4:1b | without-context | 171 | 95 | 15 | 15 | 1710 | 1730 | 230 | 11782 |
| granite4:1b-h | with-context | 639 | 108 | 44 | 45 | 1752 | 1800 | 129 | 14559 |
| granite4:1b-h | without-context | 171 | 103 | 17 | 18 | 1378 | 1394 | 130 | 9824 |
| granite4:32b-a9b-h | with-context | 639 | 110 | 208 | 211 | 5282 | 5532 | 72 | 3063 |
| granite4:32b-a9b-h | without-context | 171 | 223 | 72 | 73 | 3634 | 3673 | 71 | 2370 |
| granite4:350m | with-context | 639 | 82 | 19 | 20 | 1551 | 1666 | 764 | 33637 |
| granite4:350m | without-context | 171 | 63 | 10 | 10 | 1142 | 1257 | 783 | 17535 |

### Latency Test Results Macbook Pro M1 Pro 32GB RAM (2021)

| Model | Prompt | Avg Prompt Tokens | Avg Response Tokens | Warm TTFT p50 (ms) | Warm TTFT p95 (ms) | Cold TTFT p50 (ms) | Cold TTFT p95 (ms) | Avg Decode (tok/s) | Avg Prefill (tok/s) |
|---|---|---|---|---|---|---|---|---|---|
| granite3.1-moe:1b | with-context | 750 | 159 | 263 | 267 | 1484 | 1505 | 108 | 2886 |
| granite3.1-moe:1b | without-context | 206 | 196 | 108 | 116 | 820 | 826 | 107 | 1919 |
| granite4:1b | with-context | 639 | 109 | 621 | 648 | 2936 | 3413 | 47 | 1020 |
| granite4:1b | without-context | 171 | 104 | 206 | 210 | 1261 | 1277 | 48 | 841 |
| granite4:1b-h | with-context | 639 | 128 | 924 | 951 | 2197 | 2244 | 41 | 691 |
| granite4:1b-h | without-context | 171 | 104 | 275 | 279 | 796 | 809 | 41 | 621 |
| granite4:32b-a9b-h | with-context | 639 | 112 | 4977 | 5065 | 18978 | 19973 | 13 | 128 |
| granite4:32b-a9b-h | without-context | 171 | 215 | 1527 | 1544 | 3491 | 3507 | 13 | 112 |
| granite4:350m | with-context | 639 | 96 | 163 | 169 | 1178 | 1202 | 148 | 4016 |
| granite4:350m | without-context | 171 | 43 | 52 | 57 | 564 | 586 | 155 | 3229 |




## Models tested

### Summary

| Model | Total Params | Active Params | RAM Required | CPU Optimised | Architecture |
|---|---|---|---|---|---|
| `granite3.1-moe:1b` | 1.33B | ~400M | ~2–3 GB | Yes | Sparse MoE Transformer |
| `granite4:350m` | 352M | 352M | ~1–2 GB | Yes | Dense Transformer |
| `granite4:1b` | 1.63B | 1.63B | ~4–6 GB | Yes | Dense Transformer |
| `granite4:1b-h` | ~1.5B | ~1.5B | ~2–4 GB | Partial* | Hybrid Mamba-2/Transformer |
| `granite4:32b-a9b-h` | 32B | ~9B | ~20–24 GB VRAM | Partial* | Hybrid Mamba-2/Transformer MoE |

> \* The `-h` (Hybrid) variants run on CPU via Ollama but achieve peak efficiency on hardware with Mamba-2 SSM support (e.g. Qualcomm Hexagon NPUs). On standard CPUs they are functional but not as optimised as the plain transformer variants.

---

### granite3.1-moe:1b

**IBM Granite 3.1 — Mixture of Experts 1B**

A sparse Mixture of Experts model from IBM's previous generation (3.1). Despite having 1.33B total parameters, only ~400M are active during any single inference pass thanks to top-8 routing across 32 experts. IBM explicitly designed this for CPU-based and edge deployments. Supports a 128K token context window.

| Spec | Value |
|---|---|
| Total parameters | 1.33B |
| Active parameters | ~400M |
| RAM required | ~2–3 GB |
| Disk (Q8) | ~1.4 GB |
| Context window | 128K tokens |
| CPU optimised | Yes |
| License | Apache 2.0 |

---

### granite4:350m

**IBM Granite 4.0 Nano — 350M (Dense Transformer)**

The smallest Granite 4 model, designed for maximum portability. This is the standard transformer variant (no Mamba-2), explicitly provided for compatibility with CPU inference stacks such as llama.cpp that do not yet have optimised Mamba-2 support. Has been demonstrated running on a Raspberry Pi 5. Suitable for edge/on-device NLP, instruction following, tool calling, and lightweight RAG. Trained on ~15 trillion tokens.

| Spec | Value |
|---|---|
| Total parameters | 352M |
| Active parameters | 352M (dense) |
| RAM required | ~1–2 GB |
| Disk (BF16) | ~708 MB |
| Context window | 32K tokens |
| CPU optimised | Yes |
| License | Apache 2.0 |

---

### granite4:1b

**IBM Granite 4.0 Nano — 1B (Dense Transformer)**

The 1B dense transformer variant of Granite 4.0 Nano. Like the 350M sibling, this is the non-hybrid version for compatibility with CPU inference frameworks that lack Mamba-2 support. Offers a longer 128K context window. Well-suited for instruction following, tool calling, code tasks, RAG, and multilingual dialogue in resource-constrained settings.

| Spec | Value |
|---|---|
| Total parameters | 1.63B |
| Active parameters | 1.63B (dense) |
| RAM required | ~4–6 GB |
| Disk (BF16) | ~3.3 GB |
| Context window | 128K tokens |
| CPU optimised | Yes |
| License | Apache 2.0 |

---

### granite4:1b-h

**IBM Granite 4.0 Nano — 1B Hybrid (Mamba-2/Transformer)**

The `-h` suffix means **Hybrid** — the preferred 1B variant when the runtime supports Mamba-2 state-space model operations. Interleaves 90% Mamba-2 layers with 10% traditional attention layers (36 Mamba-2 + 4 attention), providing >70% RAM savings and ~2× faster inference at long context lengths compared to an equivalent pure-transformer model. Developed in collaboration with Qualcomm and Nexa AI for optimised NPU inference on mobile and PC hardware.

| Spec | Value |
|---|---|
| Total parameters | ~1.5B |
| Active parameters | ~1.5B (dense hybrid) |
| RAM required | ~2–4 GB |
| Disk (Q8) | ~1.6 GB |
| Context window | 128K tokens |
| CPU optimised | Partial (best on Mamba-2-capable hardware) |
| License | Apache 2.0 |

---

### granite4:32b-a9b-h

**IBM Granite 4.0 H-Small — 32B total / 9B active (Hybrid MoE)**

The flagship Granite 4.0 model. The name encodes its key properties: 32B total parameters, ~9B active per token (sparse MoE with 10 of 72 experts active), and hybrid Mamba-2 architecture. Despite the 32B total size, compute per token is equivalent to a ~9B dense model. The hybrid architecture reduces RAM by >70% vs a comparable dense 32B transformer, allowing multiple concurrent long-context sessions on a single GPU. First open model family to receive ISO 42001 AI certification. Targets enterprise RAG, agentic workflows, function calling, and complex multi-turn conversations.

> **Note:** This is a very large model requiring ~20–24 GB VRAM. It is included as a performance reference baseline. GPU is strongly recommended.

| Spec | Value |
|---|---|
| Total parameters | 32B |
| Active parameters | ~9B (MoE, 10/72 experts active) |
| RAM / VRAM required | ~20–24 GB VRAM |
| Disk (Q4) | ~19 GB |
| Context window | 128K tokens |
| CPU optimised | Partial (functional via Ollama, GPU strongly preferred) |
| License | Apache 2.0 |