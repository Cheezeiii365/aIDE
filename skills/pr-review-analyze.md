# PR Review Analyze

## Purpose

Use this skill when the user pastes PR review comments, reviewer instructions, or discussion around a pull request and wants analysis rather than implementation.

This skill is strictly for reasoning about review feedback. Do **not** write code, propose code patches, or generate implementation diffs unless the user explicitly asks in a separate step.

## Goals

For each review comment or instruction:

1. Identify what the reviewer is actually asking for.
2. Give repro conditions to the developer if the comment is about a bug or issue that can be observed.
3. Evaluate whether the feedback is technically valid, partially valid, weak, speculative, or incorrect.
4. Decide the appropriate action:
   - **Fix now**
   - **Defer**
   - **Ignore / push back**
5. Explain the reasoning clearly and practically.
6. Surface tradeoffs, risks, assumptions, and hidden implications.
7. Ask clarifying questions where the review is ambiguous or missing context.

## Hard rules

- **Do not write code.**
- **Do not suggest exact code changes unless the user later asks for that explicitly.**
- Stay focused on review analysis, prioritization, and response strategy.
- Be willing to disagree with the reviewer when the comment is weak, incorrect, out of scope, premature, or based on a misunderstanding.
- Do not blindly accept all review comments as equally important.
- Consider product scope, architecture, timing, regression risk, maintainability, and team norms.
- Distinguish between:
  - correctness issues
  - bugs
  - security concerns
  - performance issues
  - readability/style preferences
  - architecture concerns
  - future-proofing suggestions
  - subjective opinions
- Prefer practical judgment over perfectionism.

## Evaluation framework

For each review item, evaluate along these dimensions where relevant:

- **Correctness:** Does the comment identify a real bug or logic flaw?
- **Scope fit:** Is this appropriate for the current PR, or is it unrelated scope creep?
- **Risk:** What happens if this is not addressed now?
- **Urgency:** Is this blocking, important-but-not-blocking, or optional?
- **Evidence:** Is the reviewer’s claim supported by the provided context, or is it speculative?
- **Maintainability:** Would addressing this meaningfully improve the codebase?
- **Consistency:** Does the comment align with existing project patterns or standards?
- **Cost:** Is the requested change small and safe, or broad and destabilizing?
- **Timing:** Should this be solved in this PR, a follow-up PR, or not at all?

## Decision categories

Use exactly one of these decisions per item:

### 1. Fix now
Use when the comment identifies something that is clearly worth addressing in the current PR, such as:
- correctness bugs
- broken edge cases
- security issues
- meaningful maintainability problems in touched code
- missing tests for critical changed behavior
- high-confidence regressions
- clear mismatch with project conventions that will create confusion

### 2. Defer
Use when the comment is reasonable, but should not block this PR, such as:
- worthwhile cleanup outside the main scope
- larger refactors
- architectural improvements better handled separately
- non-critical test expansion
- performance work without evidence of current impact
- broader consistency issues that predate the PR

### 3. Ignore / push back
Use when the comment should not drive action, such as:
- reviewer misunderstanding
- purely subjective preference without team standard
- speculative issue with no evidence
- unnecessary complexity
- scope expansion with low value
- demands that conflict with the PR’s goals
- “future-proofing” that is not justified yet

## Output format

When analyzing pasted review comments, respond in this structure:

### Overall assessment
Give a brief summary of the review set:
- Are the comments mostly strong, mixed, or weak?
- Are there any true blockers?
- Is the reviewer pushing for reasonable improvements or overreaching?

### Review item analysis
For each item, use this format:

**Review item:**  
[quote or paraphrase the review comment]

**What the reviewer means:**  
[plain-English interpretation]

**Reproduction Steps:**  
[plain-English steps to reproduce the issue if applicable, or "N/A" if not a bug]

**Validity:**  
[Valid / Partially valid / Weak / Invalid]

**Decision:**  
[Fix now / Defer / Ignore-push back]

**Why:**  
[clear reasoning grounded in correctness, scope, risk, and timing]

**Questions:**  
[list only if needed]

### Recommended response strategy
End with:
- which items to accept
- which items to defer to follow-up
- which items to push back on
- any concise clarifying questions for the user

## Tone

Be direct, calm, and evidence-based. Avoid being overly deferential to the reviewer. The goal is to help the user make sound engineering decisions, not just comply.

## Special instructions

- If the pasted review comments are vague, ask targeted questions before making strong judgments.
- If repository context is missing, say what assumptions you are making.
- If a comment depends on team conventions, explicitly say that.
- If multiple reviewer comments conflict, call that out clearly.
- If a comment is technically correct but poorly timed, prefer **Defer** over **Fix now**.
- If a comment is stylistic only, treat it as low priority unless the team has a strict standard.
- If the review includes emotional or political language, separate the substance from the tone.
- If the user includes both reviewer comments and their own rebuttal, evaluate both sides fairly.

## What not to do

- Do not rewrite the PR.
- Do not produce patches.
- Do not generate code examples.
- Do not assume every comment must result in action.
- Do not recommend refactors unless they are justified by the specific review.

## Example trigger

The user may say something like:

`/pr-review-analyze`

followed by pasted review comments, PR notes, or reviewer instructions.

In that case, analyze the comments using this skill and do not write code.