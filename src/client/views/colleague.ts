/*
 * Writing to Colleague, as a panel: read, show, confirm, write, check.
 *
 * Two tabs send things to the degree plan, the plan its courses and the
 * semester its sections, and both owe the student the same courtesy: nothing
 * is written that was not first shown in full, the writes go one at a time so
 * a bar can move, and the report afterwards comes from Colleague's own answer
 * rather than from what this end believes it did. So that courtesy lives
 * here once, and each tab says only what it wants changed.
 */

import type { Applied, ColleaguePlan } from "../../content";
import { type Change, type Skipped, describe as sayChange } from "../../sync";
import { colleaguePlan } from "../bridge";
import { el } from "../dom";

export interface Sync {
  /** Where the conversation happens. */
  panel: HTMLElement;
  /** What it would take, given the plan Colleague holds now. */
  work(theirs: ColleaguePlan): { changes: Change[]; skipped: Skipped[]; notes?: string[] };
  /** Carries out a run of changes, which is always one in practice. */
  apply(changes: Change[]): Promise<Applied>;
  /** Of these changes, how many Colleague's plan now shows. */
  landed(theirs: ColleaguePlan, changes: Change[]): number;
}

const line = (text: string, kind = "muted") => el("p", kind, text);

/** Returns the thing a button calls: work out what would change, and show it. */
export function colleagueSync(sync: Sync): () => Promise<void> {
  const { panel } = sync;

  async function preview() {
    panel.replaceChildren(line("reading your plan in Colleague, which can take a minute…"));
    let theirs: ColleaguePlan;
    try {
      theirs = await colleaguePlan();
    } catch (err) {
      // One sentence, and only the remedy that fits. Stacking a generic
      // "sign in and try again" under every failure taught a student to read
      // neither line.
      const why = err instanceof Error ? err.message : String(err);
      panel.replaceChildren(el("h3", undefined, "could not read your plan"), line(why, "why"));
      if (/sign|session|unauthor/i.test(why)) {
        panel.append(line("open Self-Service in another tab and sign in, then try again."));
      }
      return;
    }

    if (theirs.locked) {
      panel.replaceChildren(line("your degree plan is protected; an advisor has to unlock it."));
      return;
    }

    const { changes, skipped, notes = [] } = sync.work(theirs);

    panel.replaceChildren(
      el("h3", undefined, changes.length ? "this would change" : "nothing to change"),
    );
    for (const change of changes) panel.append(el("div", "sync-change", sayChange(change)));
    for (const miss of skipped) {
      panel.append(el("div", "sync-change muted", `${miss.code ?? ""} — ${miss.why}`.trim()));
    }
    for (const note of notes) panel.append(el("div", "sync-change muted", note));

    if (!changes.length) {
      panel.append(line("Colleague already agrees with this."));
      return;
    }

    const go = el("button", "export");
    go.type = "button";
    go.textContent = `send ${changes.length} change${changes.length === 1 ? "" : "s"}`;
    go.addEventListener("click", () => void commit(changes));

    const cancel = el("button", "export");
    cancel.type = "button";
    cancel.textContent = "cancel";
    cancel.addEventListener("click", () => panel.replaceChildren());

    const row = el("div", "sync-actions");
    row.append(go, cancel);
    panel.append(row);
  }

  /**
   * Writes the changes, one at a time, saying where it has got to.
   *
   * One at a time because thirty round trips is long enough that a student
   * needs to see it moving, and a single call across the bridge can only
   * answer once. The extension keeps the plan Colleague handed back between
   * them, which is what the next write has to carry.
   */
  async function commit(changes: Change[]) {
    // Two divs rather than <progress>, which takes no colour at all until it
    // is given an appearance of none and a pair of vendor pseudo-elements —
    // and then still renders its own idea of a bar. This one is a track and a
    // fill, and does what the stylesheet says.
    const fill = el("span");
    fill.style.width = "0%";
    const bar = el("div", "bar");
    bar.append(fill);
    const doing = el("p", "muted");
    panel.replaceChildren(el("h3", undefined, "writing to your degree plan"), bar, doing);

    const done: Change[] = [];
    let stopped: { change: Change; why: string } | null = null;

    for (const change of changes) {
      doing.textContent = `${done.length + 1} of ${changes.length} · ${sayChange(change)}`;
      try {
        const result = await sync.apply([change]);
        done.push(...result.applied);
        if (result.stopped) {
          stopped = result.stopped;
          break;
        }
      } catch (err) {
        stopped = { change, why: err instanceof Error ? err.message : String(err) };
        break;
      }
      // Painted from what came back rather than from where the loop is: the
      // bar should say what has landed, which is the whole point of it.
      fill.style.width = `${Math.round((done.length / changes.length) * 100)}%`;
    }

    await settle(changes, done, stopped);
  }

  /**
   * Says what happened, having gone and looked.
   *
   * Counting the calls that came back is not the same as counting what
   * landed: a write that succeeded and then failed to be *read* reported
   * itself as nothing written while the course sat on the plan.
   */
  async function settle(
    changes: Change[],
    done: Change[],
    stopped: { change: Change; why: string } | null,
  ) {
    doing(panel, "checking what landed…");
    let count = done.length;
    try {
      count = sync.landed(await colleaguePlan(), changes);
    } catch {
      /* Cannot check, so the count falls back to what the calls said. */
    }

    panel.replaceChildren(el("h3", undefined, `${count} of ${changes.length} on your degree plan`));
    if (stopped) {
      panel.append(line(`stopped at "${sayChange(stopped.change)}" — ${stopped.why}`, "why"));
      panel.append(line("nothing after that was tried."));
      const again = el("button", "export");
      again.type = "button";
      again.textContent = "work out what is left";
      again.addEventListener("click", () => void preview());
      const row = el("div", "sync-actions");
      row.append(again);
      panel.append(row);
    }
  }

  return preview;
}

/** A line under whatever the panel already says, for the slow re-read. */
function doing(panel: HTMLElement, text: string) {
  const last = panel.querySelector("p.muted:last-of-type");
  if (last) last.textContent = text;
}
