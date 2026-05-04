# CLAUDE.md — EY Access Governance Platform

Behavioral guidelines for Claude Code. Read STATUS.md before every task.

---

## Project

Enterprise access governance platform. React + TypeScript frontend, FastAPI + Python backend.

EY-branded:
- Yellow `#FFE600` accent
- Dark sidebar `#1A1A24`
- Dense analytical layouts

---

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

### Before implementing

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Start building only when you have reached 95% confidence. Ask questions to reach that 95% confidence.

---

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Check yourself

Ask yourself:

> "Would a senior engineer say this is overcomplicated?"

If yes, simplify.

---

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

### When editing existing code

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

### When your changes create orphans

- Remove imports/variables/functions that **your changes** made unused.
- Don't remove pre-existing dead code unless asked.

### The test

Every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

### Transform tasks into verifiable goals

- **"Add validation"** → "Write tests for invalid inputs, then make them pass"
- **"Fix the bug"** → "Write a test that reproduces it, then make it pass"
- **"Refactor X"** → "Ensure tests pass before and after"

### For multi-step tasks, state a brief plan

1. **[Step]** → verify: **[check]**
2. **[Step]** → verify: **[check]**
3. **[Step]** → verify: **[check]**

Strong success criteria let you loop independently.

Weak criteria (`"make it work"`) require constant clarification.

---

## 5. Sacred Rules

- DO NOT modify engine algorithms (`backend/engines/*.py` computation logic).
- DO NOT rename column mappings or constants unless explicitly asked.
- DO NOT generate multiple files in one prompt.
- DO NOT repeat instructions from `SPEC.md` or `STATUS.md` in responses.
- Engine files NEVER import FastAPI or Pydantic.

---

## 6. File Workflow

- Read `STATUS.md` first — it tells you what's done, what's broken, what's next.
- Refer to `SPEC.md` only for the specific section needed (e.g. `SPEC.md §Sidebar`).
- After completing work, update `STATUS.md` with what changed.
- One prompt = one bug fix. Always.

---

## 7. Quality Checks

- When user provides a screenshot, analyze layout and suggest specific fixes.
- Test at `1366×768` viewport (standard EY laptop).
- Prefer loading skeletons over spinners for page sections.
- Every empty state needs:
  - icon
  - title
  - description
  - action

---