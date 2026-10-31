# SysDraw — Roadmap

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

The full prompt for each session (Goal, Read, Build, Out of scope, Done when) is in `docs/SPEC.MD` → "Session prompts".

## Roadmap

The MVP is 21 sessions in five phases; Phase 0 and Phase 1 must run in order, while Phases 2–4 can be reordered once the engine exists.

| Phase                              | Sessions                                                                                                                                                        | Gate before the next phase                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0 — Foundation                     | S01 Scaffold and docs · S02 Core schemas and migrations · S03 Registry and plugin API · S04 Canvas editor · S05 Inspector · S06 Workspace, tabs and persistence | F1, F2, F5, F9 acceptance checks pass                         |
| 1 — Simulation and metrics         | S07 Engine core · S08 Metrics UI · S09 Horizontal and vertical scaling · S10 Global users and geo · S11 Chaos and time-series                                   | F6, F7, F8 acceptance checks pass                             |
| 2 — Real tools and cloud platforms | S12 Cloud provider catalogs · S13 Data and messaging tools                                                                                                      | F4 acceptance check passes                                    |
| 3 — Networking and security        | S14 Protocol catalog and edge inspector · S15 Request trace view · S16 Security layer                                                                           | F10 acceptance check passes                                   |
| 4 — Practice and learning          | S17 Problem library · S18 Modes · S19 Review rules and evaluator · S20 Capacity estimator · S21 Polish                                                          | F3, F11, F12 checks; Lighthouse a11y ≥ 90; 300-node perf test |

_The original spec showed this as a diagram; the gates above are the feature acceptance checks each phase delivers (see ARCHITECTURE.md → Feature requirements)._

**After MVP (later, as needed):** discrete-event engine for realistic tail latency, more problems (Google Docs, Dropbox, Ticketmaster, stock exchange, distributed cache, search autocomplete), optional AI interviewer that asks follow-ups and reviews your design, design comparison view (two boards side by side), shareable read-only links, cloud sync with accounts, multiplayer mock interviews, export to PNG/SVG/Mermaid/Terraform skeleton.

## Templates

Use these for everything after the 21 build sessions; each is a complete session prompt once the blanks are filled.

**Add a component**

```markdown
TASK — Add component: <name> (e.g. Apache Pulsar).
Read: docs/DATA-MODEL.md (ComponentDefinition), src/registry/components/<category>/ (one
existing file as an example), src/engine/behaviors/README.md.
Build: one file src/registry/components/<category>/<id>.ts using defineComponent with
ports, configSchema (basic + advanced), instanceTypes, perf model, behaviors, providerNames,
full docs (summary, howItWorks, tradeoffs, interviewTips), security notes.
If it needs new behavior, add src/engine/behaviors/<behavior>.ts + test.
Out of scope: UI changes (there should be none).
Done when: it appears in palette/inspector/engine; registry and behavior tests pass.
```

**Add a protocol**

```markdown
TASK — Add protocol: <name>.
Read: docs/NETWORK-SECURITY.md, src/registry/protocols/http2.ts as an example.
Build: defineProtocol entry (layer, handshakeRtts, overhead, flags, runsOn, docs with
handshakeSteps, headerFields, securityNotes); add trace steps if the handshake is new.
Done when: it can be chosen on a valid edge and appears in the trace view.
```

**Add a practice problem**

```markdown
TASK — Add problem: <title>, level <1-5>.
Read: docs/DATA-MODEL.md (Problem entry), src/registry/problems/instagram/ as an example.
Build: requirements (functional, non-functional), scale numbers, scenario preset with flows,
5 ordered hints, rubric (rules + SLO targets), one reference solution graph, one
debugVariant with the expected fix.
Done when: the reference solution meets its own rubric in the simulator.
```

**Add a mode or review rule**

```markdown
TASK — Add <mode | rule>: <name>.
Read: docs/MODES.md or src/registry/rules/README.md, one existing example.
Build: implement ModeController (onEnter, onGraphChange, onSimResult, isComplete) or
defineRule (check + fix + tests with a passing and failing fixture).
Done when: it shows in the mode switcher / findings panel with tests green.
```

**Change the architecture (rare)**

```markdown
TASK — Architecture change: <what and why>.
Read: docs/ARCHITECTURE.md, docs/DATA-MODEL.md, docs/PROGRESS.md.
First produce a short design note (problem, options, decision, migration impact) and stop
for my approval. Only after approval: implement, add a schema migration if the saved
format changes, update docs/ARCHITECTURE.md.
```

**Handoff note (the AI appends this to `docs/PROGRESS.md` at the end of every session)**

```markdown
## <Session id> — <title> — <date>

Status: done | partial
Changed: <folders/files>
Public APIs added/changed: <function signatures>
Registry entries added: <ids>
Tests: <count added>, all passing
Known gaps / follow-ups: <bullets>
Next suggested session: <id>
```
