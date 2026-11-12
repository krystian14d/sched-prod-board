---
id: SCHED-4515
title: List holds still; "N new" bar brings new incidents in
status: done
plan: R1 (changed), R2
---

From product's answer to the step-1 report (2026-11-12): "The list holds still while it is on screen; a
"N new" bar brings new incidents in on click. Ack stays on the row."

- A refresh never moves or removes a row that is on screen.
- New incidents wait behind a bar (`data-testid="new-bar"`, "N new incidents — show") at the top. The bar's
  slot is always there, so the bar showing up does not push the list down.
- Clicking the bar puts the waiting incidents at the top, newest first, each with its own Ack.
- Ack stays on each row (no panel, no confirm).

Acceptance: an incident that arrives while on-call aims at a row's Ack does not move that row; the Ack acks
the row aimed at; the bar brings the new incident in on click.
