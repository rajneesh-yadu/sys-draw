# SysDraw — Modes

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

## Modes

Six modes share one board and one engine; a mode only changes what help is shown, what is locked, and how success is judged. Each is a `ModeController` with hooks `onEnter`, `onGraphChange`, `onSimResult`, `isComplete`, so new modes are plug-ins too.

| Mode      | What the user does                                                                                                                          | Help shown                                                                                              | Success                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Sandbox   | Builds anything freely                                                                                                                      | Live metrics and review findings, all optional                                                          | None; free play                                                          |
| Guided    | Follows a problem step by step: requirements → estimates → API → data model → high-level design → scale → bottlenecks                       | Next-step card, hints on request, "why" explanations                                                    | Each step's checks pass                                                  |
| Interview | Solves a problem against a 45-minute timer, as in a real interview                                                                          | None until finished; optional AI-free interviewer prompts ("what if traffic grows 10×?") at fixed times | Rubric score: SLOs met, rules passed, cost, plus a self-review checklist |
| Debug     | Gets a pre-built design with hidden faults (missing index, SPOF, wrong protocol, cache stampede, hot partition) and symptoms in the metrics | Symptoms only; hints cost points                                                                        | Faults fixed and SLOs restored                                           |
| Chaos     | Runs a time-series simulation and injects failures live (kill AZ, spike traffic, add packet loss)                                           | Timeline of events and recovery                                                                         | Availability and p99 stay within targets                                 |
| Learn     | Short lessons per concept (consistent hashing, CAP, TLS handshake, Kafka partitions) with a mini-board to try it                            | Step-by-step explanation                                                                                | Lesson quiz passed                                                       |

Scores, attempts and time per problem are stored locally to show progress over time.
